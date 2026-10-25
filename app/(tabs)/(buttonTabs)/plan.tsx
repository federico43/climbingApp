import { C } from "@/utils/theme"
import { ConsumeAuth } from "@/components/auth-context"
import { ScalePressable } from "@/components/ScalePressable"
import { ScreenEntry } from "@/components/ScreenEntry"
import { ScreenGradient } from "@/components/ScreenGradient"
import { SettingsButton } from "@/components/SettingsButton"
import { LatestWorkoutCard, pickLatestWorkout } from "@/components/LatestWorkoutCard"
import { LaunchExtras } from "@/components/LaunchExtras"
import { HomeworkSection } from "@/components/HomeworkSection"
import { PlanTimelineCard } from "@/components/PlanTimelineCard"
import { ThisWeekCard } from "@/components/schedule/ThisWeekCard"
import { NewSequenceButton } from "@/components/NewSequenceButton"
import { useActivePlan } from "@/contexts/ActivePlanContext"
import { refreshClassSchedule } from "@/utils/classScheduleStore"
import { useWorkoutContext } from "@/contexts/WorkoutContext"
import {
  getActiveTrainingPlan,
  BlockRow,
  getSessions,
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
  donePlanWorkouts,
  doneThisWeek,
} from "@/utils/planProgress"
import {
  localDateStr,
  builtMainType,
  MAIN_CYCLE,
  mainTypeFor,
  MainType,
  PLAN_FOCUS_LABEL,
  PLAN_WORKOUTS,
  SC_FOCUS_FOR,
  WORKOUTS_PER_WEEK,
  workoutSpec,
} from "@/utils/planRotation"
import { FOCUS_LABEL } from "@/utils/scProgression"
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
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import Svg, { Circle } from "react-native-svg"

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
  kickerColor: string
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
      const [planWorkouts, sessionRows, blocks, templateRows] = await Promise.all([
        listPlanWorkouts(active.$id),
        getSessions(),
        // Library blocks time the upcoming workouts' summaries.
        listBlocks().catch(() => [] as BlockRow[]),
        // For the latest-built-workout card (any coach workout, plan or not).
        listAthleteTemplates(User!.$id, { migrate: false }).catch(() => [] as ProtocolRow[]),
      ])
      setTemplates(templateRows)
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


  return (
    <ScreenGradient>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScreenEntry>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>
                {userName ? `${userName}'s plan` : "Training plan"}
              </Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {plan ? `${plan.name}` : "Your current training period"}
              </Text>
            </View>
            <View style={styles.headerActions}>
              {plan && <NewSequenceButton />}
              <SettingsButton />
            </View>
          </View>

          {loading ? (
            <ActivityIndicator style={{ marginTop: 60 }} color={C.green} />
          ) : (
            <ScrollView
              contentContainerStyle={styles.scroll}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={async () => {
                    setRefreshing(true)
                    // The This week card reads the class store, not this screen's state.
                    try { await Promise.all([load(), refreshClassSchedule()]) }
                    finally { setRefreshing(false) }
                  }}
                  tintColor={C.green}
                  colors={[C.green]}
                />
              }
            >
              <ThisWeekCard />
              {error ? (
                <Empty icon="cloud-offline-outline" title="Couldn't load your plan" text="Pull down to try again." />
              ) : !plan ? (
                <Empty
                  icon="calendar-outline"
                  title="No training plan yet"
                  text="Your coach will set one up — it'll show here."
                />
              ) : (
                <PlanBody
                  plan={plan}
                  templates={templates}
                  workouts={workouts}
                  sessions={sessions}
                  library={library}
                  onStart={(w) => workoutCtx.openWorkout(parseBlocks(w), w.name, sessionLinkFor(w))}
                  onChanged={load}
                />
              )}
            </ScrollView>
          )}
        </ScreenEntry>
      </SafeAreaView>
      {/* With a plan this tab is the app's home — Home's launch extras run here. */}
      {activePlan.plan && <LaunchExtras />}
    </ScreenGradient>
  )
}

// ─── Body ─────────────────────────────────────────────────────────────────────

function PlanBody({
  plan,
  templates,
  workouts,
  sessions,
  library,
  onStart,
  onChanged,
}: {
  plan: TrainingPlanRow
  templates: ProtocolRow[]
  workouts: ProtocolRow[]
  sessions: SessionRow[]
  library: BlockRow[]
  onStart: (w: ProtocolRow) => void
  onChanged: () => void
}) {
  const today = localDateStr(new Date())
  const { windowStart, windowEnd } = plan
  const notStarted = today < windowStart
  const over = today > windowEnd
  const focusColor = plan.focus ? ADAPTATION_COLOR[plan.focus] : C.textSecondary

  const done = donePlanWorkouts(plan.$id, workouts, sessions)
  const doneCount = done.size
  const thisWeek = doneThisWeek(windowStart, done, today)

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
    const spec = plan.focus
      ? workoutSpec({ ...plan, focus: plan.focus }, n, built, today)
      : null
    const summary = workout
      ? summarizeBlocks(parseBlocks(workout), history)
      : spec && plan.focus
        ? summarizeSpec(spec, { ...plan, focus: plan.focus }, library, history)
        : null
    const doneOn = done.get(n)
    const status: SlotStatus = doneOn ? "done" : workout && !over ? "ready" : "upcoming"
    const mainPhase = summary?.phases.find((p) => p.key === "main")
    slots.push({
      index: n,
      status,
      mainType: spec?.mainType ?? (workout ? builtMainType(n, workout.blocks) : mainTypeFor(n, plan.startType)),
      mainBlock: spec?.mainBlock.name ?? mainPhase?.title ?? "",
      week: Math.ceil(n / WORKOUTS_PER_WEEK),
      kicker: spec ? PLAN_FOCUS_LABEL[spec.mainType] : `Workout ${n}`,
      kickerColor: spec ? ADAPTATION_COLOR[spec.mainType] : C.textSecondary,
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
  const { workout: latest, scPart } = pickLatestWorkout(templates)
  // Homework rides on the athlete's templates (planPart "homework"); its
  // picked days show on the timeline like events.
  const homework = templates.filter((t) => t.planPart === "homework")


  return (
    <>
      {/* Two groups: what to do now, then the plan as a whole. Homework
          first — it has a deadline, the next workout doesn't. */}
      {homework.length > 0 && (
        <View style={styles.group}>
          <HomeworkSection homework={homework} sessions={sessions} onStart={onStart} onChanged={onChanged} />
        </View>
      )}

      {latest && (
        <View style={[styles.group, homework.length > 0 && styles.groupSpaced]}>
          <GroupLabel icon="flash" text="Up next" />
          <LatestWorkoutCard workout={latest} scPart={scPart} />
        </View>
      )}

      <View style={[styles.group, (latest || homework.length > 0) && styles.groupSpaced]}>
      <GroupLabel icon="calendar" text="Your training plan" />

      {/* ── Focus ─────────────────────────────────────────────────────────── */}
      <View style={styles.card}>
        <Text style={styles.kicker}>This week&apos;s focus</Text>
        <Text style={[styles.focusName, { color: focusColor }]}>
          {plan.focus ? PLAN_FOCUS_LABEL[plan.focus] : "Not set yet"}
        </Text>
        {plan.hasSc && plan.scPatterns.length > 0 && (
          <ScSummary patterns={plan.scPatterns.map((p) => p.movementType)} hasMobility={plan.hasMobility} />
        )}
      </View>

      {/* ── Timeline: start → end, status, the 6-week day grid ─────────────── */}
      <PlanTimelineCard plan={plan} sessions={sessions} homework={homework} />

      {/* ── Workouts ──────────────────────────────────────────────────────── */}
      <View style={styles.card}>
        <View style={styles.workoutsTop}>
          <ProgressRing done={doneCount} total={PLAN_WORKOUTS} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.cardTitle}>Workouts</Text>
            <Text style={styles.workoutsLeft}>
              {Math.max(PLAN_WORKOUTS - doneCount, 0)} left
            </Text>
            {!over && !notStarted && (
              <Text style={styles.workoutsWeek}>
                This week: {thisWeek} of {WORKOUTS_PER_WEEK} done
              </Text>
            )}
          </View>
        </View>

        <TypeColumns
          slots={slots}
          hasSc={plan.hasSc}
          startType={plan.startType}
          selected={selected}
          onSelect={(n) => setSelected((cur) => (cur === n ? null : n))}
        />
      </View>

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

// The plan's S&C movement patterns, under the focus title. Specific
// exercises are left to the workout.
function ScSummary({ patterns, hasMobility }: { patterns: string[]; hasMobility: boolean }) {
  return (
    <View style={styles.scBox}>
      <Text style={styles.scBoxLabel}>Our conditioning focus</Text>
      <View style={styles.chips}>
      {patterns.map((p) => (
        <View key={p} style={styles.chip}>
          <Text style={styles.chipText}>{MOVEMENT_TYPE_LABEL[p as keyof typeof MOVEMENT_TYPE_LABEL] ?? p}</Text>
        </View>
      ))}
      {hasMobility && (
        <View style={[styles.chip, styles.chipMuted]}>
          <Text style={[styles.chipText, { color: C.textSecondary }]}>+ Mobility</Text>
        </View>
      )}
      </View>
    </View>
  )
}

// Heading for a group of cards on the page.
function GroupLabel({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.groupLabel}>
      <Ionicons name={icon} size={14} color={C.green} />
      <Text style={styles.groupLabelText}>{text}</Text>
      <View style={styles.groupLabelLine} />
    </View>
  )
}

function ProgressRing({ done, total }: { done: number; total: number }) {
  const size = 84
  const stroke = 8
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const pct = Math.min(done / total, 1)
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={C.surfaceHigh} strokeWidth={stroke} fill="none" />
        {pct > 0 && <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={C.green}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference * pct} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />}
      </Svg>
      <Text style={styles.ringNum}>{done}</Text>
      <Text style={styles.ringTotal}>of {total}</Text>
    </View>
  )
}

// The 12 workouts grouped by main type — the rotation's three pillars, 4
// each. Per type: one dot per workout (filled = done, ring = built and
// ready, faint = to come) and the count. Tap a dot for that workout.
function TypeColumns({
  slots,
  hasSc,
  startType,
  selected,
  onSelect,
}: {
  slots: Slot[]
  hasSc: boolean
  startType: MainType | null
  selected: number | null
  onSelect: (index: number) => void
}) {
  return (
    <View style={styles.columns}>
      {/* In the plan's own order: its first workout's type first. */}
      {MAIN_CYCLE.map((_, i) => mainTypeFor(i + 1, startType)).map((type) => {
        const mine = slots.filter((s) => s.mainType === type)
        const color = ADAPTATION_COLOR[type]
        const doneN = mine.filter((s) => s.status === "done").length
        return (
          <View key={type} style={[styles.column, { borderTopColor: color }]}>
            <Text style={[styles.columnTitle, { color }]} numberOfLines={2}>
              {PLAN_FOCUS_LABEL[type]}
            </Text>
            {hasSc && <Text style={styles.columnSub} numberOfLines={1}>{FOCUS_LABEL[SC_FOCUS_FOR[type]]}</Text>}
            <View style={styles.dots}>
              {mine.map((s) => {
                const isDone = s.status === "done"
                const isReady = s.status === "ready"
                return (
                  <Pressable
                    key={s.index}
                    onPress={() => onSelect(s.index)}
                    hitSlop={4}
                    accessibilityLabel={`Workout ${s.index}`}
                    style={[
                      styles.dot,
                      isDone
                        ? { backgroundColor: color, borderColor: color }
                        : isReady
                          ? { borderColor: color, borderWidth: 3 }
                          : { borderColor: `${color}55` },
                      s.index === selected && styles.dotSelected,
                    ]}
                  >
                    {isDone && <Ionicons name="checkmark" size={12} color={C.bg} />}
                  </Pressable>
                )
              })}
            </View>
            <Text style={styles.columnCount}>
              <Text style={[styles.columnCountNum, { color }]}>{doneN}</Text>
              <Text style={styles.columnCountOf}> of {mine.length} done</Text>
            </Text>
          </View>
        )
      })}
    </View>
  )
}

// The selected workout (default: the next one) — phases with minutes.
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
  const { summary } = slot
  const color = ADAPTATION_COLOR[slot.mainType]
  const isReady = slot.status === "ready"
  return (
    <View style={[styles.card, isReady && { borderColor: color }]}>
      <View style={styles.detailHeadRow}>
        <Text style={styles.kicker}>
          {isNext ? "Next up · " : ""}Workout {slot.index} · Week {slot.week}
        </Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
          <Ionicons name="close" size={18} color={C.textSecondary} />
        </Pressable>
      </View>
      <View style={styles.detailTitleRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.slotKicker, { color }]}>{PLAN_FOCUS_LABEL[slot.mainType]}</Text>
          <Text style={styles.detailTitle}>{slot.title}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          {summary && <Text style={styles.detailMinutes}>~{formatMinutes(summary.minutes)}</Text>}
          <Text style={[styles.slotWhen, slot.status === "done" && { color }]}>{slot.when}</Text>
        </View>
      </View>

      {summary && summary.minutes > 0 && (
        <View style={styles.timeBar}>
          {summary.phases.map((p, i) => (
            <View key={i} style={{ flex: p.minutes, backgroundColor: ADAPTATION_COLOR[p.adaptation] }} />
          ))}
        </View>
      )}

      {summary && (
        <View style={styles.phaseList}>
          {summary.phases.map((p, i) => (
            <View key={i} style={styles.phaseRow}>
              <View style={[styles.phaseRail, { backgroundColor: ADAPTATION_COLOR[p.adaptation] }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.phaseLabel}>{p.label}</Text>
                <Text style={styles.phaseTitle} numberOfLines={1}>{p.title}</Text>
                {p.detail ? <Text style={styles.phaseDetail} numberOfLines={2}>{p.detail}</Text> : null}
              </View>
              <Text style={styles.phaseMinutes}>{formatMinutes(p.minutes)}</Text>
            </View>
          ))}
        </View>
      )}

      {isReady && slot.workout ? (
        <ScalePressable style={styles.slotStartBtn} onPress={() => onStart(slot.workout!)}>
          <Ionicons name="play" size={15} color={C.bg} />
          <Text style={styles.slotStartText}>Start workout</Text>
        </ScalePressable>
      ) : slot.status === "upcoming" ? (
        <Text style={styles.phaseNote}>Preview — your coach builds the exact workout.</Text>
      ) : null}
    </View>
  )
}

function Empty({ icon, title, text }: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={36} color={C.textMuted} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "transparent" },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 12,
  },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { fontSize: 28, fontWeight: "800", color: C.textPrimary, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: C.textSecondary, fontWeight: "500" },
  scroll: { paddingHorizontal: 16, paddingBottom: 40, gap: 16 },

  card: {
    backgroundColor: C.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    gap: 12,
  },
  cardTitle: { fontSize: 15, fontWeight: "700", color: C.textPrimary },

  kicker: { fontSize: 12, fontWeight: "700", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.8 },
  focusName: { marginTop: -6, fontSize: 30, fontWeight: "800", letterSpacing: -0.5 },


  // Workouts
  workoutsTop: { flexDirection: "row", alignItems: "center", gap: 16 },
  workoutsLeft: { fontSize: 22, fontWeight: "800", color: C.textPrimary },
  workoutsWeek: { fontSize: 13, color: C.textSecondary },
  ringNum: { fontSize: 24, fontWeight: "800", color: C.green, lineHeight: 26 },
  ringTotal: { fontSize: 11, color: C.textSecondary },

  // Type columns
  columns: { flexDirection: "row", gap: 10 },
  column: { flex: 1, borderTopWidth: 3, paddingTop: 10, gap: 4 },
  columnTitle: { height: 32, fontSize: 12.5, lineHeight: 16, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  columnSub: { fontSize: 11, color: C.textSecondary },
  dots: { flexDirection: "row", gap: 5, marginTop: 10 },
  dot: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2,
    alignItems: "center", justifyContent: "center",
  },
  dotSelected: { transform: [{ scale: 1.2 }] },
  columnCount: { marginTop: 8 },
  columnCountNum: { fontSize: 22, fontWeight: "800" },
  columnCountOf: { fontSize: 12, fontWeight: "600", color: C.textSecondary },

  // Workout detail
  detailHeadRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  detailTitleRow: { flexDirection: "row", alignItems: "flex-end", gap: 12, marginTop: -4 },
  detailTitle: { marginTop: 1, fontSize: 20, fontWeight: "800", color: C.textPrimary, letterSpacing: -0.3 },
  detailMinutes: { fontSize: 20, fontWeight: "800", color: C.textPrimary },
  slotKicker: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  slotWhen: { fontSize: 11.5, color: C.textMuted },

  // Time split by phase
  timeBar: { flexDirection: "row", height: 6, borderRadius: 3, overflow: "hidden", gap: 2 },

  phaseList: { gap: 10, paddingTop: 2 },
  phaseRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  phaseRail: { width: 3, alignSelf: "stretch", borderRadius: 2 },
  phaseLabel: { fontSize: 10.5, fontWeight: "700", color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.6 },
  phaseTitle: { marginTop: 1, fontSize: 14, fontWeight: "600", color: C.textPrimary },
  phaseDetail: { marginTop: 1, fontSize: 12, color: C.textSecondary },
  phaseMinutes: { fontSize: 13, fontWeight: "600", color: C.textSecondary },
  phaseNote: { fontSize: 11.5, color: C.textMuted, fontStyle: "italic" },

  slotStartBtn: {
    height: 42,
    borderRadius: 12,
    backgroundColor: C.green,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  slotStartText: { fontSize: 14.5, fontWeight: "800", color: C.bg },

  // S&C patterns under the focus title
  scBox: { marginTop: 4, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border, gap: 8 },
  scBoxLabel: { fontSize: 12, fontWeight: "700", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },

  // Page groups
  group: { gap: 12 },
  groupSpaced: { marginTop: 16 },
  groupLabel: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 },
  groupLabelText: { fontSize: 13, fontWeight: "800", color: C.textPrimary, textTransform: "uppercase", letterSpacing: 1 },
  groupLabelLine: { flex: 1, height: 1, backgroundColor: C.border },
  chip: { backgroundColor: C.surfaceHigh, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5 },
  chipMuted: { backgroundColor: "transparent", borderWidth: 1, borderColor: C.surfaceHigh },
  chipText: { fontSize: 12.5, fontWeight: "600", color: C.textPrimary },

  empty: { alignItems: "center", paddingHorizontal: 40, paddingTop: 80, gap: 10 },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: C.textPrimary },
  emptyText: { fontSize: 14, color: C.textSecondary, textAlign: "center", lineHeight: 20 },
})
