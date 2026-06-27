import { C } from "@/utils/theme"
import { ScalePressable } from "@/components/ScalePressable"
import { ScreenEntry } from "@/components/ScreenEntry"
import { ScreenGradient } from "@/components/ScreenGradient"
import { AthleteAnalytics } from "@/components/AthleteAnalytics"
import { AthleteVideos } from "@/components/AthleteVideos"
import { AthleteWorkoutBuilder } from "@/components/AthleteWorkoutBuilder"
import { TrainingTimeline } from "@/components/TrainingTimeline"
import {
  AppUser,
  MAX_ATHLETE_TEMPLATES,
  ProtocolRow,
  assignProtocol,
  copyProtocolToAthlete,
  deleteProtocol,
  getAthletes,
  listAthleteTemplates,
  unassignProtocol,
} from "@/services/BoulderGraphService"
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
  // The selected athlete's templates + which one is "today's training".
  const [templates, setTemplates] = useState<ProtocolRow[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [todayId, setTodayId] = useState<string | null>(null)
  // Copy-to-athlete modal state.
  const [copyFor, setCopyFor] = useState<ProtocolRow | null>(null)
  const [copyTargets, setCopyTargets] = useState<Set<string>>(new Set())
  const [copying, setCopying] = useState(false)

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

  // Load the selected athlete's templates (and which is today's training).
  const loadTemplates = useCallback(() => {
    if (!selected) { setTemplates([]); setTodayId(null); return }
    setLoadingTemplates(true)
    setTodayId(selected.assignedProtocolId ?? null)
    listAthleteTemplates(selected.$id)
      .then(setTemplates)
      .catch((e) => { console.error(e); setTemplates([]) })
      .finally(() => setLoadingTemplates(false))
  }, [selected])

  useEffect(() => { loadTemplates() }, [loadTemplates])

  const atCap = templates.length >= MAX_ATHLETE_TEMPLATES

  function openAdd() { setEditProtocol(null); setBuilding(true) }

  function handleTest(p: ProtocolRow) {
    let blocks: any[] = []
    try { blocks = p.blocks ? JSON.parse(p.blocks) : [] } catch {}
    if (blocks.length === 0) { Alert.alert("Empty workout", "This workout has no blocks to test."); return }
    workoutCtx.openWorkout(blocks, p.name)
  }

  async function markToday(p: ProtocolRow) {
    if (!selected) return
    try { await assignProtocol(selected.$id, p.$id); setTodayId(p.$id) }
    catch (e: any) { Alert.alert("Error", e?.message ?? "Could not set today's training.") }
  }

  function confirmDelete(p: ProtocolRow) {
    Alert.alert("Delete template", `Delete "${p.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          if (!selected) return
          try {
            await deleteProtocol(p.$id)
            if (todayId === p.$id) { await unassignProtocol(selected.$id); setTodayId(null) }
            setTemplates((prev) => prev.filter((x) => x.$id !== p.$id))
          } catch (e: any) { Alert.alert("Error", e?.message ?? "Could not delete the template.") }
        },
      },
    ])
  }

  // ⋮ menu on a template card.
  function openMenu(p: ProtocolRow) {
    const opts: any[] = []
    if (todayId !== p.$id) opts.push({ text: "Set as today's training", onPress: () => markToday(p) })
    opts.push({ text: "Copy to another athlete", onPress: () => { setCopyFor(p); setCopyTargets(new Set()) } })
    opts.push({ text: "Delete", style: "destructive", onPress: () => confirmDelete(p) })
    opts.push({ text: "Cancel", style: "cancel" })
    Alert.alert(p.name, undefined, opts)
  }

  async function doCopy() {
    if (!copyFor) return
    const ids = [...copyTargets]
    if (ids.length === 0) { setCopyFor(null); return }
    setCopying(true)
    try {
      const skipped: string[] = []
      let copied = 0
      for (const id of ids) {
        if ((await listAthleteTemplates(id)).length >= MAX_ATHLETE_TEMPLATES) {
          skipped.push(athletes.find((a) => a.$id === id)?.username ?? id)
          continue
        }
        await copyProtocolToAthlete(copyFor, id)
        copied++
      }
      setCopyFor(null)
      Alert.alert(
        "Copy complete",
        `Copied to ${copied} athlete${copied !== 1 ? "s" : ""}.` +
          (skipped.length ? `\nSkipped (already at ${MAX_ATHLETE_TEMPLATES}): ${skipped.join(", ")}.` : ""),
      )
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not copy the template.")
    } finally {
      setCopying(false)
    }
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
              {/* Templates (this athlete's own protocols, max 4) */}
              <View style={styles.workoutSection}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.label}>Templates · {templates.length}/{MAX_ATHLETE_TEMPLATES}</Text>
                  {!atCap && (
                    <Pressable style={styles.addBtnSmall} onPress={openAdd}>
                      <Ionicons name="add" size={16} color={C.bg} />
                      <Text style={styles.addBtnSmallText}>Add</Text>
                    </Pressable>
                  )}
                </View>

                {loadingTemplates ? (
                  <ActivityIndicator style={{ marginVertical: 14 }} color={C.green} />
                ) : templates.length === 0 ? (
                  <View style={styles.workoutCard}>
                    <Text style={styles.workoutMeta}>No templates yet — add one to get started.</Text>
                  </View>
                ) : (
                  templates.map((p) => {
                    const isToday = todayId === p.$id
                    return (
                      <View key={p.$id} style={[styles.workoutCard, isToday && styles.workoutCardToday, !isWide && styles.workoutCardNarrow]}>
                        <View style={[styles.workoutNameCol, isWide && styles.nameColWide]}>
                          <View style={styles.nameRow}>
                            <Text style={styles.workoutName} numberOfLines={1}>{p.name}</Text>
                            {isToday && <Text style={styles.todayBadge}>TODAY</Text>}
                          </View>
                          <Text style={styles.workoutMeta}>{blockCount(p)} block{blockCount(p) !== 1 ? "s" : ""}</Text>
                        </View>
                        <View style={[styles.previewWrap, isWide && styles.previewWrapWide]}>
                          {blockNames(p).map((n, i) => (
                            <View key={i} style={styles.previewChip}>
                              <Text style={styles.previewIndex}>{i + 1}</Text>
                              <Text style={styles.previewChipText} numberOfLines={1}>{n}</Text>
                            </View>
                          ))}
                        </View>
                        <View style={styles.workoutActions}>
                          <Pressable style={styles.testBtn} onPress={() => handleTest(p)}>
                            <Ionicons name="play" size={16} color={C.bg} />
                            <Text style={styles.testBtnText}>Test</Text>
                          </Pressable>
                          <Pressable style={styles.editBtn} onPress={() => { setEditProtocol(p); setBuilding(true) }}>
                            <Ionicons name="create-outline" size={16} color={C.green} />
                            <Text style={styles.editBtnText}>Edit</Text>
                          </Pressable>
                          <Pressable style={styles.menuBtn} onPress={() => openMenu(p)} hitSlop={6}>
                            <Ionicons name="ellipsis-vertical" size={18} color={C.textSecondary} />
                          </Pressable>
                        </View>
                      </View>
                    )
                  })
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
            assignAsToday={!editProtocol && templates.length === 0}
            onClose={() => setBuilding(false)}
            onSaved={loadTemplates}
          />
        </Modal>
      )}

      {/* Copy a template to other athletes */}
      <Modal visible={copyFor !== null} transparent animationType="fade" onRequestClose={() => setCopyFor(null)}>
        <Pressable style={styles.copyBackdrop} onPress={() => setCopyFor(null)}>
          <Pressable style={styles.copyCard} onPress={() => {}}>
            <Text style={styles.copyTitle} numberOfLines={1}>Copy “{copyFor?.name}” to</Text>
            <Text style={styles.copySub}>Each athlete gets their own copy (max {MAX_ATHLETE_TEMPLATES} each).</Text>
            <View style={styles.copyPills}>
              {athletes.filter((a) => a.$id !== selected?.$id).length === 0 ? (
                <Text style={styles.workoutMeta}>No other athletes.</Text>
              ) : athletes.filter((a) => a.$id !== selected?.$id).map((a) => {
                const sel = copyTargets.has(a.$id)
                return (
                  <Pressable
                    key={a.$id}
                    style={[styles.copyPill, sel && styles.copyPillSel]}
                    onPress={() => setCopyTargets((prev) => {
                      const n = new Set(prev); n.has(a.$id) ? n.delete(a.$id) : n.add(a.$id); return n
                    })}
                  >
                    <Text style={[styles.copyPillText, sel && styles.copyPillTextSel]}>{a.username ?? a.$id}</Text>
                  </Pressable>
                )
              })}
            </View>
            <Pressable
              style={[styles.copyConfirm, (copyTargets.size === 0 || copying) && { opacity: 0.5 }]}
              disabled={copyTargets.size === 0 || copying}
              onPress={doCopy}
            >
              {copying ? <ActivityIndicator color={C.bg} /> : (
                <Text style={styles.copyConfirmText}>
                  Copy to {copyTargets.size || ""} athlete{copyTargets.size !== 1 ? "s" : ""}
                </Text>
              )}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
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
  sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  workoutCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  workoutCardToday: { borderColor: C.green, backgroundColor: C.surfaceHigh },
  workoutCardNarrow: { flexDirection: "column", alignItems: "stretch", gap: 12 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  todayBadge: {
    fontSize: 10, fontWeight: "800", color: C.bg, backgroundColor: C.green,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: "hidden",
  },
  menuBtn: { paddingHorizontal: 4, paddingVertical: 8 },
  workoutNameCol: {},
  nameColWide: { maxWidth: 200 },
  workoutName: { fontSize: 16, fontWeight: "700", color: C.textPrimary },
  workoutMeta: { fontSize: 13, color: C.textSecondary, marginTop: 2 },

  previewWrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  previewWrapWide: { flex: 1, paddingHorizontal: 12 },
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

  // Copy-to-athlete modal
  copyBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 24 },
  copyCard: { width: "100%", maxWidth: 420, backgroundColor: C.surface, borderRadius: 18, padding: 20, gap: 8 },
  copyTitle: { fontSize: 18, fontWeight: "800", color: C.textPrimary },
  copySub: { fontSize: 13, color: C.textSecondary, marginBottom: 8 },
  copyPills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  copyPill: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, backgroundColor: C.surfaceHigh, borderWidth: 1, borderColor: C.border },
  copyPillSel: { backgroundColor: C.green, borderColor: C.green },
  copyPillText: { fontSize: 14, fontWeight: "600", color: C.textSecondary },
  copyPillTextSel: { color: C.bg },
  copyConfirm: { backgroundColor: C.green, borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  copyConfirmText: { fontSize: 15, fontWeight: "800", color: C.bg },

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
