import { C } from "@/utils/theme"
import { AppUser } from "@/services/BoulderGraphService"
import { VideoRow, getVideosByUserId } from "@/services/videoStorage"
import { VideoPlayerModal } from "@/components/VideoPlayerModal"
import { Ionicons } from "@expo/vector-icons"
import { useEffect, useState } from "react"
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native"

function formatBlockType(type?: string | null): string {
  if (!type) return "Clip"
  return type.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" })
}

// Coach view: the selected athlete's submitted clips (auto-uploaded from their
// training). Tap to play. Silently hidden when there are no clips (or the
// videos backend isn't configured yet).
export function AthleteVideos({ athlete }: { athlete: AppUser }) {
  const [videos, setVideos] = useState<VideoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<VideoRow | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getVideosByUserId(athlete.$id)
      .then((v) => { if (!cancelled) setVideos(v) })
      .catch((e) => { console.error(e); if (!cancelled) setVideos([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [athlete.$id])

  if (loading) {
    return <ActivityIndicator style={{ marginVertical: 14 }} color={C.green} />
  }
  if (videos.length === 0) return null

  return (
    <View style={styles.section}>
      <Text style={styles.label}>Submitted clips · {videos.length}</Text>
      <View style={styles.grid}>
        {videos.map((v) => (
          <Pressable key={v.$id} style={styles.card} onPress={() => setSelected(v)}>
            <View style={styles.thumb}>
              <Ionicons name="play" size={26} color={C.green} />
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

      <Modal
        visible={selected !== null}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setSelected(null)}
        statusBarTranslucent
      >
        <VideoPlayerModal
          uri={selected?.url ?? null}
          title={selected ? (selected.projectName || formatBlockType(selected.blockType)) : ""}
          onClose={() => setSelected(null)}
        />
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  label: { fontSize: 13, fontWeight: "700", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.6 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  card: {
    width: "31%", flexGrow: 1,
    backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    overflow: "hidden",
  },
  thumb: { height: 90, alignItems: "center", justifyContent: "center", backgroundColor: C.surfaceHigh },
  cardBody: { padding: 10, gap: 2 },
  cardLabel: { fontSize: 13, fontWeight: "700", color: C.textPrimary },
  cardMeta: { fontSize: 11, color: C.textSecondary },
})
