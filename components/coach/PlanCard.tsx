import { C } from "@/utils/theme"
import { AthleteWorkoutBuilder } from "@/components/AthleteWorkoutBuilder"
import { TrainingPlanModal } from "@/components/TrainingPlanModal"
import { PlanPauses } from "@/components/coach/PlanPauses"
import { Block, injectLocalIds } from "@/components/workoutBlocks"
import { card } from "@/components/coach/styles"
import { ADAPTATION_COLOR } from "@/utils/adaptations"
import { MOVEMENT_TYPE_LABEL } from "@/utils/movementTypes"
import { donePlanWorkouts, doneThisWeek } from "@/utils/planProgress"
import { pauseOn } from "@/utils/planPauses"
import {
  alternateMainBlock, localDateStr, MAIN_BLOCK_COPIES, nextPlanIndex, planIsOver, planWeek, workoutSpec,
  PLAN_FOCUS_LABEL, PLAN_WORKOUTS, WORKOUTS_PER_WEEK,
  type BuiltPlanWorkout, type MainType, type PlanShape, type WorkoutSpec,
} from "@/utils/planRotation"
import { defaultDueBy, homeworkName, shortDay } from "@/utils/homework"
import { buildPlanWorkout, withUpcomingWorkouts, workoutPreview, type PlanWorkout } from "@/utils/planWorkout"
import { FOCUS_LABEL, FOCUSES, type Focus } from "@/utils/scProgression"
import {
  AppUser,
  BlockRow,
  clearHomeWorkout,
  createProtocol,
  deleteProtocol,
  getSessionsByUserId,
  listBlocks,
  listExercises,
  listPlanWorkouts,
  ExerciseRow,
  ProtocolRow,
  SessionRow,
  TrainingPlanRow,
} from "@/services/BoulderGraphService"
import { notifyHomeworkAssigned } from "@/services/homework"
import { useEffect, useState } from "react"
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native"

const MAIN_TYPE_LABEL: Record<MainType, string> = {
  strength: "Strength", power_endurance: "Power endurance", power: "Power",
}
// What the coach can ⇄ Swap on the next workout, and which workout it's for.
type GeneratedWorkout = PlanWorkout & { name: string; slot: { planId: string; planIndex: number } }

type SpecSwaps = { index: number } & Partial<Pick<WorkoutSpec, "mainBlock" | "warmup" | "scFocus">>

// S&C focus swap: Max force → Hypertrophy → Explosiveness → Max force.
function nextFocus(focus: Focus): Focus {
  return FOCUSES[(FOCUSES.indexOf(focus) + 1) % FOCUSES.length]
}

function formatPlanDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

// The athlete's training plan: settings, progress, and the next workout
// with a ⇄ Swap on each line, Edit details (opens the builder) and Create
// (saves it as generated) (docs/coach-dashboard.md §4.5).
export function PlanCard({
  athlete,
  plan,
  loading,
  planWorkouts,
  sessions,
  flashLevel,
  onPlanChanged,
  onSessions,
  onPlanWorkouts,
  onHomeworkChanged,
}: {
  athlete: AppUser
  plan: TrainingPlanRow | null
  loading: boolean
  planWorkouts: ProtocolRow[]
  sessions: SessionRow[]
  flashLevel: string | null
  onPlanChanged: (plan: TrainingPlanRow | null) => void
  onSessions: (rows: SessionRow[]) => void
  onPlanWorkouts: (rows: ProtocolRow[]) => void
  onHomeworkChanged: () => void
}) {
  // Which of Edit details / Create is generating or saving the next workout.
  const [busy, setBusy] = useState<"edit" | "create" | null>(null)
  // The plan workout Create just saved, for the "sent" line.
  const [created, setCreated] = useState<number | null>(null)
  const [draftWorkout, setDraftWorkout] = useState<{
    name: string; blocks: Block[]; homeworkIds: string[]; plan: { planId: string; planIndex: number }
  } | null>(null)
  // The coach's ⇄ Swaps on the next workout (S&C focus, warm-up, main
  // block), for that workout only — dropped once the card moves on.
  const [swaps, setSwaps] = useState<SpecSwaps>({ index: 0 })
  const [planModal, setPlanModal] = useState<"edit" | "new" | null>(null)
  // Both libraries, for the next workout's exercise preview. Edit details /
  // Create re-read them, so this copy only has to be close.
  const [libraries, setLibraries] = useState<{ blocks: BlockRow[]; exercises: ExerciseRow[] } | null>(null)
  useEffect(() => {
    Promise.all([listBlocks(), listExercises()])
      .then(([blocks, exercises]) => setLibraries({ blocks, exercises }))
      .catch(console.error)
  }, [])

  // Where the plan is: built climbing workouts (split-off S&C doesn't move
  // the rotation), the next one's spec, and whether the plan is over.
  const today = localDateStr(new Date())
  const builtWorkouts: BuiltPlanWorkout[] = planWorkouts
    .filter((w) => !w.planPart && w.planIndex) // not split-off S&C / homework
    .map((w) => ({ planIndex: w.planIndex!, createdAt: w.$createdAt, blocks: w.blocks }))
  const nextIndex = nextPlanIndex(builtWorkouts)
  const planEnded = !!plan && planIsOver(plan, builtWorkouts, today)
  // Plans made before v2 have no focus and can't be rotated.
  const planShape: PlanShape | null = plan?.focus ? { ...plan, focus: plan.focus } : null
  const rotationSpec: WorkoutSpec | null = planShape && !planEnded
    ? workoutSpec(planShape, nextIndex, builtWorkouts, today)
    : null
  const nextSpec: WorkoutSpec | null = rotationSpec && swaps.index === rotationSpec.index
    ? { ...rotationSpec, ...swaps, index: rotationSpec.index }
    : rotationSpec
  const swapTo = nextSpec ? alternateMainBlock(nextSpec.mainType, nextSpec.mainBlock) : null
  // The exercises the next workout would get, from what this page has
  // loaded — the same generation Edit details / Create run on fresh data.
  const preview = planShape && nextSpec && libraries
    ? workoutPreview(buildPlanWorkout(
      planShape, nextSpec, libraries.blocks, libraries.exercises, withUpcomingWorkouts(sessions, planWorkouts), flashLevel,
    ).blocks)
    : null
  function swap(change: Omit<SpecSwaps, "index">) {
    if (!nextSpec) return
    setSwaps((prev) => ({ ...(prev.index === nextSpec.index ? prev : {}), ...change, index: nextSpec.index }))
  }
  // Same numbers the athlete sees on their Plan page.
  const done = plan ? donePlanWorkouts(plan.$id, planWorkouts, sessions) : new Map<number, string>()
  const thisWeek = plan ? doneThisWeek(plan.windowStart, done, today, plan.pauses) : 0
  const pausedNow = plan ? pauseOn(plan.pauses, today) : null
  const inWindow = !!plan && today >= plan.windowStart && today <= plan.windowEnd && !pausedNow

  // Re-reads sessions, the plan's workouts and both libraries first, so
  // anything done, built or edited since this page opened counts (e.g. an
  // exercise re-tagged with a different movement pattern).
  async function generateNext() {
    if (!plan || !planShape || !nextSpec) return null
    const [fresh, built, exerciseRows, blockRows] = await Promise.all([
      getSessionsByUserId(athlete.$id), listPlanWorkouts(plan.$id), listExercises(), listBlocks(),
    ])
    onSessions(fresh)
    onPlanWorkouts(built)
    return {
      name: `Workout ${nextSpec.index} · ${MAIN_TYPE_LABEL[nextSpec.mainType]}`,
      slot: { planId: plan.$id, planIndex: nextSpec.index },
      ...buildPlanWorkout(planShape, nextSpec, blockRows, exerciseRows, withUpcomingWorkouts(fresh, built), flashLevel),
    }
  }

  // Opens the generated workout in the builder, to review and adjust
  // before saving.
  function openInBuilder(next: GeneratedWorkout) {
    // The Density test rides along pre-marked as homework (split off on save).
    const withIds = injectLocalIds([...next.homework, ...next.blocks])
    setDraftWorkout({
      name: next.name,
      blocks: withIds,
      homeworkIds: withIds.slice(0, next.homework.length).map((b) => b.id),
      plan: next.slot,
    })
  }

  async function handleEditDetails() {
    setBusy("edit")
    try {
      const next = await generateNext()
      if (!next) return
      if (next.warnings.length > 0) {
        Alert.alert("Check this workout", next.warnings.join("\n\n"), [{ text: "OK", onPress: () => openInBuilder(next) }])
      } else {
        openInBuilder(next)
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not build the workout.")
    } finally {
      setBusy(null)
    }
  }

  // Saves the generated workout as it is — the athlete sees it right away.
  // With warnings, the coach picks: create anyway, or review it first.
  async function handleCreate() {
    setBusy("create")
    try {
      const next = await generateNext()
      if (!next) return
      if (next.blocks.length === 0) {
        Alert.alert("Nothing to create", [...next.warnings, "Use Edit details to build it by hand."].join("\n\n"))
        return
      }
      if (next.warnings.length > 0) {
        Alert.alert("Check this workout", next.warnings.join("\n\n"), [
          { text: "Cancel", style: "cancel" },
          { text: "Edit details", onPress: () => openInBuilder(next) },
          { text: "Create anyway", onPress: () => { void create(next) } },
        ])
        return
      }
      await create(next)
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not create the workout.")
    } finally {
      setBusy(null)
    }
  }

  // Same rows the builder's Save makes: the Density test first as homework
  // (undone if the workout can't be saved), then the workout, then the
  // athlete hears about the homework.
  async function create(next: GeneratedWorkout) {
    setBusy("create")
    let homeworkRow: ProtocolRow | null = null
    try {
      const dueBy = defaultDueBy(today)
      if (next.homework.length > 0) {
        homeworkRow = await createProtocol({
          name: homeworkName(next.name, next.homework), blocks: next.homework, athleteId: athlete.$id,
          ...next.slot, planPart: "homework", dueBy,
        })
      }
      await createProtocol({ name: next.name, blocks: next.blocks, athleteId: athlete.$id, ...next.slot })
      await clearHomeWorkout(athlete.$id)
      if (homeworkRow) notifyHomeworkAssigned(homeworkRow.$id, shortDay(dueBy))
      setCreated(next.slot.planIndex)
      if (plan) listPlanWorkouts(plan.$id).then(onPlanWorkouts).catch(console.error)
      onHomeworkChanged()
    } catch (e: any) {
      if (homeworkRow) await deleteProtocol(homeworkRow.$id).catch(() => {})
      Alert.alert("Error", e?.message ?? "Could not create the workout.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <View style={card.card}>
      <View style={card.headerRow}>
        <Text style={card.title}>Training plan</Text>
        {plan && !planEnded && (
          <Pressable onPress={() => setPlanModal("edit")} hitSlop={8}>
            <Text style={card.link}>Edit</Text>
          </Pressable>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={C.green} />
      ) : !plan ? (
        <>
          <Text style={card.sub}>No training plan yet — 6 weeks, 2 workouts a week.</Text>
          <Pressable style={card.primaryBtn} onPress={() => setPlanModal("new")}>
            <Text style={card.primaryBtnText}>Start a plan</Text>
          </Pressable>
        </>
      ) : (
        <>
          <View style={{ gap: 2 }}>
            <Text style={styles.planName}>{plan.name}</Text>
            <Text style={styles.planWindow}>
              {formatPlanDate(plan.windowStart)} – {formatPlanDate(plan.windowEnd)}
              {plan.focus ? " · " : ""}
              {plan.focus && <Text style={{ color: ADAPTATION_COLOR[plan.focus] }}>{PLAN_FOCUS_LABEL[plan.focus]} focus</Text>}
            </Text>
          </View>
          {plan.hasSc && (
            <View style={styles.chipWrap}>
              {plan.scPatterns.map((p) => (
                <View key={p.movementType} style={styles.chip}>
                  <Text style={styles.chipText}>{MOVEMENT_TYPE_LABEL[p.movementType]}</Text>
                </View>
              ))}
              {plan.hasMobility && (
                <View style={styles.chip}>
                  <Text style={styles.chipText}>+ mobility</Text>
                </View>
              )}
            </View>
          )}
          <View style={styles.statsRow}>
            <Stat value={`${done.size}/${PLAN_WORKOUTS}`} label="done" />
            <Stat value={`${Math.min(nextIndex - 1, PLAN_WORKOUTS)}/${PLAN_WORKOUTS}`} label="built" />
            {inWindow && <Stat value={`${thisWeek}/${WORKOUTS_PER_WEEK}`} label="this week" />}
          </View>
          {!planEnded && <PlanPauses plan={plan} onPlanChanged={onPlanChanged} onHomeworkChanged={onHomeworkChanged} />}

          {planEnded ? (
            <View style={styles.box}>
              <Text style={styles.boxText}>This plan has ended.</Text>
              <Pressable style={card.primaryBtn} onPress={() => setPlanModal("new")}>
                <Text style={card.primaryBtnText}>Start a new plan</Text>
              </Pressable>
            </View>
          ) : !plan.focus ? (
            // Plans made before v2 have no focus — the rotation needs one.
            <View style={styles.box}>
              <Text style={styles.boxText}>This plan was made before the new plan structure. Edit it to set a focus.</Text>
            </View>
          ) : nextSpec && (
            <View style={styles.box}>
              {created === nextSpec.index - 1 && (
                <Text style={styles.sent}>✓ Workout {created} created — {athlete.username} can see it now.</Text>
              )}
              {pausedNow && (
                <Text style={styles.pausedLine}>Paused until {formatPlanDate(pausedNow.end)}. You can still build ahead.</Text>
              )}
              <Text style={styles.nextTitle}>
                Next: workout {nextSpec.index} · week {Math.max(1, planWeek(plan.windowStart, today, plan.pauses))}
              </Text>
              {nextSpec.scFocus && (
                <PickRow
                  color={ADAPTATION_COLOR.conditioning}
                  text={`S&C · ${FOCUS_LABEL[nextSpec.scFocus]}`}
                  onSwap={() => swap({ scFocus: nextFocus(nextSpec.scFocus!) })}
                />
              )}
              {nextSpec.scFocus && preview?.sc.map((names, i) => <ExerciseChips key={i} names={names} />)}
              <PickRow
                color={C.textMuted}
                text={nextSpec.warmup === "constraints"
                  ? `Warm-up · 3 ${PLAN_FOCUS_LABEL[plan.focus].toLowerCase()} constraints`
                  : "Warm-up · 1 on 1 off"}
                onSwap={() => swap({ warmup: nextSpec.warmup === "constraints" ? "one_on_one_off" : "constraints" })}
              />
              {nextSpec.warmup === "constraints" && !!preview?.warmup.length && <ExerciseChips names={preview.warmup} />}
              <PickRow
                color={ADAPTATION_COLOR[nextSpec.mainType]}
                text={`${MAIN_TYPE_LABEL[nextSpec.mainType]} · ${nextSpec.mainBlock.name} × ${MAIN_BLOCK_COPIES}`}
                onSwap={swapTo ? () => swap({ mainBlock: swapTo }) : undefined}
              />
              {nextSpec.withTest && <PickRow color={ADAPTATION_COLOR.test} text="+ Density test as homework" />}
              <View style={styles.actions}>
                <Pressable style={card.outlineBtn} onPress={handleEditDetails} disabled={busy !== null}>
                  <Text style={card.outlineBtnText}>{busy === "edit" ? "…" : "Edit details"}</Text>
                </Pressable>
                <Pressable style={[card.primaryBtn, { alignSelf: "auto" }]} onPress={handleCreate} disabled={busy !== null}>
                  <Text style={card.primaryBtnText}>{busy === "create" ? "Creating…" : "Create"}</Text>
                </Pressable>
              </View>
            </View>
          )}
        </>
      )}

      {draftWorkout && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setDraftWorkout(null)}>
          <AthleteWorkoutBuilder
            athlete={athlete}
            roster={[athlete]}
            initialName={draftWorkout.name}
            initialBlocks={draftWorkout.blocks}
            initialHomeworkIds={draftWorkout.homeworkIds}
            plan={draftWorkout.plan}
            onSaved={() => {
              if (plan) listPlanWorkouts(plan.$id).then(onPlanWorkouts).catch(console.error)
              onHomeworkChanged()
            }}
            onClose={() => setDraftWorkout(null)}
          />
        </Modal>
      )}

      <TrainingPlanModal
        visible={planModal !== null}
        athleteId={athlete.$id}
        mode={planModal ?? "new"}
        current={plan}
        onClose={() => setPlanModal(null)}
        onSaved={onPlanChanged}
        onDeleted={() => onPlanChanged(null)}
      />
    </View>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statNum}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  )
}

function PickRow({ color, text, onSwap }: { color: string; text: string; onSwap?: () => void }) {
  return (
    <View style={styles.pickRow}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.pickText, { flex: 1 }]}>{text}</Text>
      {onSwap && (
        <Pressable onPress={onSwap} hitSlop={8}>
          <Text style={card.link}>⇄ Swap</Text>
        </Pressable>
      )}
    </View>
  )
}

// One block's exercises, together, under its line.
function ExerciseChips({ names }: { names: string[] }) {
  return (
    <View style={styles.exerciseWrap}>
      {names.map((name, i) => (
        <View key={i} style={styles.exerciseChip}>
          <Text style={styles.chipText}>{name}</Text>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  planName: { fontSize: 18, fontWeight: "800", color: C.textPrimary },
  planWindow: { fontSize: 13, color: C.textSecondary, fontVariant: ["tabular-nums"] },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { backgroundColor: C.surfaceHigh, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 11.5, fontWeight: "600", color: C.textSecondary },
  statsRow: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, backgroundColor: C.surfaceHigh, borderRadius: 12, paddingVertical: 10, alignItems: "center" },
  statNum: { fontSize: 20, fontWeight: "800", color: C.green, fontVariant: ["tabular-nums"] },
  statLabel: { fontSize: 11, color: C.textSecondary },
  box: { backgroundColor: C.surfaceHigh, borderRadius: 12, padding: 12, gap: 8 },
  boxText: { fontSize: 13, fontWeight: "600", color: C.textPrimary },
  nextTitle: { fontSize: 13.5, fontWeight: "700", color: C.textPrimary },
  sent: { fontSize: 12.5, fontWeight: "600", color: C.green },
  pausedLine: { fontSize: 12.5, fontWeight: "600", color: C.textSecondary },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 },
  pickRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  // The plan's pattern chips, a shade darker than the box they sit in;
  // indented to line up with the line's text (dot 10 + gap 8).
  exerciseWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginLeft: 18, marginTop: -2 },
  exerciseChip: { backgroundColor: C.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  pickText: { fontSize: 13, fontWeight: "600", color: C.textPrimary },
})
