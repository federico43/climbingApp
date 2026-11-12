import { ConsumeAuth } from "@/components/auth-context"
import {
  Body, Card, CardTitle, IconButton, Melt, MintButton, Mono, PaperScreen, PosterHeadline, ProgressBar,
  RailAnchor, SectionHeader, SpecsRow, usePaper, usePaperStyles,
} from "@/components/paper"
import { SettingsButton } from "@/components/SettingsButton"
import { font, type PaperTheme } from "@/theme/paper/tokens"
import { LatestWorkoutCard, pickLatestWorkout } from "@/components/LatestWorkoutCard"
import { LaunchExtras } from "@/components/LaunchExtras"
import { HomeworkSection } from "@/components/HomeworkSection"
import { ConditioningBasics, ConditioningBasicsCard } from "@/components/ConditioningBasics"
import { trainingDays } from "@/utils/extraSession"
import { PlanTimelineCard } from "@/components/PlanTimelineCard"
import { BlockProgressCard } from "@/components/BlockProgressCard"
import type { StatsLibraryExercise } from "@/utils/athleteStatsData"
import { getExerciseLibrary } from "@/utils/exerciseLibraryCache"
import { currentOrNextPause, pauseOn, type PlanPause } from "@/utils/planPauses"
import { ThisWeekCard } from "@/components/schedule/ThisWeekCard"
import { CardioSection } from "@/components/cardio/CardioSection"
import { NewSequenceButton } from "@/components/NewSequenceButton"
import { useActivePlan } from "@/contexts/ActivePlanContext"
import { refreshClassSchedule } from "@/utils/classScheduleStore"
import { useWorkoutContext } from "@/contexts/WorkoutContext"
import {
  getActiveTrainingPlan,
  BlockRow,
  getSessions,
  getUsers,
  listAthleteTemplates,
  listBlocks,
  listPlanWorkouts,
  ProtocolRow,
  SessionRow,
  sessionLinkFor,
  TrainingPlanRow,
} from "@/services/BoulderGraphService"
import { ADAPTATION_COLOR } from "@/utils/adaptations"
import { MOVEMENT_TYPE_LABEL } from "@/utils/movementTypes"
import {
  daysLeft as planDaysLeft,
  donePlanWorkouts,
  doneThisWeek,
} from "@/utils/planProgress"
import {
  addDays,
  localDateStr,
  builtMainType,
  hasBuiltMainBlock,
  canRotate,
  isConditioningOnly,
  MAIN_CYCLE,
  PLAN_WEEKS,
  planWeek,
  mainTypeFor,
  effectiveFocus,
  mainTypeLabel,
  MainType,
  PlanKind,
  PLAN_FOCUS_LABEL,
  PLAN_WORKOUTS,
  SC_FOCUS_FOR,
  WORKOUTS_PER_WEEK,
  workoutSpec,
} from "@/utils/planRotation"
import { FOCUS_LABEL, type Focus } from "@/utils/scProgression"
import {
  buildDurationHistory,
  formatMinutes,
  summarizeBlocks,
  summarizeSpec,
  WorkoutSummary,
} from "@/utils/workoutSummary"
import { Ionicons } from "@expo/vector-icons"
import { useFocusEffect } from "@react-navigation/native"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native"

function shortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function parseBlocks(p: ProtocolRow): any[] {
  try { return JSON.parse(p.blocks) } catch { return [] }
}

type SlotStatus = "done" | "ready" | "upcoming"

interface Slot {
  index: number
  status: SlotStatus
  mainType: MainType
  mainBlock: string        // main block name, e.g. "Project Bouldering"
  week: number
  kicker: string           // main type, e.g. "Power endurance"
  kickerColor: string // category dot
  title: string            // the built workout's name, else the main block
  when: string             // "Done 25 Sep" / "Week 3"
  summary: WorkoutSummary | null
  workout: ProtocolRow | null
}

// Athlete's training plan: focus, days left, workouts left.
export default function PlanScreen() {
  const { User, userName } = ConsumeAuth()
  const workoutCtx = useWorkoutContext()
  const [plan, setPlan] = useState<TrainingPlanRow | null>(null)
  const [workouts, setWorkouts] = useState<ProtocolRow[]>([])
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [library, setLibrary] = useState<BlockRow[]>([])
  const [templates, setTemplates] = useState<ProtocolRow[]>([])
  // For "How this block is going": the S&C exercises' movement patterns and
  // the athlete's Edge Lifts max log.
  const [exercises, setExercises] = useState<StatsLibraryExercise[]>([])
  const [edgeLiftMaxLog, setEdgeLiftMaxLog] = useState<string | null>(null)
  const [homeWorkoutId, setHomeWorkoutId] = useState<string | null>(null)
  // The athlete's fixed classes ("day@start"), for the conditioning slides.
  const [defaultClasses, setDefaultClasses] = useState<string[]>([])
  const activePlan = useActivePlan()
  // Read through a ref so load() doesn't change (and re-fire) whenever the context re-renders.
  const activePlanRef = useRef(activePlan)
  activePlanRef.current = activePlan
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    try {
      const active = await getActiveTrainingPlan(User!.$id)
      setPlan(active)
      setError(false)
      // Keep the tab layout (Home shown or not) in step with what we found.
      if (!!active !== !!activePlanRef.current.plan) activePlanRef.current.refresh()
      if (!active) return
      const [planWorkouts, sessionRows, blocks, templateRows, exerciseRows, userRow] = await Promise.all([
        listPlanWorkouts(active.$id),
        getSessions(),
        // Library blocks time the upcoming workouts' summaries.
        listBlocks().catch(() => [] as BlockRow[]),
        // For the latest-built-workout card (any coach workout, plan or not).
        listAthleteTemplates(User!.$id, { migrate: false }).catch(() => [] as ProtocolRow[]),
        getExerciseLibrary().catch(() => []),
        // Edge Lifts max log, and the workout the coach picked for Home.
        getUsers(User!.$id).catch(() => null),
      ])
      setExercises(exerciseRows as StatsLibraryExercise[])
      setEdgeLiftMaxLog((userRow as any)?.edgeLiftMaxLog ?? null)
      setTemplates(templateRows)
      setHomeWorkoutId((userRow as any)?.homeWorkoutId ?? null)
      setDefaultClasses((userRow as any)?.defaultClasses ?? [])
      setLibrary(blocks)
      setWorkouts(planWorkouts)
      setSessions(sessionRows)
    } catch (e) {
      // Most likely the athlete can't read training_plans (permissions).
      console.error(e)
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [User])

  useFocusEffect(
    useCallback(() => {
      if (!User) return
      load()
      refreshClassSchedule()
    }, [User, load])
  )

  // Reload after a workout ends (refreshKey bumps from the provider)
  useEffect(() => {
    if (User && workoutCtx.refreshKey > 0) load()
  }, [User, load, workoutCtx.refreshKey])


  const t = usePaper()
  const refresh = async () => {
    setRefreshing(true)
    // The This week card reads the class store, not this screen's state.
    try { await Promise.all([load(), refreshClassSchedule()]) }
    finally { setRefreshing(false) }
  }

  return (
    <>
      <PaperScreen
        rail={{ top: 230 }}
        bottomPad={48}
        header={
          <View style={styles.header}>
            <Body weight={800} size={24} numberOfLines={1} style={{ flex: 1 }}>
              {userName ? `Hi, ${userName}` : "Your plan"}
            </Body>
            <View style={styles.headerActions}>
              {plan && <NewSequenceButton paper />}
              <SettingsButton paper />
            </View>
          </View>
        }
        scrollProps={{
          refreshControl: <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.mintDeep} colors={[t.mintDeep]} />,
        }}
      >
        {loading ? (
          <ActivityIndicator style={{ marginTop: 60 }} color={t.mintDeep} />
        ) : error || !plan ? (
          <View style={{ gap: 12, marginTop: 12 }}>
            <ThisWeekCard />
            <CardioSection />
            {error ? (
              <Empty icon="cloud-offline-outline" title="Couldn't load your plan" text="Pull down to try again." />
            ) : (
              <Empty icon="calendar-outline" title="No training plan yet" text="Your coach will set one up. It'll show here." />
            )}
          </View>
        ) : (
          <PlanBody
            plan={plan}
            templates={templates}
            homeWorkoutId={homeWorkoutId}
            workouts={workouts}
            sessions={sessions}
            library={library}
            exercises={exercises}
            edgeLiftMaxLog={edgeLiftMaxLog}
            defaultClasses={defaultClasses}
            onStart={(w) => workoutCtx.openWorkout(parseBlocks(w), w.name, sessionLinkFor(w))}
            onChanged={load}
          />
        )}
      </PaperScreen>
      {/* With a plan this tab is the app's home — Home's launch extras run here. */}
      {activePlan.plan && <LaunchExtras />}
    </>
  )
}

// ─── Body ─────────────────────────────────────────────────────────────────────

function PlanBody({
  plan,
  templates,
  homeWorkoutId,
  workouts,
  sessions,
  library,
  exercises,
  edgeLiftMaxLog,
  defaultClasses,
  onStart,
  onChanged,
}: {
  plan: TrainingPlanRow
  templates: ProtocolRow[]
  homeWorkoutId: string | null
  workouts: ProtocolRow[]
  sessions: SessionRow[]
  library: BlockRow[]
  exercises: StatsLibraryExercise[]
  edgeLiftMaxLog: string | null
  defaultClasses: string[]
  onStart: (w: ProtocolRow) => void
  onChanged: () => void
}) {
  const today = localDateStr(new Date())
  const { windowStart, windowEnd } = plan
  const notStarted = today < windowStart
  const over = today > windowEnd
  const conditioning = isConditioningOnly(plan)
  const week = Math.min(Math.max(planWeek(windowStart, today, plan.pauses), 1), PLAN_WEEKS)
  const left = planDaysLeft(windowStart, windowEnd, today, plan.pauses)

  const done = donePlanWorkouts(plan.$id, workouts, sessions)
  const doneCount = done.size
  const thisWeek = doneThisWeek(windowStart, done, today, plan.pauses)
  // A pause running now replaces "Up next"; one coming up soon gets a heads-up.
  const pause = over ? null : currentOrNextPause(plan.pauses, today)
  const pausedNow = !!pause && !!pauseOn([pause], today)
  const pauseSoon = !!pause && !pausedNow && pause.start <= addDays(today, 7)

  // Built climbing workouts by slot (newest wins if a slot was rebuilt).
  const builtBySlot = new Map<number, ProtocolRow>()
  for (const w of workouts) {
    if (w.planPart || !w.planIndex) continue // split-off S&C / homework
    const prev = builtBySlot.get(w.planIndex)
    if (!prev || w.$createdAt > prev.$createdAt) builtBySlot.set(w.planIndex, w)
  }
  const built = [...builtBySlot.values()].map((w) => ({ planIndex: w.planIndex!, createdAt: w.$createdAt, blocks: w.blocks }))

  const history = useMemo(() => buildDurationHistory(sessions), [sessions])

  const slots: Slot[] = []
  for (let n = 1; n <= PLAN_WORKOUTS; n++) {
    const workout = builtBySlot.get(n) ?? null
    const spec = canRotate(plan) ? workoutSpec(plan, n, built, today) : null
    const summary = workout
      ? summarizeBlocks(parseBlocks(workout), history)
      : spec
        ? summarizeSpec(spec, plan, library, history)
        : null
    const doneOn = done.get(n)
    const status: SlotStatus = doneOn ? "done" : workout && !over ? "ready" : "upcoming"
    const mainPhase = summary?.phases.find((p) => p.key === "main")
    slots.push({
      index: n,
      status,
      mainType: spec?.mainType ?? (workout ? builtMainType(n, workout.blocks) : mainTypeFor(n, plan.startType)),
      mainBlock: spec?.mainBlock?.name ?? mainPhase?.title ?? "",
      week: Math.ceil(n / WORKOUTS_PER_WEEK),
      kicker: spec ? mainTypeLabel(spec.mainType, plan.kind, plan.scFocuses) : `Workout ${n}`,
      kickerColor: spec ? ADAPTATION_COLOR[spec.mainType] : "transparent",
      title: workout?.name ?? mainPhase?.title ?? `Workout ${n}`,
      when: doneOn
        ? `Done ${shortDate(doneOn)}`
        : status === "ready" ? "Ready" : `Week ${Math.ceil(n / WORKOUTS_PER_WEEK)}`,
      summary,
      workout,
    })
  }
  // Shown by default: the one to do next (ready, else the first upcoming).
  const featured = (slots.find((s) => s.status === "ready") ?? slots.find((s) => s.status === "upcoming"))?.index ?? 1
  // A tapped tile opens its detail below the grid (none by default — the
  // latest workout card at the top already covers what's next).
  const [selected, setSelected] = useState<number | null>(null)
  const shown = selected ? slots.find((s) => s.index === selected) ?? null : null
  const { workout: latest, scPart } = pickLatestWorkout(templates, homeWorkoutId)
  // The headline: the main attribute of the workout on screen ("Today's
  // focus"); the plan's focus when there's none or it has no climbing block.
  const showsWorkout = !!latest && !(pause && (pausedNow || pauseSoon))
  const todayType = showsWorkout && hasBuiltMainBlock(latest!.blocks)
    ? builtMainType(latest!.planIndex ?? 1, latest!.blocks)
    : null
  const focusWord = todayType
    ? mainTypeLabel(todayType, plan.kind, plan.scFocuses)
    : conditioning ? "Conditioning" : plan.focus ? PLAN_FOCUS_LABEL[plan.focus] : "Training"
  const focusEyebrow = todayType ? "Today's focus" : conditioning ? "Your plan" : "This week's focus"
  // Homework rides on the athlete's templates (planPart "homework"); its
  // picked days show on the timeline like events.
  const homework = templates.filter((t) => t.planPart === "homework")
  // The conditioning slides wait while "You've got homework" may want the
  // screen (a homework without a day yet).
  const homeworkPrompt = homework.some((h) => !h.scheduledFor)
  const gymDays = useMemo(() => trainingDays(defaultClasses, sessions, today), [defaultClasses, sessions, today])

  const specsRight = notStarted
    ? [`Starts *${shortDate(windowStart)}*`]
    : over
      ? ["Plan finished"]
      : pausedNow
        ? ["Paused", `Back *${shortDate(addDays(pause!.end, 1))}*`]
        : [`*${left}* day${left !== 1 ? "s" : ""} left`, `*${thisWeek}* of ${WORKOUTS_PER_WEEK} this week`]

  return (
    <>
      {/* ── Poster: the week's focus, melting into the cards ─────────────── */}
      <View style={{ marginTop: 20 }}>
        <Melt top={40} />
        <Mono>{focusEyebrow}</Mono>
        <PosterHeadline style={{ marginTop: 8 }}>{focusWord}</PosterHeadline>
        <SpecsRow
          left={[`Week *${week}* of ${PLAN_WEEKS}`, `${shortDate(windowStart)} – ${shortDate(windowEnd)}`]}
          right={specsRight}
        />
        {plan.hasSc && (plan.scPatterns.length > 0 || plan.hasMobility) && (
          <ScSummary patterns={plan.scPatterns.map((p) => p.movementType)} hasMobility={plan.hasMobility} />
        )}
      </View>

      {/* ── Now: homework (it has a deadline), then the next workout ────── */}
      <View style={{ gap: 12, marginTop: 48 }}>
        {homework.length > 0 && (
          <RailAnchor label="Homework">
            <HomeworkSection homework={homework} sessions={sessions} onStart={onStart} onChanged={onChanged} />
          </RailAnchor>
        )}
        {pause && (pausedNow || pauseSoon) ? (
          <PauseCard pause={pause} now={pausedNow} />
        ) : latest && (
          <RailAnchor label="Sequence">
            <LatestWorkoutCard workout={latest} scPart={scPart} />
          </RailAnchor>
        )}
        <ThisWeekCard />
        <CardioSection />
        {plan.hasSc && <ConditioningBasicsCard />}
      </View>
      {plan.hasSc && <ConditioningBasics gymDays={gymDays} ready={!homeworkPrompt} />}

      {/* ── The plan as a whole ───────────────────────────────────────────── */}
      <RailAnchor label="Training plan">
        <SectionHeader>Your training plan</SectionHeader>
      </RailAnchor>
      <View style={{ gap: 12 }}>
        <PlanTimelineCard plan={plan} sessions={sessions} homework={homework} />

        {!notStarted && (
          <BlockProgressCard plan={plan} workouts={workouts} sessions={sessions} library={exercises} edgeLiftMaxLog={edgeLiftMaxLog} />
        )}

        <WorkoutsCard
          slots={slots}
          doneCount={doneCount}
          thisWeek={!over && !notStarted && !pausedNow ? thisWeek : null}
          plan={plan}
          selected={selected}
          onSelect={(n) => setSelected((cur) => (cur === n ? null : n))}
        />

        {shown && (
          <WorkoutDetail
            slot={shown}
            isNext={shown.index === featured}
            onClose={() => setSelected(null)}
            onStart={onStart}
          />
        )}
      </View>
    </>
  )
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

// The plan's S&C movement patterns, under the specs. Specific exercises
// are left to the workout.
function ScSummary({ patterns, hasMobility }: { patterns: string[]; hasMobility: boolean }) {
  const s = usePaperStyles(makeStyles)
  return (
    <View style={s.scBox}>
      <Mono size={10}>S&C focus</Mono>
      <View style={s.chips}>
        {patterns.map((p) => (
          <View key={p} style={s.chip}>
            <Text style={s.chipText}>{MOVEMENT_TYPE_LABEL[p as keyof typeof MOVEMENT_TYPE_LABEL] ?? p}</Text>
          </View>
        ))}
        {hasMobility && (
          <View style={[s.chip, s.chipMuted]}>
            <Text style={s.chipText}>+ Mobility</Text>
          </View>
        )}
      </View>
    </View>
  )
}

// The coach paused the plan (holidays, an injury): until when, and why.
function PauseCard({ pause, now }: { pause: PlanPause; now: boolean }) {
  return (
    <Card eyebrow={pause.reason ?? (now ? "Plan paused" : "Pause coming up")}>
      <CardTitle size={30}>
        {now ? `Back on ${shortDate(addDays(pause.end, 1))}` : `${shortDate(pause.start)} – ${shortDate(pause.end)}`}
      </CardTitle>
      <Body muted size={14} style={{ marginTop: 8, lineHeight: 20 }}>
        {now
          ? "Your plan is on hold and its end date moved back. No classes until then, and your package and homework deadlines moved too."
          : "Your coach set a pause. Your plan and package will wait for you."}
      </Body>
    </Card>
  )
}

// Workouts done out of 12, then the 12 grouped by main type.
function WorkoutsCard({ slots, doneCount, thisWeek, plan, selected, onSelect }: {
  slots: Slot[]
  doneCount: number
  thisWeek: number | null
  plan: TrainingPlanRow
  selected: number | null
  onSelect: (index: number) => void
}) {
  const t = usePaper()
  return (
    <Card eyebrow="Workouts">
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10 }}>
        <CardTitle size={56} style={{ lineHeight: 52 }}>{String(doneCount)}</CardTitle>
        <View style={{ paddingBottom: 6, gap: 2 }}>
          <Mono color={t.ink}>of {PLAN_WORKOUTS} done</Mono>
          <Mono>{Math.max(PLAN_WORKOUTS - doneCount, 0)} left</Mono>
        </View>
        {thisWeek != null && (
          <Mono style={{ marginLeft: "auto", paddingBottom: 6 }} color={t.mintText}>
            This week {thisWeek}/{WORKOUTS_PER_WEEK}
          </Mono>
        )}
      </View>
      <ProgressBar progress={doneCount / PLAN_WORKOUTS} style={{ marginTop: 14 }} />
      <TypeColumns
        slots={slots}
        hasSc={plan.hasSc}
        scFocuses={plan.scFocuses}
        kind={plan.kind}
        startType={plan.startType}
        selected={selected}
        onSelect={onSelect}
      />
    </Card>
  )
}

// The 12 workouts grouped by main type — the rotation's three pillars, 4
// each. Per type: one circle per workout (filled = done, thick ring = built
// and ready, faint ring = to come) and the count. Tap one for that workout.
function TypeColumns({
  slots,
  hasSc,
  scFocuses,
  kind,
  startType,
  selected,
  onSelect,
}: {
  slots: Slot[]
  hasSc: boolean
  scFocuses: Focus[]
  kind: PlanKind
  startType: MainType | null
  selected: number | null
  onSelect: (index: number) => void
}) {
  const t = usePaper()
  const s = usePaperStyles(makeStyles)
  return (
    <View style={s.columns}>
      {/* In the plan's own order: its first workout's type first. */}
      {MAIN_CYCLE.map((_, i) => mainTypeFor(i + 1, startType)).map((type) => {
        const mine = slots.filter((x) => x.mainType === type)
        const doneN = mine.filter((x) => x.status === "done").length
        return (
          <View key={type} style={s.column}>
            <View style={{ flexDirection: "row", gap: 6, minHeight: 28 }}>
              <View style={[s.catDot, { backgroundColor: ADAPTATION_COLOR[type] }]} />
              <Mono color={t.ink} size={9.5} style={{ flex: 1, lineHeight: 13 }} numberOfLines={2}>
                {mainTypeLabel(type, kind, scFocuses)}
              </Mono>
            </View>
            {/* Conditioning plans: the title already is the S&C focus. */}
            {hasSc && kind !== "conditioning" && <Mono size={9} numberOfLines={1}>{FOCUS_LABEL[effectiveFocus(SC_FOCUS_FOR[type], scFocuses)]}</Mono>}
            <View style={s.dots}>
              {mine.map((x) => {
                const isDone = x.status === "done"
                const isReady = x.status === "ready"
                return (
                  <Pressable
                    key={x.index}
                    onPress={() => onSelect(x.index)}
                    hitSlop={4}
                    accessibilityLabel={`Workout ${x.index}, ${isDone ? "done" : isReady ? "ready" : "to come"}`}
                    style={[
                      s.dot,
                      isDone ? s.dotDone : isReady ? s.dotReady : s.dotUpcoming,
                      x.index === selected && s.dotSelected,
                    ]}
                  >
                    {isDone && <Ionicons name="checkmark" size={11} color={t.onMint} />}
                  </Pressable>
                )
              })}
            </View>
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 4, marginTop: 8 }}>
              <CardTitle size={26}>{String(doneN)}</CardTitle>
              <Mono size={9} style={{ paddingBottom: 3 }}>of {mine.length}</Mono>
            </View>
          </View>
        )
      })}
    </View>
  )
}

// The selected workout — phases with minutes.
function WorkoutDetail({
  slot,
  isNext,
  onClose,
  onStart,
}: {
  slot: Slot
  isNext: boolean
  onClose: () => void
  onStart: (w: ProtocolRow) => void
}) {
  const t = usePaper()
  const s = usePaperStyles(makeStyles)
  const { summary } = slot
  const isReady = slot.status === "ready"
  return (
    <Card>
      <View style={s.detailHeadRow}>
        <Mono>{isNext ? "Next up · " : ""}Workout {slot.index} · Week {slot.week}</Mono>
        <IconButton icon="close" label="Close" size={32} onPress={onClose} />
      </View>
      <View style={s.detailTitleRow}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={[s.catDot, { backgroundColor: slot.kickerColor, marginTop: 0 }]} />
            <Mono>{slot.kicker}</Mono>
          </View>
          <CardTitle size={28} style={{ marginTop: 4 }}>{slot.title}</CardTitle>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          {summary && <CardTitle size={24}>{`~${formatMinutes(summary.minutes)}`}</CardTitle>}
          <Mono color={slot.status === "done" ? t.mintText : t.label}>{slot.when}</Mono>
        </View>
      </View>

      {summary && summary.minutes > 0 && (
        <View style={s.timeBar}>
          {summary.phases.map((p, i) => (
            <View key={i} style={{ flex: p.minutes, backgroundColor: ADAPTATION_COLOR[p.adaptation] }} />
          ))}
        </View>
      )}

      {summary && (
        <View style={s.phaseList}>
          {summary.phases.map((p, i) => (
            <View key={i} style={s.phaseRow}>
              <View style={[s.phaseRail, { backgroundColor: ADAPTATION_COLOR[p.adaptation] }]} />
              <View style={{ flex: 1 }}>
                <Mono size={9.5}>{p.label}</Mono>
                <Body weight={700} size={15} numberOfLines={1} style={{ marginTop: 2 }}>{p.title}</Body>
                {p.detail ? <Body muted size={12.5} numberOfLines={2}>{p.detail}</Body> : null}
              </View>
              <Mono color={t.ink}>{formatMinutes(p.minutes)}</Mono>
            </View>
          ))}
        </View>
      )}

      {isReady && slot.workout ? (
        <MintButton label="Start workout" icon="play" onPress={() => onStart(slot.workout!)} style={{ marginTop: 16 }} />
      ) : slot.status === "upcoming" ? (
        <Mono italic style={{ marginTop: 14 }}>Preview · your coach builds the exact workout</Mono>
      ) : null}
    </Card>
  )
}

function Empty({ icon, title, text }: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string }) {
  const t = usePaper()
  return (
    <Card style={{ alignItems: "center", paddingVertical: 36, gap: 10 }}>
      <Ionicons name={icon} size={34} color={t.label} />
      <CardTitle size={26} style={{ textAlign: "center" }}>{title}</CardTitle>
      <Body muted size={14} style={{ textAlign: "center" }}>{text}</Body>
    </Card>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 12,
  },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 10 },
})

const makeStyles = (t: PaperTheme) => StyleSheet.create({
  // S&C patterns under the specs
  scBox: { marginTop: 14, gap: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderRadius: 999, borderWidth: 1.5, borderColor: t.ink, paddingHorizontal: 10, paddingVertical: 4 },
  chipMuted: { borderColor: t.ghostBorder },
  chipText: { fontFamily: font.bodyBold, fontSize: 12.5, color: t.ink },

  // Type columns
  columns: { flexDirection: "row", gap: 10, marginTop: 18 },
  column: { flex: 1, borderTopWidth: 1.5, borderTopColor: t.ink, paddingTop: 10, gap: 4 },
  catDot: { width: 8, height: 8, borderRadius: 4, marginTop: 2 },
  dots: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 10 },
  dot: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  dotDone: { backgroundColor: t.mint, borderWidth: 1.5, borderColor: t.mode === "dark" ? t.mint : t.ink },
  dotReady: { borderWidth: 2.5, borderColor: t.mintDeep },
  dotUpcoming: { borderWidth: 1.5, borderColor: t.ringIdle },
  dotSelected: { transform: [{ scale: 1.25 }] },

  // Workout detail
  detailHeadRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  detailTitleRow: { flexDirection: "row", alignItems: "flex-end", gap: 12, marginTop: 10 },
  timeBar: { flexDirection: "row", height: 6, borderRadius: 3, overflow: "hidden", gap: 2, marginTop: 16 },
  phaseList: { gap: 12, paddingTop: 14 },
  phaseRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  phaseRail: { width: 3, alignSelf: "stretch", borderRadius: 2 },
})
