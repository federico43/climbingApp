import { C } from "@/utils/theme"
import { AthleteWorkoutBuilder } from "@/components/AthleteWorkoutBuilder"
import { TrainingPlanModal } from "@/components/TrainingPlanModal"
import { Block, injectLocalIds } from "@/components/workoutBlocks"
import { card } from "@/components/coach/styles"
import { ADAPTATION_COLOR } from "@/utils/adaptations"
import { MOVEMENT_TYPE_LABEL } from "@/utils/movementTypes"
import { donePlanWorkouts, doneThisWeek } from "@/utils/planProgress"
import {
  alternateMainBlock, localDateStr, MAIN_BLOCK_COPIES, nextPlanIndex, planIsOver, planWeek, workoutSpec,
  PLAN_FOCUS_LABEL, PLAN_WORKOUTS, WORKOUTS_PER_WEEK,
  type BuiltPlanWorkout, type MainType, type PlanShape, type WorkoutSpec,
} from "@/utils/planRotation"
import { buildPlanWorkout, withUpcomingWorkouts } from "@/utils/planWorkout"
import { FOCUS_LABEL, FOCUSES, type Focus } from "@/utils/scProgression"
import {
  AppUser,
  getSessionsByUserId,
  listBlocks,
  listExercises,
  listPlanWorkouts,
  ProtocolRow,
  SessionRow,
  TrainingPlanRow,
} from "@/services/BoulderGraphService"
import { useState } from "react"
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native"

const MAIN_TYPE_LABEL: Record<MainType, string> = {
  strength: "Strength", power_endurance: "Power endurance", power: "Power",
}
// What the coach can ⇄ Swap on the next workout, and which workout it's for.
type SpecSwaps = { index: number } & Partial<Pick<WorkoutSpec, "mainBlock" | "warmup" | "scFocus">>

// S&C focus swap: Max force → Hypertrophy → Explosiveness → Max force.
function nextFocus(focus: Focus): Focus {
  return FOCUSES[(FOCUSES.indexOf(focus) + 1) % FOCUSES.length]
}

function formatPlanDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

// The athlete's training plan: settings, progress, and the next workout
// with its Build and a ⇄ Swap on each line (docs/coach-dashboard.md §4.5).
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
  const [building, setBuilding] = useState(false)
  const [draftWorkout, setDraftWorkout] = useState<{
    name: string; blocks: Block[]; homeworkIds: string[]; plan: { planId: string; planIndex: number }
  } | null>(null)
  // The coach's ⇄ Swaps on the next workout (S&C focus, warm-up, main
  // block), for that workout only — dropped once the card moves on.
  const [swaps, setSwaps] = useState<SpecSwaps>({ index: 0 })
  const [planModal, setPlanModal] = useState<"edit" | "new" | null>(null)

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
  function swap(change: Omit<SpecSwaps, "index">) {
    if (!nextSpec) return
    setSwaps((prev) => ({ ...(prev.index === nextSpec.index ? prev : {}), ...change, index: nextSpec.index }))
  }
  // Same numbers the athlete sees on their Plan page.
  const done = plan ? donePlanWorkouts(plan.$id, planWorkouts, sessions) : new Map<number, string>()
  const thisWeek = plan ? doneThisWeek(plan.windowStart, done, today) : 0
  const inWindow = !!plan && today >= plan.windowStart && today <= plan.windowEnd

  // Re-reads sessions, the plan's workouts and both libraries first, so
  // anything done, built or edited since this page opened counts (e.g. an
  // exercise re-tagged with a different movement pattern).
  async function handleBuild() {
    if (!plan || !planShape || !nextSpec) return
    setBuilding(true)
    try {
      const [fresh, built, exerciseRows, blockRows] = await Promise.all([
        getSessionsByUserId(athlete.$id), listPlanWorkouts(plan.$id), listExercises(), listBlocks(),
      ])
      onSessions(fresh)
      onPlanWorkouts(built)
      const { blocks, homework: homeworkBlocks, warnings } = buildPlanWorkout(
        planShape, nextSpec, blockRows, exerciseRows, withUpcomingWorkouts(fresh, built), flashLevel,
      )
      // The Density test rides along pre-marked as homework (split off on save).
      const withIds = injectLocalIds([...homeworkBlocks, ...blocks])
      const open = () => setDraftWorkout({
        name: `Workout ${nextSpec.index} · ${MAIN_TYPE_LABEL[nextSpec.mainType]}`,
        blocks: withIds,
        homeworkIds: withIds.slice(0, homeworkBlocks.length).map((b) => b.id),
        plan: { planId: plan.$id, planIndex: nextSpec.index },
      })
      if (warnings.length > 0) {
        Alert.alert("Check this workout", warnings.join("\n\n"), [{ text: "OK", onPress: open }])
      } else {
        open()
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not build the workout.")
    } finally {
      setBuilding(false)
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
              <View style={card.headerRow}>
                <Text style={styles.nextTitle}>
                  Next: workout {nextSpec.index} · week {Math.max(1, planWeek(plan.windowStart, today))}
                </Text>
                <Pressable style={card.outlineBtn} onPress={handleBuild} disabled={building}>
                  <Text style={card.outlineBtnText}>{building ? "…" : "Build"}</Text>
                </Pressable>
              </View>
              {nextSpec.scFocus && (
                <PickRow
                  color={ADAPTATION_COLOR.conditioning}
                  text={`S&C · ${FOCUS_LABEL[nextSpec.scFocus]}`}
                  onSwap={() => swap({ scFocus: nextFocus(nextSpec.scFocus!) })}
                />
              )}
              <PickRow
                color={C.textMuted}
                text={nextSpec.warmup === "constraints"
                  ? `Warm-up · 3 ${PLAN_FOCUS_LABEL[plan.focus].toLowerCase()} constraints`
                  : "Warm-up · 1 on 1 off"}
                onSwap={() => swap({ warmup: nextSpec.warmup === "constraints" ? "one_on_one_off" : "constraints" })}
              />
              <PickRow
                color={ADAPTATION_COLOR[nextSpec.mainType]}
                text={`${MAIN_TYPE_LABEL[nextSpec.mainType]} · ${nextSpec.mainBlock.name} × ${MAIN_BLOCK_COPIES}`}
                onSwap={swapTo ? () => swap({ mainBlock: swapTo }) : undefined}
              />
              {nextSpec.withTest && <PickRow color={ADAPTATION_COLOR.test} text="+ Density test as homework" />}
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
  nextTitle: { flex: 1, fontSize: 13.5, fontWeight: "700", color: C.textPrimary },
  pickRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  pickText: { fontSize: 13, fontWeight: "600", color: C.textPrimary },
})
