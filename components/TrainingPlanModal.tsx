import { C } from "@/utils/theme"
import { MOVEMENT_TYPES, MOVEMENT_TYPE_COLOR, MOVEMENT_TYPE_LABEL, MovementType, isJointPattern } from "@/utils/movementTypes"
import {
  DEFAULT_START_TYPE, EXERCISES_PER_PATTERN, MAIN_CYCLE, PLAN_FOCUSES, PLAN_FOCUS_LABEL, SC_PATTERN_MAX, SC_PATTERN_MIN, scPatternMax,
  localDateStr, mainTypeFor, mainTypeLabel, planEndFor, type MainType, type PlanFocus, type PlanKind, type ScPattern,
} from "@/utils/planRotation"
import { SPECIAL_CASE_EXERCISES } from "@/utils/scPlanBuilder"
import { FOCUS_LABEL } from "@/utils/scProgression"
import {
  ExerciseRow,
  TrainingPlanRow,
  createTrainingPlan,
  deleteTrainingPlan,
  listExercises,
  updateTrainingPlan,
} from "@/services/BoulderGraphService"
import DateTimePicker from "@react-native-community/datetimepicker"
import { useEffect, useMemo, useState } from "react"
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native"

// Coach-side training plan form (docs/training-plan.md §9): 6-week window,
// "Conditioning only" for athletes who can't climb (S&C only, no climbing
// focus — docs/conditioning-plan.md), one focus, and optional S&C — mobility yes/no, 1–4 movement patterns
// (none for mobility only), and 1–2 library exercises per pattern (with one,
// both weekly workouts use it; with a single pattern, both go in every
// workout, done by sets). Fingers has no picks: it always uses fixed exercises per S&C
// focus (SPECIAL_CASE_EXERCISES).

// Mobility is its own yes/no, not one of the patterns. Joints are listed on
// their own row.
const PICKABLE_PATTERNS = MOVEMENT_TYPES.filter((m) => m !== "mobility" && !isJointPattern(m))
const JOINT_PICKS = MOVEMENT_TYPES.filter((m) => isJointPattern(m))
const FIXED_PATTERNS = new Set<MovementType>(["carry_grip"])

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

interface Props {
  visible: boolean
  athleteId: string
  // Editing the active plan in place vs. starting a fresh one (archives
  // whatever's active, per training-plan semantics).
  mode: "edit" | "new"
  current: TrainingPlanRow | null // prefills the form in "edit" mode
  onClose: () => void
  onSaved: (plan: TrainingPlanRow) => void
  onDeleted?: (planId: string) => void
}

export function TrainingPlanModal({ visible, athleteId, mode, current, onClose, onSaved, onDeleted }: Props) {
  const [name, setName] = useState("")
  const [windowStart, setWindowStart] = useState(localDateStr(new Date()))
  const [pickerOpen, setPickerOpen] = useState(false)
  const [kind, setKind] = useState<PlanKind>("climbing")
  const [focus, setFocus] = useState<PlanFocus | null>(null)
  // Main type of workout 1; strength unless the coach picks another.
  const [startType, setStartType] = useState<MainType>(DEFAULT_START_TYPE)
  const [hasSc, setHasSc] = useState(false)
  const [hasMobility, setHasMobility] = useState(false)
  // Mobility exercises the coach chose; none = the app picks.
  const [mobilityIds, setMobilityIds] = useState<string[]>([])
  // In pick order — mp1…mp4.
  const [patterns, setPatterns] = useState<ScPattern[]>([])
  const [exercises, setExercises] = useState<ExerciseRow[]>([])
  const [saving, setSaving] = useState(false)
  // 4 on climbing plans, 6 on conditioning ones.
  const maxPatterns = scPatternMax(kind)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!visible) return
    listExercises().then(setExercises).catch(console.error)
    if (mode === "edit" && current) {
      setName(current.name ?? "")
      setWindowStart(current.windowStart)
      setKind(current.kind)
      setFocus(current.focus)
      setStartType(current.startType ?? DEFAULT_START_TYPE)
      setHasSc(current.hasSc)
      setHasMobility(current.hasMobility)
      setMobilityIds(current.mobilityIds)
      setPatterns(current.scPatterns)
    } else {
      setName("")
      setWindowStart(localDateStr(new Date()))
      setKind("climbing")
      setFocus(null)
      setStartType(DEFAULT_START_TYPE)
      setHasSc(false)
      setHasMobility(false)
      // A new plan starts from the athlete's current mobility picks.
      setMobilityIds(current?.mobilityIds ?? [])
      setPatterns([])
    }
    setPickerOpen(false)
  }, [visible, mode, current])

  // Editing keeps the plan's pauses, so its end stays pushed back by them.
  const windowEnd = planEndFor(windowStart, mode === "edit" ? current?.pauses : undefined)

  const exercisesByPattern = useMemo(() => {
    const out = new Map<string, ExerciseRow[]>()
    for (const e of exercises) {
      if (!e.movementType) continue
      out.set(e.movementType, [...(out.get(e.movementType) ?? []), e])
    }
    for (const list of out.values()) list.sort((a, b) => a.name.localeCompare(b.name))
    return out
  }, [exercises])
  const mobilityLibrary = exercisesByPattern.get("mobility") ?? []

  function togglePattern(m: MovementType) {
    setPatterns((prev) => {
      if (prev.some((p) => p.movementType === m)) return prev.filter((p) => p.movementType !== m)
      if (prev.length >= maxPatterns) return prev
      // Only one exercise in the library for this pattern → it's the pick.
      const available = exercisesByPattern.get(m) ?? []
      const exerciseIds = !FIXED_PATTERNS.has(m) && available.length === 1 ? [available[0].$id] : []
      return [...prev, { movementType: m, exerciseIds }]
    })
  }

  function toggleMobility(id: string) {
    setMobilityIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function toggleExercise(m: MovementType, id: string) {
    setPatterns((prev) => prev.map((p) => {
      if (p.movementType !== m) return p
      if (p.exerciseIds.includes(id)) return { ...p, exerciseIds: p.exerciseIds.filter((x) => x !== id) }
      if (p.exerciseIds.length >= EXERCISES_PER_PATTERN) return p
      return { ...p, exerciseIds: [...p.exerciseIds, id] }
    }))
  }

  function patternChip(m: MovementType) {
    const sel = patterns.some((p) => p.movementType === m)
    const count = (exercisesByPattern.get(m) ?? []).length
    const empty = count === 0 && !FIXED_PATTERNS.has(m)
    const full = !sel && patterns.length >= maxPatterns
    return (
      <Pressable
        key={m}
        style={[s.chip, sel && { backgroundColor: MOVEMENT_TYPE_COLOR[m], borderColor: MOVEMENT_TYPE_COLOR[m] }, (empty || full) && { opacity: 0.35 }]}
        onPress={() => togglePattern(m)}
        disabled={(empty || full) && !sel}
      >
        <Text style={[s.chipText, sel && s.chipTextSelected]}>
          {MOVEMENT_TYPE_LABEL[m]}{empty ? " · none" : ""}
        </Text>
      </Pressable>
    )
  }

  // What's still missing, in order — the first one is shown under the button.
  const conditioning = kind === "conditioning"
  // A conditioning plan is all S&C.
  const withSc = conditioning || hasSc
  const problems: string[] = []
  if (!conditioning && !focus) problems.push("Pick a focus")
  if (withSc) {
    if (patterns.length < SC_PATTERN_MIN && !hasMobility) problems.push("Pick at least 1 movement pattern, or turn on mobility")
    // Turning Conditioning only off with 5–6 picked.
    if (patterns.length > maxPatterns) problems.push(`Climbing plans take up to ${SC_PATTERN_MAX} movement patterns`)
    for (const p of patterns) {
      if (FIXED_PATTERNS.has(p.movementType)) continue
      if (p.exerciseIds.length === 0) problems.push(`Pick at least 1 ${MOVEMENT_TYPE_LABEL[p.movementType]} exercise`)
    }
  }
  const canSubmit = problems.length === 0

  async function handleSubmit() {
    if (!canSubmit || saving) return
    setSaving(true)
    try {
      const input = {
        name: name.trim() || `${formatDate(windowStart)} – ${formatDate(windowEnd)}`,
        windowStart,
        windowEnd,
        kind,
        focus: conditioning ? null : focus,
        // Picked once, when the plan starts — editing never changes it.
        ...(mode === "new" ? { startType } : {}),
        hasSc: withSc,
        hasMobility: withSc && hasMobility,
        // Only ids still in the library; kept when mobility is off, for next time.
        mobilityIds: mobilityLibrary.length === 0 ? mobilityIds : mobilityIds.filter((id) => mobilityLibrary.some((e) => e.$id === id)),
        scPatterns: withSc ? patterns : [],
      }
      const plan = mode === "edit" && current
        ? await updateTrainingPlan(current, input)
        : await createTrainingPlan(athleteId, input)
      onSaved(plan)
      onClose()
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not save the training plan.")
    } finally {
      setSaving(false)
    }
  }

  function handleDelete() {
    if (!current) return
    Alert.alert(
      "Delete training plan",
      `Delete "${current.name}"? Workouts already built from it are kept.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: async () => {
            setDeleting(true)
            try {
              await deleteTrainingPlan(current)
              onDeleted?.(current.$id)
              onClose()
            } catch (e: any) {
              Alert.alert("Error", e?.message ?? "Could not delete the training plan.")
            } finally {
              setDeleting(false)
            }
          },
        },
      ],
    )
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.card}>
          <Pressable style={s.closeBtn} onPress={onClose} hitSlop={8}>
            <Text style={s.closeBtnText}>✕</Text>
          </Pressable>

          <Text style={s.title}>{mode === "edit" ? "Edit training plan" : "New training plan"}</Text>
          <Text style={s.sub}>6 weeks · 2 workouts a week</Text>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={s.label}>Name</Text>
            <TextInput
              style={s.input}
              value={name}
              onChangeText={setName}
              placeholder={`${formatDate(windowStart)} – ${formatDate(windowEnd)}`}
              placeholderTextColor={C.textMuted}
            />

            <Text style={s.label}>Dates</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable style={[s.input, s.dateInput]} onPress={() => setPickerOpen(true)}>
                <Text style={s.dateText}>{formatDate(windowStart)}</Text>
              </Pressable>
              <Text style={s.toText}>to</Text>
              <View style={[s.input, s.dateInput, s.dateFixed]}>
                <Text style={[s.dateText, { color: C.textSecondary }]}>{formatDate(windowEnd)}</Text>
              </View>
            </View>
            {pickerOpen && (
              <DateTimePicker
                value={new Date(windowStart + "T12:00:00")}
                mode="date"
                display="default"
                onChange={(_, selected) => {
                  setPickerOpen(false)
                  if (selected) setWindowStart(localDateStr(selected))
                }}
              />
            )}

            <View style={s.switchRow}>
              <Text style={s.switchLabel}>Conditioning only</Text>
              <Switch
                value={conditioning}
                onValueChange={(on) => setKind(on ? "conditioning" : "climbing")}
                trackColor={{ true: C.green }}
              />
            </View>
            <Text style={[s.sub2, { marginTop: 4 }]}>
              {conditioning ? "No climbing: every workout is strength & conditioning" : "For athletes who can't climb"}
            </Text>

            {!conditioning && (
              <>
                <Text style={s.label}>Focus</Text>
                <Text style={s.sub2}>Decides the plan&apos;s constraint warm-ups</Text>
                <View style={s.chipWrap}>
                  {PLAN_FOCUSES.map((f) => {
                    const sel = focus === f
                    return (
                      <Pressable key={f} style={[s.chip, sel && s.chipSelected]} onPress={() => setFocus(f)}>
                        <Text style={[s.chipText, sel && s.chipTextSelected]}>{PLAN_FOCUS_LABEL[f]}</Text>
                      </Pressable>
                    )
                  })}
                </View>
              </>
            )}

            {/* Only when starting a plan: changing it later would reshuffle
                the rotation under workouts already built. */}
            {mode === "new" && (
              <>
                <Text style={s.label}>First workout</Text>
                <Text style={s.sub2}>
                  {MAIN_CYCLE.map((_, i) => mainTypeLabel(mainTypeFor(i + 1, startType), kind)).join(" → ")} → …
                </Text>
                <View style={s.chipWrap}>
                  {MAIN_CYCLE.map((t) => {
                    const sel = startType === t
                    return (
                      <Pressable key={t} style={[s.chip, sel && s.chipSelected]} onPress={() => setStartType(t)}>
                        <Text style={[s.chipText, sel && s.chipTextSelected]}>{mainTypeLabel(t, kind)}</Text>
                      </Pressable>
                    )
                  })}
                </View>
              </>
            )}

            {!conditioning && (
              <View style={s.switchRow}>
                <Text style={s.switchLabel}>Strength & conditioning</Text>
                <Switch value={hasSc} onValueChange={setHasSc} trackColor={{ true: C.green }} />
              </View>
            )}

            {withSc && (
              <>
                <View style={s.switchRow}>
                  <Text style={s.switchLabel}>With mobility</Text>
                  <Switch value={hasMobility} onValueChange={setHasMobility} trackColor={{ true: C.green }} />
                </View>
                {hasMobility && (
                  <View style={s.patternBox}>
                    <Text style={s.patternTitle}>
                      Mobility exercises · {mobilityIds.length === 0 ? "app picks" : `${mobilityIds.length} picked`}
                    </Text>
                    <Text style={s.sub2}>Only the picked ones are used. None picked: the app picks.</Text>
                    <View style={s.chipWrap}>
                      {mobilityLibrary.map((e) => {
                        const sel = mobilityIds.includes(e.$id)
                        return (
                          <Pressable key={e.$id} style={[s.chip, sel && s.chipSelected]} onPress={() => toggleMobility(e.$id)}>
                            <Text style={[s.chipText, sel && s.chipTextSelected]}>{e.name}</Text>
                          </Pressable>
                        )
                      })}
                    </View>
                  </View>
                )}

                <Text style={s.label}>Movement patterns · {patterns.length}/{maxPatterns}</Text>
                <Text style={s.sub2}>
                  1 to {maxPatterns}{hasMobility ? ", or none for mobility only" : ""}. Squat and hinge are kept in separate blocks
                </Text>
                <View style={s.chipWrap}>{PICKABLE_PATTERNS.map(patternChip)}</View>
                <Text style={s.sub2}>Joints · max force ↔ hypertrophy, no explosiveness</Text>
                <View style={s.chipWrap}>{JOINT_PICKS.map(patternChip)}</View>

                {patterns.map((p, i) => {
                  const m = p.movementType
                  if (FIXED_PATTERNS.has(m)) {
                    const fixed = SPECIAL_CASE_EXERCISES[m] ?? {}
                    return (
                      <View key={m} style={s.patternBox}>
                        <Text style={s.patternTitle}>{i + 1}. {MOVEMENT_TYPE_LABEL[m]}</Text>
                        <Text style={s.sub2}>
                          Fixed by S&C focus: {fixed.max_force} (max force) · {fixed.hypertrophy} (hypertrophy) · {fixed.explosiveness} (power)
                        </Text>
                      </View>
                    )
                  }
                  const available = exercisesByPattern.get(m) ?? []
                  return (
                    <View key={m} style={s.patternBox}>
                      <Text style={s.patternTitle}>
                        {i + 1}. {MOVEMENT_TYPE_LABEL[m]} · {p.exerciseIds.length}/{Math.min(EXERCISES_PER_PATTERN, available.length)} · 1 or 2
                      </Text>
                      <View style={s.chipWrap}>
                        {available.map((e) => {
                          const pos = p.exerciseIds.indexOf(e.$id)
                          const sel = pos >= 0
                          return (
                            <Pressable key={e.$id} style={[s.chip, sel && s.chipSelected]} onPress={() => toggleExercise(m, e.$id)}>
                              <Text style={[s.chipText, sel && s.chipTextSelected]}>
                                {sel ? `${pos + 1} · ` : ""}{e.name}
                                {e.focuses?.length ? ` · ${e.focuses.map((f) => FOCUS_LABEL[f]).join("/")} only` : ""}
                              </Text>
                            </Pressable>
                          )
                        })}
                      </View>
                    </View>
                  )
                })}
                {patterns.length === 1 && (
                  <Text style={s.sub2}>
                    One pattern: both picks go in every workout, by sets — all rounds of one, then all rounds
                    of the other. 1 goes first in the first workout of the week, 2 in the second.
                  </Text>
                )}
                {patterns.length > 1 && (
                  <Text style={s.sub2}>
                    1 = first workout of the week, 2 = second. With only 1, both workouts use it. If a pick
                    isn&apos;t used for the day&apos;s S&C focus, the other pick is used instead.
                  </Text>
                )}
              </>
            )}
          </ScrollView>

          <Pressable
            style={[s.submitBtn, (!canSubmit || saving || deleting) && { opacity: 0.4 }]}
            onPress={handleSubmit}
            disabled={!canSubmit || saving || deleting}
          >
            {saving ? <ActivityIndicator color={C.bg} /> : (
              <Text style={s.submitBtnText}>{mode === "edit" ? "Save" : "Start plan"}</Text>
            )}
          </Pressable>
          {!canSubmit && <Text style={s.error}>{problems[0]}</Text>}

          {mode === "edit" && current && (
            <Pressable style={[s.deleteBtn, deleting && { opacity: 0.4 }]} onPress={handleDelete} disabled={saving || deleting}>
              {deleting ? <ActivityIndicator color="#E0837A" /> : <Text style={s.deleteBtnText}>Delete plan</Text>}
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center", padding: 24 },
  card: { backgroundColor: C.surface, borderRadius: 18, padding: 20, width: "100%", maxWidth: 420, maxHeight: "85%", gap: 4 },
  closeBtn: {
    position: "absolute", top: 12, right: 12, zIndex: 1,
    width: 28, height: 28, borderRadius: 14, backgroundColor: C.surfaceHigh, alignItems: "center", justifyContent: "center",
  },
  closeBtnText: { fontSize: 13, fontWeight: "700", color: C.textSecondary },
  title: { fontSize: 18, fontWeight: "800", color: C.textPrimary, textAlign: "center", paddingHorizontal: 30 },
  sub: { fontSize: 13, color: C.textSecondary, lineHeight: 18, textAlign: "center", marginBottom: 8 },
  sub2: { fontSize: 12, color: C.textMuted, marginTop: -4, marginBottom: 8 },
  label: { fontSize: 13, fontWeight: "600", color: C.textSecondary, marginTop: 14, marginBottom: 8 },
  input: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 14, fontSize: 15, color: C.textPrimary,
  },
  dateInput: { flex: 1 },
  dateFixed: { backgroundColor: C.surfaceHigh },
  dateText: { fontSize: 14, color: C.textPrimary, fontVariant: ["tabular-nums"] },
  toText: { alignSelf: "center", fontSize: 12, color: C.textMuted },
  error: { fontSize: 12, color: "#E0837A", marginTop: 6, textAlign: "center" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border },
  chipSelected: { backgroundColor: C.green, borderColor: C.green },
  chipText: { fontSize: 13, fontWeight: "600", color: C.textSecondary },
  chipTextSelected: { color: C.bg },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14 },
  switchLabel: { fontSize: 14, fontWeight: "600", color: C.textPrimary },
  patternBox: { backgroundColor: C.surfaceHigh, borderRadius: 12, padding: 12, gap: 8, marginTop: 10 },
  patternTitle: { fontSize: 13, fontWeight: "700", color: C.textPrimary },
  submitBtn: { marginTop: 18, backgroundColor: C.green, borderRadius: 16, padding: 16, alignItems: "center" },
  submitBtnText: { fontSize: 16, fontWeight: "700", color: C.bg },
  deleteBtn: { marginTop: 10, padding: 10, alignItems: "center" },
  deleteBtnText: { fontSize: 13, fontWeight: "600", color: "#E0837A" },
})
