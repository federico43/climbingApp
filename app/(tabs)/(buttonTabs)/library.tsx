import { C } from "@/utils/theme"
import { ScalePressable } from "@/components/ScalePressable"
import { ScreenEntry } from "@/components/ScreenEntry"
import { ScreenGradient } from "@/components/ScreenGradient"
import { VideoPlayerModal } from "@/components/VideoPlayerModal"
import { FeedbackViewer } from "@/components/FeedbackViewer"
import { ImportVideoModal } from "@/components/ImportVideoModal"
import { BLOCK_LABELS, BlockType } from "@/components/workoutBlocks"
import { ConsumeAuth } from "@/components/auth-context"
import { getFeedbackForAthlete, getMyVideos, VideoFeedbackRow, VideoRow } from "@/services/videoStorage"
import { groupByDate } from "@/utils/dateGroups"
import { deleteVideoFile, listSavedVideos, saveVideoLocally } from "@/utils/saveVideo"
import { useFocusEffect } from "@react-navigation/native"
import { useRouter } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import * as ImagePicker from "expo-image-picker"
import * as VideoThumbnails from "expo-video-thumbnails"
import React, { useCallback, useMemo, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

// ─── Types ────────────────────────────────────────────────────────────────────

interface VideoItem {
  id: string
  uri: string
  filename: string
  thumbnail: string | null
  blockType: string | null
  // Pulled in from the camera roll rather than recorded live — see the
  // `_imported` filename tag in saveVideo.tsx.
  imported: boolean
  // ISO timestamp derived from the filename so `groupByDate` works.
  $createdAt: string
}

// ─── Module-level caches ──────────────────────────────────────────────────────

const thumbnailCache = new Map<string, string>()
let videoListCache: VideoItem[] = []

// ─── Helpers ──────────────────────────────────────────────────────────────────

const COLUMN_GAP = 12
const SCREEN_PADDING = 16
const NUM_COLUMNS = 2
const CARD_WIDTH = (Dimensions.get("window").width - SCREEN_PADDING * 2 - COLUMN_GAP) / NUM_COLUMNS
const CARD_HEIGHT = CARD_WIDTH * 1.4

// Every type a clip's filename might carry — recorded blocks and imported
// clips both draw from this one taxonomy (see BLOCK_LABELS), so any of them
// is recognized here instead of just the handful this used to hardcode.
const KNOWN_BLOCK_TYPES = Object.keys(BLOCK_LABELS)

function extractBlockType(filename: string): string | null {
  for (const type of KNOWN_BLOCK_TYPES) {
    if (filename.includes(type)) return type
  }
  return null
}

// File pattern is `boulderapp_<type>_<timestamp>.mov`
function extractTimestamp(filename: string): number {
  const m = filename.match(/_(\d{10,})\.(mov|mp4)$/)
  return m ? Number(m[1]) : 0
}

function formatBlockType(type: string | null): string {
  if (!type) return "Climb"
  return type.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")
}

async function getThumbnail(filename: string, uri: string): Promise<string | null> {
  if (thumbnailCache.has(filename)) return thumbnailCache.get(filename)!
  try {
    const result = await Promise.race([
      VideoThumbnails.getThumbnailAsync(uri, { time: 1000, quality: 0.5 }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
    ])
    const thumbUri = (result as any)?.uri ?? null
    if (thumbUri) thumbnailCache.set(filename, thumbUri)
    return thumbUri
  } catch {
    return null
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function LibraryScreen() {
  const { User } = ConsumeAuth()
  const router = useRouter()
  const [videos, setVideos] = useState<VideoItem[]>(videoListCache)
  const [loading, setLoading] = useState(videoListCache.length === 0)
  const [selectedVideo, setSelectedVideo] = useState<VideoItem | null>(null)

  // Clips submitted to the coach, and any feedback left on them.
  const [submitted, setSubmitted] = useState<VideoRow[]>([])
  const [submittedThumbs, setSubmittedThumbs] = useState<Record<string, string>>({})
  const [feedbackByVideoId, setFeedbackByVideoId] = useState<Record<string, VideoFeedbackRow>>({})
  const [playRemote, setPlayRemote] = useState<VideoRow | null>(null)
  const [viewerTarget, setViewerTarget] = useState<{ video: VideoRow; feedback: VideoFeedbackRow } | null>(null)

  // Importing a video from the device's camera roll — picked first, then
  // tagged with a type in ImportVideoModal before it's copied into the library.
  const [pickedVideoUri, setPickedVideoUri] = useState<string | null>(null)

  useFocusEffect(
    useCallback(() => { loadVideos() }, [])
  )

  useFocusEffect(
    useCallback(() => {
      if (!User) return
      getMyVideos()
        .then((rows) => {
          setSubmitted(rows)
          // Parallel, not sequential — each thumbnail downloads a frame from
          // the remote clip, so awaiting them one at a time made a library of
          // more than a few clips take a long time to fill in.
          const toGenerate: typeof rows = []
          const seeded: Record<string, string> = {}
          for (const row of rows) {
            const cached = thumbnailCache.get(row.$id)
            if (cached) seeded[row.$id] = cached
            else toGenerate.push(row)
          }
          setSubmittedThumbs((prev) => ({ ...prev, ...seeded }))
          Promise.all(
            toGenerate.map(async (row) => {
              const thumb = await getThumbnail(row.$id, row.url)
              if (thumb) setSubmittedThumbs((prev) => ({ ...prev, [row.$id]: thumb }))
            })
          )
        })
        .catch((e: any) => { console.warn("[feedback] getMyVideos failed:", e?.message ?? e); setSubmitted([]) })
      getFeedbackForAthlete(User.$id)
        .then((rows) => {
          const byVideo: Record<string, VideoFeedbackRow> = {}
          for (const row of rows) if (!byVideo[row.videoId]) byVideo[row.videoId] = row
          setFeedbackByVideoId(byVideo)
        })
        .catch((e: any) => console.warn("[feedback] getFeedbackForAthlete failed:", e?.message ?? e))
    }, [User])
  )

  async function loadVideos() {
    if (videoListCache.length === 0) setLoading(true)

    const files = await listSavedVideos()
    const initial: VideoItem[] = files.map(({ filename, uri }) => {
      const ts = extractTimestamp(filename)
      return {
        id: filename,
        uri,
        filename,
        thumbnail: thumbnailCache.get(filename) ?? null,
        blockType: extractBlockType(filename),
        imported: filename.includes("_imported_"),
        $createdAt: (ts ? new Date(ts) : new Date()).toISOString(),
      }
    })

    videoListCache = initial
    setVideos(initial)
    setLoading(false)

    for (const item of initial) {
      if (thumbnailCache.has(item.filename)) continue
      const thumb = await getThumbnail(item.filename, item.uri)
      if (thumb) {
        setVideos((prev) =>
          prev.map((v) => (v.id === item.id ? { ...v, thumbnail: thumb } : v))
        )
      }
    }
  }

  async function handleDeleteVideo(item: VideoItem) {
    Alert.alert("Delete video", "Remove this video permanently?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteVideoFile(item.filename)
          thumbnailCache.delete(item.filename)
          videoListCache = videoListCache.filter((v) => v.id !== item.id)
          setVideos((prev) => prev.filter((v) => v.id !== item.id))
        },
      },
    ])
  }

  async function handlePickVideo() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert("Permission needed", "Allow photo library access to add a video.")
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "videos",
      quality: 1,
    })
    if (result.canceled || !result.assets[0]) return
    setPickedVideoUri(result.assets[0].uri)
  }

  async function handleImportVideo(blockType: BlockType, notifyCoach: boolean) {
    if (!pickedVideoUri) return
    const saved = await saveVideoLocally(pickedVideoUri, blockType, {}, { notifyCoach, imported: true })
    if (!saved) {
      Alert.alert("Import failed", "Could not add this video. Please try again.")
      return
    }
    setPickedVideoUri(null)
    await loadVideos()
  }

  const renderCard = (item: VideoItem) => (
    <ScalePressable
      key={item.id}
      style={styles.card}
      onPress={() => setSelectedVideo(item)}
      onLongPress={() => handleDeleteVideo(item)}
    >
      {item.thumbnail ? (
        <Image source={{ uri: item.thumbnail }} style={styles.thumbnail} />
      ) : (
        <View style={styles.thumbnailPlaceholder}>
          <Text style={styles.placeholderIcon}>▶</Text>
        </View>
      )}
      {item.imported && (
        <View style={styles.importedBadge}>
          <Ionicons name="download-outline" size={14} color="#fff" />
        </View>
      )}
      <View style={styles.cardOverlay}>
        <Text style={styles.cardLabel} numberOfLines={1}>
          {formatBlockType(item.blockType)}
        </Text>
      </View>
    </ScalePressable>
  )

  const groups = useMemo(() => groupByDate(videos), [videos])

  return (
    <ScreenGradient>
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenEntry>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={20} color={C.textSecondary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Videos</Text>
          <Text style={styles.subtitle}>Saved attempt videos</Text>
        </View>
        <Pressable style={styles.addButton} onPress={handlePickVideo} hitSlop={8}>
          <Ionicons name="add" size={22} color={C.bg} />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={C.green} />
      ) : videos.length === 0 && submitted.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🎬</Text>
          <Text style={styles.emptyTitle}>No videos yet</Text>
          <Text style={styles.emptyText}>
            Record your attempts during training — they&apos;ll appear here.
          </Text>
          <Pressable style={styles.emptyAddButton} onPress={handlePickVideo}>
            <Ionicons name="add" size={18} color={C.bg} />
            <Text style={styles.emptyAddButtonText}>Add a video</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {submitted.length > 0 && (
            <View style={{ marginBottom: 18 }}>
              <Text style={styles.groupHeader}>Submitted clips</Text>
              <View style={styles.cardsRow}>
                {submitted.map((v) => {
                  const fb = feedbackByVideoId[v.$id]
                  return (
                    <ScalePressable
                      key={v.$id}
                      style={styles.card}
                      onPress={() => (fb ? setViewerTarget({ video: v, feedback: fb }) : setPlayRemote(v))}
                    >
                      {submittedThumbs[v.$id] ? (
                        <Image source={{ uri: submittedThumbs[v.$id] }} style={styles.thumbnail} />
                      ) : (
                        <View style={styles.thumbnailPlaceholder}>
                          <Text style={styles.placeholderIcon}>▶</Text>
                        </View>
                      )}
                      {fb && (
                        <View style={styles.feedbackDot}>
                          <Ionicons
                            name={fb.viewed ? "checkmark-circle" : "chatbubble-ellipses"}
                            size={16}
                            color={fb.viewed ? "rgba(255,255,255,0.7)" : C.green}
                          />
                        </View>
                      )}
                      {v.imported && (
                        <View style={styles.importedBadge}>
                          <Ionicons name="download-outline" size={14} color="#fff" />
                        </View>
                      )}
                      <View style={styles.cardOverlay}>
                        <Text style={styles.cardLabel} numberOfLines={1}>
                          {v.projectName || formatBlockType(v.blockType ?? null)}
                        </Text>
                      </View>
                    </ScalePressable>
                  )
                })}
              </View>
            </View>
          )}

          {groups.map(({ group, items }) => (
            <View key={group} style={{ marginBottom: 18 }}>
              <Text style={styles.groupHeader}>{group}</Text>
              <View style={styles.cardsRow}>
                {items.map(renderCard)}
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      </ScreenEntry>

      <Modal
        visible={selectedVideo !== null}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setSelectedVideo(null)}
        statusBarTranslucent
      >
        <VideoPlayerModal
          uri={selectedVideo?.uri ?? null}
          title={formatBlockType(selectedVideo?.blockType ?? null)}
          onClose={() => setSelectedVideo(null)}
        />
      </Modal>

      <Modal
        visible={playRemote !== null}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setPlayRemote(null)}
        statusBarTranslucent
      >
        <VideoPlayerModal
          uri={playRemote?.url ?? null}
          title={playRemote ? (playRemote.projectName || formatBlockType(playRemote.blockType ?? null)) : ""}
          onClose={() => setPlayRemote(null)}
          video={playRemote ?? undefined}
        />
      </Modal>

      {viewerTarget && (
        <Modal
          visible
          animationType="slide"
          presentationStyle="fullScreen"
          onRequestClose={() => setViewerTarget(null)}
          statusBarTranslucent
        >
          <FeedbackViewer
            feedback={viewerTarget.feedback}
            video={viewerTarget.video}
            title={viewerTarget.video.projectName || formatBlockType(viewerTarget.video.blockType ?? null)}
            onClose={() => {
              setFeedbackByVideoId((prev) => ({
                ...prev,
                [viewerTarget.video.$id]: { ...viewerTarget.feedback, viewed: true },
              }))
              setViewerTarget(null)
            }}
          />
        </Modal>
      )}

      <ImportVideoModal
        visible={pickedVideoUri !== null}
        videoUri={pickedVideoUri}
        onClose={() => setPickedVideoUri(null)}
        onImport={handleImportVideo}
      />
    </SafeAreaView>
    </ScreenGradient>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "transparent" },

  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
    gap: 12,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18, marginRight: 12, marginTop: 2,
    backgroundColor: C.surfaceHigh, alignItems: "center", justifyContent: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: C.textPrimary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    color: C.textSecondary,
    fontWeight: "500",
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.green,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },

  scroll: { padding: SCREEN_PADDING, paddingBottom: 140 },

  groupHeader: {
    fontSize: 12, fontWeight: "700", color: C.textSecondary,
    textTransform: "uppercase", letterSpacing: 0.6,
    paddingHorizontal: 4, marginBottom: 10,
  },
  cardsRow: {
    flexDirection: "row", flexWrap: "wrap", gap: COLUMN_GAP,
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: C.surface,
  },
  thumbnail: { width: "100%", height: "100%", borderRadius: 16 },
  thumbnailPlaceholder: {
    flex: 1,
    backgroundColor: C.surfaceHigh,
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderIcon: { fontSize: 28, color: C.textMuted },
  feedbackDot: {
    position: "absolute", top: 6, right: 6,
    width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  importedBadge: {
    position: "absolute", top: 6, left: 6,
    width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  cardOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  cardLabel: { color: "#fff", fontSize: 12, fontWeight: "600" },

  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 8,
  },
  emptyIcon: { fontSize: 40, marginBottom: 4 },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: C.textPrimary },
  emptyText: { fontSize: 14, color: C.textSecondary, textAlign: "center", lineHeight: 22 },
  emptyAddButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    backgroundColor: C.green,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  emptyAddButtonText: { fontSize: 14, fontWeight: "700", color: C.bg },
})
