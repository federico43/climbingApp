import { C } from "@/utils/theme"
import { ScalePressable } from "@/components/ScalePressable"
import { ScreenEntry } from "@/components/ScreenEntry"
import { ScreenGradient } from "@/components/ScreenGradient"
import { AthleteAnalytics } from "@/components/AthleteAnalytics"
import { AthleteVideos } from "@/components/AthleteVideos"
import { AthleteWorkoutBuilder } from "@/components/AthleteWorkoutBuilder"
import { TrainingTimeline } from "@/components/TrainingTimeline"
import { AppUser, ProtocolRow, getAssignedProtocol, getAthletes } from "@/services/BoulderGraphService"
import { useWorkoutContext } from "@/contexts/WorkoutContext"
import { Ionicons } from "@expo/vector-icons"
import { useFocusEffect, useRouter } from "expo-router"
import { useCallback, useEffect, useState } from "react"
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

// Top-bar coach tools (the former big cards). Assignments is gone — its review
// part is now the inline Training timeline.
type Tool = { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; route: string }
const TOOLS: Tool[] = [
  { key: "protocols", label: "Protocols", icon: "clipboard-outline", route: "/(tabs)/(buttonTabs)/protocolDesigner" },
  { key: "exercises", label: "Exercises", icon: "barbell-outline", route: "/(tabs)/(buttonTabs)/exercises" },
  { key: "spraywall", label: "Spray Wall", icon: "grid-outline", route: "/(tabs)/(buttonTabs)/sprayWall" },
]

export default function DesignScreen() {
  const router = useRouter()
  const workoutCtx = useWorkoutContext()
  const { width } = useWindowDimensions()
  const isWide = width >= 900
  const [athletes, setAthletes] = useState<AppUser[]>([])
  const [loadingAthletes, setLoadingAthletes] = useState(true)
  const [selected, setSelected] = useState<AppUser | null>(null)
  const [building, setBuilding] = useState(false)
  const [editProtocol, setEditProtocol] = useState<ProtocolRow | null>(null)
  const [assigned, setAssigned] = useState<ProtocolRow | null>(null)
  const [loadingAssigned, setLoadingAssigned] = useState(false)

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      getAthletes()
        .then((list) => { if (!cancelled) setAthletes(list) })
        .catch(console.error)
        .finally(() => { if (!cancelled) setLoadingAthletes(false) })
      return () => { cancelled = true }
    }, [])
  )

  // Load the selected athlete's currently-assigned workout.
  const loadAssigned = useCallback(() => {
    if (!selected) { setAssigned(null); return }
    setLoadingAssigned(true)
    getAssignedProtocol(selected.$id)
      .then(setAssigned)
      .catch((e) => { console.error(e); setAssigned(null) })
      .finally(() => setLoadingAssigned(false))
  }, [selected])

  useEffect(() => { loadAssigned() }, [loadAssigned])

  // Run the assigned workout in the player (same as the protocols "Test").
  function handleTest() {
    if (!assigned) return
    let blocks: any[] = []
    try { blocks = assigned.blocks ? JSON.parse(assigned.blocks) : [] } catch {}
    if (blocks.length === 0) { Alert.alert("Empty workout", "This workout has no blocks to test."); return }
    workoutCtx.openWorkout(blocks, assigned.name)
  }

  return (
    <ScreenGradient>
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenEntry>
        {/* ── Top bar ─────────────────────────────────────────────────────── */}
        <View style={styles.topBar}>
          {TOOLS.map((t) => (
            <ScalePressable key={t.key} style={styles.toolBtn} onPress={() => router.push(t.route as any)}>
              <Ionicons name={t.icon} size={20} color={C.green} />
              <Text style={styles.toolLabel}>{t.label}</Text>
            </ScalePressable>
          ))}
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* ── Training timeline ─────────────────────────────────────────── */}
          <TrainingTimeline />

          {/* ── Athletes ──────────────────────────────────────────────────── */}
          <View style={styles.athleteSection}>
            <Text style={styles.label}>Athletes</Text>
            {loadingAthletes ? (
              <ActivityIndicator style={{ marginVertical: 14 }} color={C.green} />
            ) : athletes.length === 0 ? (
              <Text style={styles.empty}>No athletes yet.</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
                {athletes.map((a) => {
                  const name = a.username ?? a.$id
                  const isSel = selected?.$id === a.$id
                  return (
                    <ScalePressable key={a.$id} style={styles.chip} onPress={() => setSelected(isSel ? null : a)}>
                      <View style={[styles.avatar, isSel && styles.avatarSel]}>
                        <Text style={[styles.avatarInitial, isSel && styles.avatarInitialSel]}>{name[0].toUpperCase()}</Text>
                      </View>
                      <Text style={[styles.chipName, isSel && styles.chipNameSel]} numberOfLines={1}>{name}</Text>
                    </ScalePressable>
                  )
                })}
              </ScrollView>
            )}
          </View>

          {/* ── Selected athlete data ─────────────────────────────────────── */}
          {selected ? (
            <>
              {/* Assigned workout */}
              <View style={styles.workoutSection}>
                <Text style={styles.label}>Assigned workout</Text>
                {loadingAssigned ? (
                  <ActivityIndicator style={{ marginVertical: 14 }} color={C.green} />
                ) : assigned ? (
                  <View style={styles.workoutCard}>
                    <View style={styles.workoutNameCol}>
                      <Text style={styles.workoutName} numberOfLines={1}>{assigned.name}</Text>
                      <Text style={styles.workoutMeta}>{blockCount(assigned)} block{blockCount(assigned) !== 1 ? "s" : ""}</Text>
                    </View>
                    {/* Block-name preview, in order */}
                    <View style={styles.previewWrap}>
                      {blockNames(assigned).map((n, i) => (
                        <View key={i} style={styles.previewChip}>
                          <Text style={styles.previewIndex}>{i + 1}</Text>
                          <Text style={styles.previewChipText} numberOfLines={1}>{n}</Text>
                        </View>
                      ))}
                    </View>
                    {isWide && (
                      <View style={styles.workoutActions}>
                        <Pressable style={styles.testBtn} onPress={handleTest}>
                          <Ionicons name="play" size={16} color={C.bg} />
                          <Text style={styles.testBtnText}>Test</Text>
                        </Pressable>
                        <Pressable style={styles.editBtn} onPress={() => { setEditProtocol(assigned); setBuilding(true) }}>
                          <Ionicons name="create-outline" size={16} color={C.green} />
                          <Text style={styles.editBtnText}>Edit</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                ) : (
                  <View style={styles.workoutCard}>
                    <Text style={styles.workoutMeta}>No workout assigned yet.</Text>
                    {isWide && (
                      <Pressable style={styles.addBtnSmall} onPress={() => { setEditProtocol(null); setBuilding(true) }}>
                        <Ionicons name="add" size={16} color={C.bg} />
                        <Text style={styles.addBtnSmallText}>Add workout</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>

              <AthleteVideos key={`vids-${selected.$id}`} athlete={selected} />
              <AthleteAnalytics key={selected.$id} athlete={selected} />
            </>
          ) : (
            <View style={styles.prompt}>
              <Text style={styles.promptText}>Pick an athlete to see their training history</Text>
            </View>
          )}

          <View style={{ height: 32 }} />
        </ScrollView>
      </ScreenEntry>

      {selected && (
        <Modal visible={building} transparent animationType="fade" onRequestClose={() => setBuilding(false)}>
          <AthleteWorkoutBuilder
            athlete={selected}
            roster={athletes}
            protocol={editProtocol}
            onClose={() => setBuilding(false)}
            onSaved={loadAssigned}
          />
        </Modal>
      )}
    </SafeAreaView>
    </ScreenGradient>
  )
}

// Number of blocks in a protocol's serialized blocks JSON.
function blockCount(p: ProtocolRow): number {
  try { return JSON.parse(p.blocks ?? "[]").length } catch { return 0 }
}

const BLOCK_TYPE_LABEL: Record<string, string> = {
  project_bouldering: "Project", constraint_warmup: "Warmup", strength_conditioning: "S&C",
  exploration_session: "Explore", sequence: "Sequence", free_session: "Free",
  four_by_four: "4×4", intervals: "Intervals",
}

// Block names in workout order (custom name, else a short type label).
function blockNames(p: ProtocolRow): string[] {
  try {
    return (JSON.parse(p.blocks ?? "[]") as any[]).map(
      (b) => (b?.blockName ?? "").toString().trim() || BLOCK_TYPE_LABEL[b?.type] || b?.type || "Block"
    )
  } catch { return [] }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "transparent" },

  workoutSection: { gap: 8 },
  workoutCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  workoutNameCol: { maxWidth: 200 },
  workoutName: { fontSize: 16, fontWeight: "700", color: C.textPrimary },
  workoutMeta: { fontSize: 13, color: C.textSecondary, marginTop: 2 },

  previewWrap: { flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, paddingHorizontal: 12 },
  previewChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: C.surfaceHigh, borderRadius: 8, paddingLeft: 6, paddingRight: 9, paddingVertical: 4,
  },
  previewIndex: { fontSize: 10, fontWeight: "800", color: C.green },
  previewChipText: { fontSize: 11, color: C.textSecondary, fontWeight: "600", maxWidth: 120 },
  workoutActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  testBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: C.green, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8,
  },
  testBtnText: { fontSize: 14, fontWeight: "800", color: C.bg },
  editBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    borderWidth: 1, borderColor: C.green, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8,
  },
  editBtnText: { fontSize: 14, fontWeight: "700", color: C.green },
  addBtnSmall: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: C.green, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8,
  },
  addBtnSmallText: { fontSize: 14, fontWeight: "800", color: C.bg },

  topBar: {
    flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  toolBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    paddingVertical: 10,
  },
  toolLabel: { fontSize: 13, fontWeight: "700", color: C.textPrimary },

  scroll: { paddingHorizontal: 16, paddingTop: 14, gap: 16 },

  athleteSection: { gap: 8 },
  label: { fontSize: 13, fontWeight: "700", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.6 },
  strip: { gap: 14, paddingVertical: 2, paddingHorizontal: 2 },
  chip: { alignItems: "center", width: 64, gap: 6 },
  avatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: C.surfaceHigh, borderWidth: 2, borderColor: "transparent",
    alignItems: "center", justifyContent: "center",
  },
  avatarSel: { backgroundColor: C.green, borderColor: C.green },
  avatarInitial: { fontSize: 22, fontWeight: "800", color: C.green },
  avatarInitialSel: { color: C.bg },
  chipName: { fontSize: 12, color: C.textSecondary, fontWeight: "600", maxWidth: 64, textAlign: "center" },
  chipNameSel: { color: C.green, fontWeight: "700" },
  empty: { fontSize: 14, color: C.textMuted, paddingVertical: 8 },

  prompt: { alignItems: "center", paddingVertical: 30, paddingHorizontal: 24 },
  promptText: { fontSize: 14, color: C.textMuted, textAlign: "center" },
})
