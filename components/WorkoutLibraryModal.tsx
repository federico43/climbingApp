import { C } from "@/utils/theme"
import { ScalePressable } from "@/components/ScalePressable"
import { VideoPlayerModal } from "@/components/VideoPlayerModal"
import { deleteVideoFile, listSavedVideos } from "@/utils/saveVideo"
import * as VideoThumbnails from "expo-video-thumbnails"
import React, { useCallback, useEffect, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

// ─── Types & caches ───────────────────────────────────────────────────────────

interface VideoItem {
  id: string
  uri: string
  filename: string
  thumbnail: string | null
  blockType: string | null
}

// Module-level cache shared across openings of this modal
const thumbCache = new Map<string, string>()
let listCache: VideoItem[] = []

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NUM_COLUMNS = 2
const COLUMN_GAP = 12
const SCREEN_PADDING = 16
const CARD_WIDTH =
  (Dimensions.get("window").width - SCREEN_PADDING * 2 - COLUMN_GAP) / NUM_COLUMNS
const CARD_HEIGHT = CARD_WIDTH * 1.4

function extractBlockType(filename: string): string | null {
  const known = [
    "constraint_warmup",
    "project_bouldering",
    "strength_conditioning",
    "exploration_session",
  ]
  for (const type of known) {
    if (filename.includes(type)) return type
  }
  return null
}

function formatBlockType(type: string | null): string {
  if (!type) return "Climb"
  return type
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ")
}

async function getThumbnail(filename: string, uri: string): Promise<string | null> {
  if (thumbCache.has(filename)) return thumbCache.get(filename)!
  try {
    const result = await Promise.race([
      VideoThumbnails.getThumbnailAsync(uri, { time: 1000, quality: 0.5 }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
    ])
    const thumbUri = (result as any)?.uri ?? null
    if (thumbUri) thumbCache.set(filename, thumbUri)
    return thumbUri
  } catch {
    return null
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean
  onClose: () => void
}

export function WorkoutLibraryModal({ visible, onClose }: Props) {
  const [videos, setVideos] = useState<VideoItem[]>(listCache)
  const [loading, setLoading] = useState(listCache.length === 0)
  const [selectedVideo, setSelectedVideo] = useState<VideoItem | null>(null)

  useEffect(() => {
    if (visible) loadVideos()
  }, [visible])

  async function loadVideos() {
    if (listCache.length === 0) setLoading(true)

    const files = await listSavedVideos()
    const initial: VideoItem[] = files.map(({ filename, uri }) => ({
      id: filename,
      uri,
      filename,
      thumbnail: thumbCache.get(filename) ?? null,
      blockType: extractBlockType(filename),
    }))

    listCache = initial
    setVideos(initial)
    setLoading(false)

    for (const item of initial) {
      if (thumbCache.has(item.filename)) continue
      const thumb = await getThumbnail(item.filename, item.uri)
      if (thumb) {
        setVideos((prev) =>
          prev.map((v) => (v.id === item.id ? { ...v, thumbnail: thumb } : v))
        )
      }
    }
  }

  async function handleDelete(item: VideoItem) {
    Alert.alert("Delete video", "Remove this video permanently?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteVideoFile(item.filename)
          thumbCache.delete(item.filename)
          listCache = listCache.filter((v) => v.id !== item.id)
          setVideos((prev) => prev.filter((v) => v.id !== item.id))
        },
      },
    ])
  }

  const renderItem = useCallback(
    ({ item, index }: { item: VideoItem; index: number }) => {
      const isLeft = index % 2 === 0
      return (
        <ScalePressable
          style={[
            styles.card,
            isLeft ? { marginRight: COLUMN_GAP / 2 } : { marginLeft: COLUMN_GAP / 2 },
          ]}
          onPress={() => setSelectedVideo(item)}
          onLongPress={() => handleDelete(item)}
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
    },
    []
  )

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <SafeAreaView style={styles.safe} edges={["top"]}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.backBtn} hitSlop={12}>
            <Text style={styles.backArrow}>‹</Text>
          </Pressable>
          <Text style={styles.title}>Library</Text>
          <View style={{ width: 40 }} />
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={C.green} />
        ) : videos.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🎬</Text>
            <Text style={styles.emptyTitle}>No videos yet</Text>
            <Text style={styles.emptyText}>
              Record your attempts — they'll appear here.
            </Text>
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
      </SafeAreaView>

      {/* Video player nested modal */}
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
    </Modal>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: { width: 40 },
  backArrow: { fontSize: 34, color: C.textSecondary, lineHeight: 36 },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: C.textPrimary,
    textAlign: "center",
  },

  grid: { padding: SCREEN_PADDING, paddingBottom: 40 },

  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: COLUMN_GAP,
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
  emptyText: {
    fontSize: 14,
    color: C.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
})
