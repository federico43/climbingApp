import { C } from "@/utils/theme"
import { AppUser } from "@/services/BoulderGraphService"
import { VideoRow, deleteVideo, getFeedbackForAthlete, getVideosByUserId } from "@/services/videoStorage"
import { VideoPlayerModal } from "@/components/VideoPlayerModal"
import { Ionicons } from "@expo/vector-icons"
import * as VideoThumbnails from "expo-video-thumbnails"
import { useEffect, useState } from "react"
import { ActivityIndicator, Alert, Image, Modal, Pressable, StyleSheet, Text, View } from "react-native"

function formatBlockType(type?: string | null): string {
  if (!type) return "Clip"
  return type.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" })
}

// Thumbnails are generated from the remote R2 URL once and cached across
// re-selections (keyed by the video row id).
const thumbCache = new Map<string, string>()

async function makeThumb(id: string, url: string): Promise<string | null> {
  if (thumbCache.has(id)) return thumbCache.get(id)!
  try {
    const result = await Promise.race([
      VideoThumbnails.getThumbnailAsync(url, { time: 1000, quality: 0.5 }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
    ])
    const uri = (result as any)?.uri ?? null
    if (uri) thumbCache.set(id, uri)
    return uri
  } catch {
    return null
  }
}

// Coach view: the selected athlete's submitted clips (auto-uploaded from their
// training). Tap to play. Silently hidden when there are no clips (or the
// videos backend isn't configured yet).
export function AthleteVideos({ athlete }: { athlete: AppUser }) {
  const [videos, setVideos] = useState<VideoRow[]>([])
  const [loading, setLoading] = useState(true)
  // Tapping a card opens it to just watch; tapping the pencil badge opens the
  // same viewer straight into the feedback flow. One modal, one component.
  const [viewing, setViewing] = useState<{ video: VideoRow; startInFeedbackMode: boolean } | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [feedbackVideoIds, setFeedbackVideoIds] = useState<Set<string>>(new Set())

  function refreshFeedbackIds() {
    getFeedbackForAthlete(athlete.$id)
      .then((rows) => setFeedbackVideoIds(new Set(rows.map((r) => r.videoId))))
      .catch((e: any) => console.warn("[feedback] getFeedbackForAthlete failed:", e?.message ?? e))
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getVideosByUserId(athlete.$id)
      .then((v) => {
        if (cancelled) return
        setVideos(v)
        // Seed from cache, then generate the rest in parallel — the grid
        // renders now with play-icon placeholders for whatever isn't cached
        // yet. This used to await each thumbnail one at a time (each with a
        // 6s worst-case timeout), so a coach with a few dozen clips could
        // stare at a blank spinner for minutes before seeing anything.
        const seeded: Record<string, string> = {}
        const toGenerate: VideoRow[] = []
        for (const row of v) {
          const c = thumbCache.get(row.$id)
          if (c) seeded[row.$id] = c
          else toGenerate.push(row)
        }
        setThumbs(seeded)
        Promise.all(
          toGenerate.map(async (row) => {
            const t = await makeThumb(row.$id, row.url)
            if (!cancelled && t) setThumbs((prev) => ({ ...prev, [row.$id]: t }))
          })
        )
      })
      .catch((e) => { console.error(e); if (!cancelled) setVideos([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    refreshFeedbackIds()
    return () => { cancelled = true }
  }, [athlete.$id])

  function handleDelete(v: VideoRow) {
    Alert.alert("Remove clip", "Remove this clip from the athlete's submissions?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteVideo(v)
            thumbCache.delete(v.$id)
            setVideos((prev) => prev.filter((x) => x.$id !== v.$id))
          } catch (e: any) {
            Alert.alert("Error", e?.message ?? "Could not remove the clip.")
          }
        },
      },
    ])
  }

  if (loading) {
    return <ActivityIndicator style={{ marginVertical: 14 }} color={C.green} />
  }
  if (videos.length === 0) return null

  return (
    <View style={styles.section}>
      <Text style={styles.label}>Submitted clips · {videos.length}</Text>
      <Text style={styles.hint}>Tap to play · pencil icon to give feedback · long-press to remove</Text>
      <View style={styles.grid}>
        {videos.map((v) => (
          <Pressable
            key={v.$id}
            style={styles.card}
            onPress={() => setViewing({ video: v, startInFeedbackMode: false })}
            onLongPress={() => handleDelete(v)}
          >
            <View style={styles.thumb}>
              {thumbs[v.$id] ? (
                <Image source={{ uri: thumbs[v.$id] }} style={styles.thumbImg} />
              ) : null}
              <View style={styles.playBadge}>
                <Ionicons name="play" size={16} color="#fff" />
              </View>
              {v.imported && (
                <View style={styles.importedBadge}>
                  <Ionicons name="download-outline" size={14} color="#fff" />
                </View>
              )}
              <Pressable
                style={styles.feedbackBadge}
                hitSlop={6}
                onPress={(e) => { e.stopPropagation(); setViewing({ video: v, startInFeedbackMode: true }) }}
              >
                <Ionicons name={feedbackVideoIds.has(v.$id) ? "checkmark-circle" : "create-outline"} size={16} color="#fff" />
              </Pressable>
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardLabel} numberOfLines={1}>
                {v.projectName || formatBlockType(v.blockType)}
              </Text>
              <Text style={styles.cardMeta} numberOfLines={1}>
                {[v.grade, formatDate(v.$createdAt)].filter(Boolean).join(" · ")}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>

      {viewing && (
        <Modal
          visible
          animationType="slide"
          presentationStyle="fullScreen"
          onRequestClose={() => setViewing(null)}
          statusBarTranslucent
        >
          <VideoPlayerModal
            uri={viewing.video.url}
            title={viewing.video.projectName || formatBlockType(viewing.video.blockType)}
            onClose={() => setViewing(null)}
            video={viewing.video}
            canGiveFeedback
            startInFeedbackMode={viewing.startInFeedbackMode}
            onFeedbackSent={refreshFeedbackIds}
          />
        </Modal>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  label: { fontSize: 13, fontWeight: "700", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.6 },
  hint: { fontSize: 11, color: C.textMuted, marginTop: -4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  card: {
    width: "31%", flexGrow: 1,
    backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    overflow: "hidden",
  },
  thumb: { height: 100, alignItems: "center", justifyContent: "center", backgroundColor: C.surfaceHigh },
  thumbImg: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  playBadge: {
    width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)", paddingLeft: 2,
  },
  feedbackBadge: {
    position: "absolute", top: 6, right: 6,
    width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  importedBadge: {
    position: "absolute", top: 6, left: 6,
    width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  cardBody: { padding: 10, gap: 2 },
  cardLabel: { fontSize: 13, fontWeight: "700", color: C.textPrimary },
  cardMeta: { fontSize: 11, color: C.textSecondary },
})
