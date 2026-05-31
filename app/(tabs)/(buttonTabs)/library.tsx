import { C } from "@/utils/theme"
import { ScalePressable } from "@/components/ScalePressable"
import { ScreenEntry } from "@/components/ScreenEntry"
import { VideoPlayerModal } from "@/components/VideoPlayerModal"
import { groupByDate } from "@/utils/dateGroups"
import { deleteVideoFile, listSavedVideos } from "@/utils/saveVideo"
import { useFocusEffect } from "@react-navigation/native"
import * as VideoThumbnails from "expo-video-thumbnails"
import React, { useCallback, useMemo, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Modal,
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

function extractBlockType(filename: string): string | null {
  const known = ["constraint_warmup", "project_bouldering", "strength_conditioning", "exploration_session"]
  for (const type of known) {
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
  const [videos, setVideos] = useState<VideoItem[]>(videoListCache)
  const [loading, setLoading] = useState(videoListCache.length === 0)
  const [selectedVideo, setSelectedVideo] = useState<VideoItem | null>(null)

  useFocusEffect(
    useCallback(() => { loadVideos() }, [])
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
      <View style={styles.cardOverlay}>
        <Text style={styles.cardLabel} numberOfLines={1}>
          {formatBlockType(item.blockType)}
        </Text>
      </View>
    </ScalePressable>
  )

  const groups = useMemo(() => groupByDate(videos), [videos])

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenEntry>
      <View style={styles.header}>
        <Text style={styles.title}>Library</Text>
        <Text style={styles.subtitle}>Saved attempt videos</Text>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={C.green} />
      ) : videos.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🎬</Text>
          <Text style={styles.emptyTitle}>No videos yet</Text>
          <Text style={styles.emptyText}>
            Record your attempts during training — they'll appear here.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
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
    </SafeAreaView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
    gap: 2,
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
})
