import { PaperScope, paperSheet, useC, usePaperScope, useSheet, type Palette } from "@/theme/paper/legacy"
import { font, type PaperTheme } from "@/theme/paper/tokens"
import { PaperThemeOverride } from "@/components/paper"
import { AthleteWorkoutBuilder } from "@/components/AthleteWorkoutBuilder"
import { TrainingPlanModal } from "@/components/TrainingPlanModal"
import { ExtraSessionRow } from "@/components/coach/ExtraSessionRow"
import { PlanPauses } from "@/components/coach/PlanPauses"
import { Block, injectLocalIds } from "@/components/workoutBlocks"
import { cardSheet } from "@/components/coach/styles"
import { ADAPTATION_COLOR } from "@/utils/adaptations"
import { MOVEMENT_TYPE_LABEL } from "@/utils/movementTypes"
import { donePlanWorkouts, doneThisWeek } from "@/utils/planProgress"
import { pauseOn } from "@/utils/planPauses"
import {
  alternateMainBlock, canRotate, isConditioningOnly, localDateStr, MAIN_BLOCK_COPIES, MAIN_COMPANION_BLOCK, mainBlockRun, mainTypeLabel, nextPlanIndex, planIsOver, planWeek, workoutSpec,
  PLAN_FOCUS_LABEL, PLAN_WEEKS, PLAN_WORKOUTS, WORKOUTS_PER_WEEK,
  type BuiltPlanWorkout, type PlanShape, type WorkoutSpec,
} from "@/utils/planRotation"
import { defaultDueBy, homeworkName, shortDay } from "@/utils/homework"
import { benchmarkComparison, benchmarkTryLabel } from "@/utils/benchmark"
import { parsePullupTest } from "@/utils/pullupAssessment"
import { buildPlanWorkout, withUpcomingWorkouts, workoutPreview, type PlanWorkout } from "@/utils/planWorkout"
import { FOCUS_LABEL, FOCUSES, type Focus } from "@/utils/scProgression"
import {
  AppUser,
  BlockRow,
  clearHomeWorkout,
  createProtocol,
  deleteProtocol,
  getSessionsByUserId,
  getUsers,
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
import { freshReads } from "@/utils/readCache"

// What the coach can ⇄ Swap on the next workout, and which workout it's for.
type GeneratedWorkout = PlanWorkout & { name: string; slot: { planId: string; planIndex: number } }

type SpecSwaps = { index: number } & Partial<Pick<WorkoutSpec, "mainBlock" | "warmup" | "scFocus">>

// S&C focus swap: Max force → Hypertrophy → Explosiveness → Max force.
// The coach's manual swap only cycles through the focuses the plan has on.
function nextFocus(focus: Focus, enabled?: Focus[] | null): Focus {
  const on = enabled && enabled.length ? FOCUSES.filter((f) => enabled.includes(f)) : FOCUSES
  const i = on.indexOf(focus)
  return on[(i + 1) % on.length]
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
  homework,
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
  // The athlete's homework — for the extra session's "already sent" line.
  homework: ProtocolRow[]
  flashLevel: string | null
  onPlanChanged: (plan: TrainingPlanRow | null) => void
  onSessions: (rows: SessionRow[]) => void
  onPlanWorkouts: (rows: ProtocolRow[]) => void
  onHomeworkChanged: () => void
}) {
  const C = useC()
  const P = usePaperScope()
  const card = useSheet(cardSheet)
  const styles = useSheet(stylesSheet)
  const look: Look = { C, P, card, styles }
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
  const planShape: PlanShape | null = plan && canRotate(plan) ? plan : null
  const conditioning = !!plan && isConditioningOnly(plan)
  const rotationSpec: WorkoutSpec | null = planShape && !planEnded
    ? workoutSpec(planShape, nextIndex, builtWorkouts, today)
    : null
  const nextSpec: WorkoutSpec | null = rotationSpec && swaps.index === rotationSpec.index
    ? { ...rotationSpec, ...swaps, index: rotationSpec.index }
    : rotationSpec
  const swapTo = nextSpec?.mainBlock ? alternateMainBlock(nextSpec.mainType, nextSpec.mainBlock) : null
  // The exercises the next workout would get, from what this page has
  // loaded — the same generation Edit details / Create run on fresh data.
  const preview = planShape && nextSpec && libraries
    ? workoutPreview(buildPlanWorkout(
      planShape, nextSpec, libraries.blocks, libraries.exercises, withUpcomingWorkouts(sessions, planWorkouts), flashLevel, parsePullupTest((athlete as any).pullupTest),
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
  // The plan's Benchmark sequence: first try and, once done, the retry.
  const benchmark = plan ? benchmarkComparison(sessions, plan.windowStart) : null
  const inWindow = !!plan && today >= plan.windowStart && today <= plan.windowEnd && !pausedNow

  // Re-reads sessions, the plan's workouts and both libraries first, so
  // anything done, built or edited since this page opened counts (e.g. an
  // exercise re-tagged with a different movement pattern).
  async function generateNext() {
    if (!plan || !planShape || !nextSpec) return null
    freshReads() // past the read cache: the athlete may have just trained
    const [fresh, built, exerciseRows, blockRows, me] = await Promise.all([
      getSessionsByUserId(athlete.$id), listPlanWorkouts(plan.$id), listExercises(), listBlocks(),
      // A pull-up test done since this page opened counts too.
      getUsers(athlete.$id).catch(() => null),
    ])
    onSessions(fresh)
    onPlanWorkouts(built)
    return {
      // Conditioning plans: named after the day's S&C focus (swaps included).
      name: `Workout ${nextSpec.index} · ${conditioning && nextSpec.scFocus ? FOCUS_LABEL[nextSpec.scFocus] : mainTypeLabel(nextSpec.mainType)}`,
      slot: { planId: plan.$id, planIndex: nextSpec.index },
      ...buildPlanWorkout(planShape, nextSpec, blockRows, exerciseRows, withUpcomingWorkouts(fresh, built), flashLevel, parsePullupTest(((me ?? athlete) as any).pullupTest)),
    }
  }

  // Opens the generated workout in the builder, to review and adjust
  // before saving.
  function openInBuilder(next: GeneratedWorkout) {
    // The benchmark rides along pre-marked as homework (split off on save).
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

  // Same rows the builder's Save makes: the benchmark first as homework
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

  // Paper Mint (design chat 2026-11-22): the plan is an ink card and the
  // next workout a card of its own, outlined in ink. Legacy: one card.
  const weekNow = plan ? Math.min(Math.max(planWeek(plan.windowStart, today, plan.pauses), 1), PLAN_WEEKS) : 1

  const planInfo = (t: Look) => loading ? (
    <ActivityIndicator color={t.C.green} />
  ) : !plan ? (
    <>
      <Text style={t.card.sub}>No training plan yet — 6 weeks, 2 workouts a week.</Text>
      <Pressable style={t.card.primaryBtn} onPress={() => setPlanModal("new")}>
        <Text style={t.card.primaryBtnText}>Start a plan</Text>
      </Pressable>
    </>
  ) : (
    <>
      <View style={{ gap: 2 }}>
        {P && (
          <Text style={t.styles.planEyebrow}>
            {inWindow || pausedNow ? `Week ${weekNow} of ${PLAN_WEEKS} · ` : ""}{formatPlanDate(plan.windowStart)} – {formatPlanDate(plan.windowEnd)}
          </Text>
        )}
        <Text style={t.styles.planName}>{plan.name}</Text>
        <Text style={t.styles.planWindow}>
          {!P && `${formatPlanDate(plan.windowStart)} – ${formatPlanDate(plan.windowEnd)}`}
          {!P && (plan.focus || conditioning) ? " · " : ""}
          {conditioning
            ? <Text style={{ color: P ? undefined : ADAPTATION_COLOR.conditioning }}>Conditioning only</Text>
            : plan.focus && <Text style={{ color: P ? undefined : ADAPTATION_COLOR[plan.focus] }}>{PLAN_FOCUS_LABEL[plan.focus]} focus</Text>}
        </Text>
      </View>
      {plan.hasSc && (
        <View style={t.styles.chipWrap}>
          {plan.scPatterns.map((p) => (
            <View key={p.movementType} style={t.styles.chip}>
              <Text style={t.styles.chipText}>{P ? `S&C · ${MOVEMENT_TYPE_LABEL[p.movementType]}` : MOVEMENT_TYPE_LABEL[p.movementType]}</Text>
            </View>
          ))}
          {plan.hasMobility && (
            <View style={t.styles.chip}>
              <Text style={t.styles.chipText}>{P ? "Mobility" : "+ mobility"}{plan.mobilityIds.length > 0 ? ` · ${plan.mobilityIds.length} picked` : ""}</Text>
            </View>
          )}
        </View>
      )}
      {P ? (
        <View style={t.styles.bigStats}>
          <BigStat label="Workouts done" value={done.size} of={PLAN_WORKOUTS} />
          <BigStat label="Workouts built" value={Math.min(nextIndex - 1, PLAN_WORKOUTS)} of={PLAN_WORKOUTS} />
          {inWindow && <BigStat label="This week" value={thisWeek} of={WORKOUTS_PER_WEEK} />}
        </View>
      ) : (
        <View style={t.styles.statsRow}>
          <Stat value={`${done.size}/${PLAN_WORKOUTS}`} label="done" />
          <Stat value={`${Math.min(nextIndex - 1, PLAN_WORKOUTS)}/${PLAN_WORKOUTS}`} label="built" />
          {inWindow && <Stat value={`${thisWeek}/${WORKOUTS_PER_WEEK}`} label="this week" />}
        </View>
      )}
      {benchmark && (
        <View style={t.styles.benchRow}>
          <Text style={t.styles.benchLabel}>Benchmark</Text>
          <Text style={t.styles.benchText}>
            {formatPlanDate(benchmark.first.date)}: {benchmarkTryLabel(benchmark.first)}
            {benchmark.last ? `  →  ${formatPlanDate(benchmark.last.date)}: ${benchmarkTryLabel(benchmark.last)}` : "  ·  retry in the last week"}
          </Text>
        </View>
      )}
      {!planEnded && <PlanPauses plan={plan} onPlanChanged={onPlanChanged} onHomeworkChanged={onHomeworkChanged} />}
    </>
  )

  // Ended / pre-v2 plans: a line in the plan card instead of a next workout.
  const planNotice = (t: Look) => !plan || loading ? null : planEnded ? (
    <View style={t.styles.box}>
      <Text style={t.styles.boxText}>This plan has ended.</Text>
      <Pressable style={t.card.primaryBtn} onPress={() => setPlanModal("new")}>
        <Text style={t.card.primaryBtnText}>Start a new plan</Text>
      </Pressable>
    </View>
  ) : !planShape ? (
    // Plans made before v2 have no focus — the rotation needs one.
    <View style={t.styles.box}>
      <Text style={t.styles.boxText}>This plan was made before the new plan structure. Edit it to set a focus.</Text>
    </View>
  ) : null

  const extraSession = plan && !loading && planShape && !planEnded && (
    <ExtraSessionRow
      athlete={athlete}
      plan={plan}
      sessions={sessions}
      homework={homework}
      flashLevel={flashLevel}
      onSent={onHomeworkChanged}
    />
  )

  const runLabel = (b: Parameters<typeof mainBlockRun>[0], copies?: number) => {
    const run = mainBlockRun(b)
    return run.timeLimit ? `${run.copies} × ${run.timeLimit} min` : `× ${copies ?? run.copies}`
  }
  const companion = nextSpec ? MAIN_COMPANION_BLOCK[nextSpec.mainType] : undefined

  const nextRows = (t: Look) => plan && nextSpec && (
    <>
      {nextSpec.scFocus && (plan.scPatterns.length === 0 && plan.hasMobility
        ? <PickRow color={ADAPTATION_COLOR.conditioning} text="S&C · Mobility only" />
        : (
          <PickRow
            color={ADAPTATION_COLOR.conditioning}
            text={`S&C · ${FOCUS_LABEL[nextSpec.scFocus]}`}
            detail={P ? preview?.sc.flat().join(" · ") : undefined}
            onSwap={() => swap({ scFocus: nextFocus(nextSpec.scFocus!, plan.scFocuses) })}
          />
        ))}
      {!P && nextSpec.scFocus && preview?.sc.map((names, i) => <ExerciseChips key={i} names={names} />)}
      {!conditioning && plan.focus && (<>
        <PickRow
          color={t.C.textMuted}
          text={nextSpec.warmup === "constraints"
            ? `Warm-up · 3 ${PLAN_FOCUS_LABEL[plan.focus].toLowerCase()} constraints`
            : nextSpec.warmup === "exploration"
              ? "First · Route exploration (new routes)"
              : "Warm-up · 1 on 1 off"}
          detail={P && nextSpec.warmup === "constraints" ? preview?.warmup.join(" · ") : undefined}
          onSwap={() => swap({
            warmup: nextSpec.warmup !== "one_on_one_off"
              ? "one_on_one_off"
              : plan.focus === "fear_management" ? "exploration" : "constraints",
          })}
        />
        {!P && nextSpec.warmup === "constraints" && !!preview?.warmup.length && <ExerciseChips names={preview.warmup} />}
        {nextSpec.mainBlock && (
          <PickRow
            color={ADAPTATION_COLOR[nextSpec.mainType]}
            text={`${mainTypeLabel(nextSpec.mainType)} · ${nextSpec.mainBlock.name} ${runLabel(nextSpec.mainBlock)}${companion ? ` + ${companion.name} ${runLabel(companion, MAIN_BLOCK_COPIES)}` : ""}`}
            onSwap={swapTo ? () => swap({ mainBlock: swapTo }) : undefined}
          />
        )}
      </>)}
      {nextSpec.withTest && <PickRow color={ADAPTATION_COLOR.test} text={nextSpec.index === 1 || !benchmark ? "+ Tests as homework: Density test + Benchmark (new sequence)" : "+ Tests as homework: Density test + Benchmark (same sequence again)"} />}
    </>
  )

  const showNext = !!plan && !loading && !planEnded && !!planShape && !!nextSpec
  const nextActions = (t: Look) => (
    <View style={t.styles.actions}>
      <Pressable style={t.card.outlineBtn} onPress={handleEditDetails} disabled={busy !== null}>
        <Text style={t.card.outlineBtnText}>{busy === "edit" ? "…" : "Edit details"}</Text>
      </Pressable>
      <Pressable style={[t.card.primaryBtn, { alignSelf: "auto" }]} onPress={handleCreate} disabled={busy !== null}>
        <Text style={t.card.primaryBtnText}>{busy === "create" ? "Creating…" : P && nextSpec ? `Create workout ${nextSpec.index}` : "Create"}</Text>
      </Pressable>
    </View>
  )
  const nextStatus = (t: Look) => nextSpec && (
    <>
      {created === nextSpec.index - 1 && (
        <Text style={t.styles.sent}>✓ Workout {created} created — {athlete.username} can see it now.</Text>
      )}
      {pausedNow && (
        <Text style={t.styles.pausedLine}>Paused until {formatPlanDate(pausedNow.end)}. You can still build ahead.</Text>
      )}
    </>
  )

  const editLink = (t: Look) => plan && !planEnded && (
    <Pressable onPress={() => setPlanModal("edit")} hitSlop={8}>
      <Text style={t.styles.editLink}>Edit</Text>
    </Pressable>
  )

  const modals = (
    <>
      {draftWorkout && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setDraftWorkout(null)}>
          <AthleteWorkoutBuilder
            athlete={athlete}
            roster={[athlete]}
            initialName={draftWorkout.name}
            initialBlocks={draftWorkout.blocks}
            initialHomeworkIds={draftWorkout.homeworkIds}
            plan={draftWorkout.plan}
            focusLabel={plan?.focus ? PLAN_FOCUS_LABEL[plan.focus] : null}
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
    </>
  )

  if (P) {
    return (
      <>
        {/* The ink card: dark theme inside, whatever the app's mode. */}
        {/* Inverted card: ink on light paper, light on dark (Federico 2026-11-23). */}
        <PaperThemeOverride mode={P.mode === "dark" ? "light" : "dark"}>
         <PaperScope>
          <Themed>
            {(t) => (
              <View style={[t.card.card, t.styles.inkCard]}>
                <View style={t.card.headerRow}>
                  <Text style={[t.card.title, { color: t.P?.mintText }]}>Training plan</Text>
                  {editLink(t)}
                </View>
                {planInfo(t)}
                {planNotice(t)}
                {extraSession}
              </View>
            )}
          </Themed>
         </PaperScope>
        </PaperThemeOverride>

        {showNext && nextSpec && (
          <View style={[card.card, styles.nextCard]}>
            <View style={{ gap: 4 }}>
              <Text style={[card.title, { color: P.mintText }]}>Next workout</Text>
              <Text style={styles.nextHeadline}>
                Workout {nextSpec.index} · {conditioning && nextSpec.scFocus ? FOCUS_LABEL[nextSpec.scFocus] : mainTypeLabel(nextSpec.mainType)}
              </Text>
              <Text style={styles.planEyebrow}>Week {Math.max(1, planWeek(plan!.windowStart, today, plan!.pauses))} of {PLAN_WEEKS}</Text>
            </View>
            {nextStatus(look)}
            <View style={styles.nextRows}>{nextRows(look)}</View>
            <Text style={card.sub}>Swap only changes this workout. Create sends it to {athlete.username || "the athlete"} as it is.</Text>
            {nextActions(look)}
          </View>
        )}
        {modals}
      </>
    )
  }

  return (
    <View style={card.card}>
      <View style={card.headerRow}>
        <Text style={card.title}>Training plan</Text>
        {editLink(look)}
      </View>
      {planInfo(look)}
      {planNotice(look)}
      {showNext && nextSpec && (
        <View style={styles.box}>
          {nextStatus(look)}
          <Text style={styles.nextTitle}>
            Next: workout {nextSpec.index} · week {Math.max(1, planWeek(plan!.windowStart, today, plan!.pauses))}
          </Text>
          {nextRows(look)}
          {nextActions(look)}
        </View>
      )}
      {extraSession}
      {modals}
    </View>
  )
}

// The styles a piece of the card is drawn with — from the scope it sits in
// (the ink plan card is dark inside, whatever the app's mode).
type Look = { C: Palette; P: PaperTheme | null; card: ReturnType<typeof cardSheet.get>; styles: ReturnType<typeof stylesSheet.get> }
function Themed({ children }: { children: (t: Look) => React.ReactNode }) {
  const C = useC()
  const P = usePaperScope()
  const card = useSheet(cardSheet)
  const styles = useSheet(stylesSheet)
  return <>{children({ C, P, card, styles })}</>
}

// "Workouts done 5/12" with a bar under it (Paper plan card).
function BigStat({ label, value, of }: { label: string; value: number; of: number }) {
  const styles = useSheet(stylesSheet)
  return (
    <View style={styles.bigStat}>
      <Text style={styles.bigStatLabel}>{label}</Text>
      <Text style={styles.bigStatNum}>{value}/{of}</Text>
      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${Math.min(100, Math.round((value / Math.max(1, of)) * 100))}%` }]} />
      </View>
    </View>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  const styles = useSheet(stylesSheet)
  return (
    <View style={styles.stat}>
      <Text style={styles.statNum}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  )
}

function PickRow({ color, text, detail, onSwap }: { color: string; text: string; detail?: string; onSwap?: () => void }) {
  const styles = useSheet(stylesSheet)
  const card = useSheet(cardSheet)
  const P = usePaperScope()
  if (P) {
    // Paper: mono category, the block on its own line, a Swap pill.
    const cut = text.indexOf(" · ")
    const label = cut > 0 ? text.slice(0, cut) : ""
    const title = cut > 0 ? text.slice(cut + 3) : text
    return (
      <View style={styles.nextRow}>
        <View style={{ flex: 1, gap: 3 }}>
          {!!label && <Text style={styles.nextRowLabel}>{label}</Text>}
          <Text style={styles.nextRowTitle}>{title}</Text>
          {!!detail && <Text style={card.sub}>{detail}</Text>}
        </View>
        {onSwap && (
          <Pressable onPress={onSwap} hitSlop={6} style={styles.swapBtn} accessibilityLabel={`Swap ${title}`}>
            <Text style={styles.swapText}>⇄ Swap</Text>
          </Pressable>
        )}
      </View>
    )
  }
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
  const styles = useSheet(stylesSheet)
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

const stylesSheet = paperSheet((C, P) => StyleSheet.create({
  // Paper: the ink plan card (dark scope inside) and the outlined next workout.
  // The plan card is drawn in the opposite scope: ink on light paper, a
  // light card on dark.
  inkCard: P?.mode === "dark"
    ? { backgroundColor: "#121014", borderColor: "rgba(255,255,255,0.08)" }
    : { backgroundColor: "#F6F3ED", borderColor: "rgba(18,16,20,0.12)" },
  nextCard: P ? { borderWidth: 2, borderColor: P.ink, backgroundColor: P.mode === "light" ? "#FBF9F5" : P.card } : {},
  planEyebrow: { fontSize: 11, fontWeight: "600", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 1.2 },
  editLink: P ? { fontSize: 13, fontWeight: "800", color: P.ink, textDecorationLine: "underline" } : { fontSize: 13, fontWeight: "700", color: C.green },
  nextHeadline: P ? { fontFamily: font.title, fontSize: 30, letterSpacing: -0.3, color: P.ink } : {},
  nextRows: { borderTopWidth: 1, borderTopColor: C.border },
  nextRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  nextRowLabel: { fontSize: 10.5, fontWeight: "600", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 1.3 },
  nextRowTitle: { fontSize: 16, fontWeight: "800", color: C.textPrimary },
  swapBtn: P ? { borderWidth: 1.5, borderColor: P.ink, borderRadius: 999, paddingHorizontal: 12, minHeight: 34, justifyContent: "center" } : {},
  swapText: { fontSize: 13, fontWeight: "800", color: C.textPrimary },
  bigStats: { flexDirection: "row", gap: 16, flexWrap: "wrap" },
  bigStat: { flex: 1, minWidth: 110, gap: 4 },
  bigStatLabel: { fontSize: 10.5, fontWeight: "600", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 1.3 },
  bigStatNum: P ? { fontFamily: font.title, fontSize: 44, lineHeight: 48, color: P.ink, fontVariant: ["tabular-nums"] } : {},
  bar: { height: 6, borderRadius: 3, backgroundColor: C.surfaceHigh, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3, backgroundColor: C.green },
  planName: { fontSize: 18, fontWeight: "800", color: C.textPrimary },
  planWindow: { fontSize: 13, color: C.textSecondary, fontVariant: ["tabular-nums"] },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { backgroundColor: C.surfaceHigh, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 11.5, fontWeight: "600", color: C.textSecondary },
  statsRow: { flexDirection: "row", gap: 8 },
  benchRow: { gap: 2 },
  benchLabel: { fontSize: 12, fontWeight: "700", color: C.textSecondary },
  benchText: { fontSize: 13, color: C.textPrimary },
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
}))
