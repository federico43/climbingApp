import { C } from "@/utils/theme"
import { AthleteCustomizeWorkout } from "@/components/AthleteCustomizeWorkout"
import { ConsumeAuth } from "@/components/auth-context"
import { ScalePressable } from "@/components/ScalePressable"
import { ScreenGradient } from "@/components/ScreenGradient"
import { SubScreenHeader } from "@/components/SubScreenHeader"
import { useWorkoutContext } from "@/contexts/WorkoutContext"
import { deleteProtocol, listAthleteTemplates, ProtocolRow, sessionLinkFor } from "@/services/BoulderGraphService"
import { Ionicons } from "@expo/vector-icons"
import { useFocusEffect } from "@react-navigation/native"
import { useRouter } from "expo-router"
import { useCallback, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

function blockCount(p: ProtocolRow): { blocks: any[]; label: string } {
  let blocks: any[] = []
  try { blocks = JSON.parse(p.blocks) } catch {}
  return { blocks, label: `${blocks.length} block${blocks.length !== 1 ? "s" : ""}` }
}

// Settings › My workouts — every workout the athlete has: the coach's
// (start only) and their own picks from the shared library (edit / delete).
export default function MyWorkoutsScreen() {
  const { User } = ConsumeAuth()
  const router = useRouter()
  const workoutCtx = useWorkoutContext()
  const [templates, setTemplates] = useState<ProtocolRow[]>([])
  const [sortAsc, setSortAsc] = useState(false)
  const [customizing, setCustomizing] = useState<ProtocolRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  useFocusEffect(
    useCallback(() => {
      if (!User) return
      load()
    }, [User])
  )

  async function load() {
    try {
      setTemplates(await listAthleteTemplates(User!.$id, { migrate: false }))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  // Newest-first by default; the athlete can flip it.
  const sorted = [...templates].sort((a, b) =>
    sortAsc ? a.$createdAt.localeCompare(b.$createdAt) : b.$createdAt.localeCompare(a.$createdAt)
  )
  const coachWorkouts = sorted.filter((t) => t.source !== "library")
  const libraryWorkouts = sorted.filter((t) => t.source === "library")

  function confirmDelete(p: ProtocolRow) {
    Alert.alert("Delete workout", `Delete "${p.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try {
            await deleteProtocol(p.$id)
            setTemplates((prev) => prev.filter((x) => x.$id !== p.$id))
          } catch (e: any) { Alert.alert("Error", e?.message ?? "Could not delete the workout.") }
        },
      },
    ])
  }

  function openMenu(p: ProtocolRow) {
    Alert.alert(p.name, undefined, [
      { text: "Edit", onPress: () => setCustomizing(p) },
      { text: "Delete", style: "destructive", onPress: () => confirmDelete(p) },
      { text: "Cancel", style: "cancel" },
    ])
  }

  return (
    <ScreenGradient>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <SubScreenHeader
          title="My workouts"
          right={
            <Pressable
              onPress={() => setSortAsc((prev) => !prev)}
              hitSlop={8}
              style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
            >
              <Ionicons name="swap-vertical" size={14} color={C.textSecondary} />
              <Text style={styles.sortText}>{sortAsc ? "Oldest first" : "Newest first"}</Text>
            </Pressable>
          }
        />

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={C.green} />
        ) : (
          <ScrollView
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={async () => {
                  setRefreshing(true)
                  try { await load() }
                  finally { setRefreshing(false) }
                }}
                tintColor={C.green}
                colors={[C.green]}
              />
            }
          >
            {/* ── From the coach ─────────────────────────────────────────── */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>From your coach</Text>
              {coachWorkouts.length > 0 ? (
                coachWorkouts.map((t) => {
                  const { blocks, label } = blockCount(t)
                  return (
                    <ScalePressable
                      key={t.$id}
                      style={styles.card}
                      onPress={() => workoutCtx.openWorkout(blocks, t.name, sessionLinkFor(t))}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.cardTitle}>{t.name}</Text>
                        <Text style={styles.cardSub}>{label} · Tap to start</Text>
                      </View>
                      <Text style={styles.cardArrow}>›</Text>
                    </ScalePressable>
                  )
                })
              ) : (
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>No workouts yet</Text>
                </View>
              )}
            </View>

            {/* ── From the library (athlete's own picks) ─────────────────── */}
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>From the library</Text>
                <Pressable
                  onPress={() => router.push("/(tabs)/(buttonTabs)/workout-library" as any)}
                  hitSlop={8}
                  style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                >
                  <Text style={styles.linkText}>Browse library</Text>
                  <Text style={styles.linkArrow}>›</Text>
                </Pressable>
              </View>
              {libraryWorkouts.length > 0 ? (
                libraryWorkouts.map((t) => {
                  const { blocks, label } = blockCount(t)
                  return (
                    <View key={t.$id} style={styles.card}>
                      <ScalePressable
                        style={{ flex: 1 }}
                        onPress={() => workoutCtx.openWorkout(blocks, t.name, sessionLinkFor(t))}
                      >
                        <Text style={styles.cardTitle}>{t.name}</Text>
                        <Text style={styles.cardSub}>{label} · Tap to start</Text>
                      </ScalePressable>
                      <Pressable onPress={() => openMenu(t)} hitSlop={8}>
                        <Ionicons name="ellipsis-vertical" size={18} color={C.textSecondary} />
                      </Pressable>
                    </View>
                  )
                })
              ) : (
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>Nothing picked from the library yet</Text>
                </View>
              )}
            </View>
          </ScrollView>
        )}
      </SafeAreaView>

      {customizing && User && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setCustomizing(null)}>
          <AthleteCustomizeWorkout
            athleteId={User.$id}
            protocol={customizing}
            onClose={() => setCustomizing(null)}
            onSaved={load}
          />
        </Modal>
      )}
    </ScreenGradient>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "transparent" },
  scroll: { paddingHorizontal: 16, paddingBottom: 40, gap: 20 },
  section: { backgroundColor: C.surface, borderRadius: 18, padding: 16, gap: 12 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: C.textPrimary },
  sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sortText: { fontSize: 12.5, fontWeight: "600", color: C.textSecondary },
  linkText: { fontSize: 13, fontWeight: "600", color: C.green },
  linkArrow: { fontSize: 15, fontWeight: "700", color: C.green },
  card: {
    backgroundColor: C.surfaceHigh,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: C.green,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
  },
  cardTitle: { fontSize: 16, fontWeight: "700", color: C.textPrimary, marginBottom: 4 },
  cardSub: { fontSize: 13, color: C.textSecondary },
  cardArrow: { fontSize: 26, color: C.green, marginLeft: 12 },
  empty: { backgroundColor: C.surfaceHigh, borderRadius: 14, padding: 16, alignItems: "center" },
  emptyText: { fontSize: 14, color: C.textMuted },
})
