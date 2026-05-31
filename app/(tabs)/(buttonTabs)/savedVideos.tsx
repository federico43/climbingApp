import { VideoPlayerModal } from "@/components/VideoPlayerModal"
import { deleteVideoFile, listSavedVideos } from "@/utils/saveVideo"
import { useFocusEffect } from "@react-navigation/native"
import { useRouter } from "expo-router"
import * as VideoThumbnails from "expo-video-thumbnails"
import React, { useCallback, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
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
  } catch (e) {
    console.log("[thumbnail] error for", filename, e)
    return null
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SavedVideosScreen() {
  const router = useRouter()
  const [videos, setVideos] = useState<VideoItem[]>(videoListCache)
  const [loading, setLoading] = useState(videoListCache.length === 0)
  const [selectedVideo, setSelectedVideo] = useState<VideoItem | null>(null)
  const [debugLines, setDebugLines] = useState<string[]>([])
  const [showDebug, setShowDebug] = useState(false)

  function dbg(msg: string) {
    console.log("[SavedVideos]", msg)
    setDebugLines((prev) => [...prev.slice(-80), msg])
  }

  useFocusEffect(
    useCallback(() => {
      loadVideos()
    }, [])
  )

  async function loadVideos() {
    dbg("loadVideos start")
    if (videoListCache.length === 0) setLoading(true)

    const files = await listSavedVideos()
    dbg(`listSavedVideos returned ${files.length} file(s)`)
    files.forEach((f) => dbg(`  → ${f.filename}`))
    files.forEach((f) => dbg(`    uri: ${f.uri}`))

    const initial: VideoItem[] = files.map(({ filename, uri }) => ({
      id: filename,
      uri,
      filename,
      thumbnail: thumbnailCache.get(filename) ?? null,
      blockType: extractBlockType(filename),
    }))

    videoListCache = initial
    setVideos(initial)
    setLoading(false)
    dbg(`videos set: ${initial.length}`)

    for (const item of initial) {
      if (thumbnailCache.has(item.filename)) {
        dbg(`thumb cached: ${item.filename}`)
        continue
      }
      dbg(`generating thumb for: ${item.filename}`)
      const thumb = await getThumbnail(item.filename, item.uri)
      dbg(`thumb result: ${thumb ? "ok" : "null"}`)
      if (thumb) {
        setVideos((prev) =>
          prev.map((v) => (v.id === item.id ? { ...v, thumbnail: thumb } : v))
        )
      }
    }
    dbg("loadVideos done")
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

  const renderItem = useCallback(
    ({ item, index }: { item: VideoItem; index: number }) => {
      const isLeftColumn = index % 2 === 0
      return (
        <Pressable
          style={[
            styles.card,
            isLeftColumn ? { marginRight: COLUMN_GAP / 2 } : { marginLeft: COLUMN_GAP / 2 },
          ]}
          onPress={() => setSelectedVideo(item)}
          onLongPress={() => handleDeleteVideo(item)}
        >
          {item.thumbnail ? (
            <Image source={{ uri: item.thumbnail }} style={styles.thumbnail} />
          ) : (
            <View style={styles.thumbnailPlaceholder}>
              <Text style={styles.thumbnailPlaceholderText}>▶</Text>
            </View>
          )}
          <View style={styles.cardOverlay}>
            <Text style={styles.blockTypeLabel} numberOfLines={1}>
              {formatBlockType(item.blockType)}
            </Text>
          </View>
        </Pressable>
      )
    },
    [handleDeleteVideo]
  )

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.backButton}>←</Text>
        </Pressable>
        <Pressable onLongPress={() => setShowDebug((v) => !v)}>
          <Text style={styles.title}>Saved Videos</Text>
        </Pressable>
        <View style={{ width: 32 }} />
      </View>

      {showDebug && (
        <View style={styles.debugPanel}>
          <Pressable onPress={() => setDebugLines([])}>
            <Text style={[styles.debugLine, { color: "#ff0", marginBottom: 4 }]}>
              [tap to clear — {debugLines.length} lines]
            </Text>
          </Pressable>
          <ScrollView style={{ maxHeight: 260 }}>
            {debugLines.map((line, i) => (
              <Text key={i} style={styles.debugLine}>{line}</Text>
            ))}
          </ScrollView>
        </View>
      )}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : videos.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No videos saved yet.</Text>
        </View>
      ) : (
        <FlatList
          data={videos}
          keyExtractor={(item) => item.id}
          numColumns={NUM_COLUMNS}
          renderItem={renderItem}
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
        />
      )}

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
  container: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SCREEN_PADDING,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  backButton: { fontSize: 22, opacity: 0.5, width: 32 },
  title: { fontSize: 18, fontWeight: "700" },
  grid: { padding: SCREEN_PADDING, paddingBottom: 40 },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: COLUMN_GAP,
    backgroundColor: "#111",
  },
  thumbnail: { width: "100%", height: "100%", borderRadius: 16 },
  thumbnailPlaceholder: {
    flex: 1,
    backgroundColor: "#1a1a1a",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbnailPlaceholderText: { fontSize: 28, color: "white", opacity: 0.4 },
  cardOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  blockTypeLabel: { color: "white", fontSize: 12, fontWeight: "600" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { fontSize: 15, opacity: 0.4 },
  debugPanel: {
    backgroundColor: "#111",
    padding: 10,
    margin: 10,
    borderRadius: 8,
  },
  debugLine: {
    color: "#0f0",
    fontSize: 11,
    fontFamily: "monospace",
    lineHeight: 16,
  },
})
