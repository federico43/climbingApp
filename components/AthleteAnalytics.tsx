import { C } from "@/utils/theme"
import { SessionDetailModal } from "@/components/SessionDetailModal"
import { SessionBarsChart } from "@/components/SessionBarsChart"
import { AthleteWorkoutBuilder } from "@/components/AthleteWorkoutBuilder"
import { HomeworkCoachSheet } from "@/components/HomeworkCoachSheet"
import { TrainingPlanModal } from "@/components/TrainingPlanModal"
import { BoulderLevelOptions } from "@/components/ProjectPickerModal"
import { Block, injectLocalIds } from "@/components/workoutBlocks"
import { ADAPTATION_COLOR, ADAPTATION_LABEL } from "@/utils/adaptations"
import { sessionBars, trainingStats, weeklyFrequency } from "@/utils/athleteAnalytics"
import { MOVEMENT_TYPE_LABEL } from "@/utils/movementTypes"
import {
  addDays, alternateMainBlock, localDateStr, MAIN_BLOCK_COPIES, nextPlanIndex, planIsOver, planWeek, workoutSpec,
  PLAN_FOCUS_LABEL, PLAN_WORKOUTS, type BuiltPlanWorkout, type LibraryBlockRef, type MainType, type PlanShape, type WorkoutSpec,
} from "@/utils/planRotation"
import { buildPlanWorkout, withUpcomingWorkouts } from "@/utils/planWorkout"
import { HOMEWORK_STATE_LABEL, dueByOf, homeworkStatus, shortDay, type HomeworkState } from "@/utils/homework"
import { FOCUS_LABEL } from "@/utils/scProgression"
import { getExerciseLibrary } from "@/utils/exerciseLibraryCache"
import { coachExerciseView } from "@/utils/scCoach"
import {
  AppUser,
  type ExerciseRow,
  CheckinRow,
  getActiveTrainingPlan,
  getCheckinForToday,
  getSessionsByUserId,
  getUsers,
  listAthleteHomework,
  listBlocks,
  listExercises,
  listPlanWorkouts,
  ProtocolRow,
  SessionRow,
  setFlashLevel,
  TrainingPlanRow,
} from "@/services/BoulderGraphService"
import { useRouter } from "expo-router"
import { useEffect, useState } from "react"
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native"
import { Calendar } from "react-native-calendars"

// ─── Date helpers ─────────────────────────────────────────────────────────────

function getMondayOfWeek(date: Date, weekOffset = 0): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? 6 : day - 1
  d.setDate(d.getDate() - diff + weekOffset * 7)
  d.setHours(0, 0, 0, 0)
  return d
}
function toDateStr(d: Date) { return d.toISOString().slice(0, 10) }
const MAIN_TYPE_LABEL: Record<MainType, string> = {
  strength: "Strength", power_endurance: "Power endurance", power: "Power",
}
function formatPlanDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}
function sessionDateStr(session: SessionRow): string {
  try {
    const attempts = JSON.parse(session.attempts)
    if (attempts.length > 0 && attempts[0].timestamp) {
      return new Date(attempts[0].timestamp).toISOString().slice(0, 10)
    }
  } catch {}
  return session.$createdAt.slice(0, 10)
}
function countUniqueDaysInRange(sessions: SessionRow[], start: Date, end: Date): number {
  const s = toDateStr(start), e = toDateStr(end)
  return new Set(
    sessions.filter((x) => { const d = sessionDateStr(x); return d >= s && d <= e }).map(sessionDateStr)
  ).size
}
function countSessionsInMonth(sessions: SessionRow[], year: number, month: number): number {
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`
  return sessions.filter((s) => sessionDateStr(s).startsWith(prefix)).length
}
function extractSCExercises(sessions: SessionRow[]): string[] {
  const names = new Set<string>()
  for (const session of sessions) {
    let attempts: any[] = []
    try { attempts = JSON.parse(session.attempts) } catch {}
    for (const a of attempts) {
      if (a.type !== "strength_conditioning") continue
      if (a.scData?.exerciseName) names.add(a.scData.exerciseName)
      else { const n = (a.notes ?? "").split(" · ")[0]; if (n) names.add(n) }
    }
  }
  return Array.from(names).sort()
}

const HOMEWORK_STATE_COLOR: Record<HomeworkState, string> = {
  not_scheduled: C.textMuted,
  scheduled: C.textPrimary,
  missed: C.yellow,
  cant_attend: C.red,
  overdue: C.red,
  done: C.green,
}

// ─── Component ────────────────────────────────────────────────────────────────

// Per-athlete training history: calendar + frequency + training-focus bars +
// S/C exercise progress links. Renders bare sections — host provides the scroll.
export function AthleteAnalytics({ athlete }: { athlete: AppUser }) {
  const router = useRouter()
  const [sessions, setSessions] = useState<SessionRow[]>([])
  // Exercise library, for S&C ladders / weight jumps in the badges below.
  const [scLibrary, setScLibrary] = useState<ExerciseRow[] | null>(null)
  useEffect(() => { getExerciseLibrary().then(setScLibrary).catch(() => setScLibrary(null)) }, [])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [todayCheckin, setTodayCheckin] = useState<CheckinRow | null>(null)
  const [building, setBuilding] = useState(false)
  const [draftWorkout, setDraftWorkout] = useState<{
    name: string; blocks: Block[]; homeworkIds: string[]; plan: { planId: string; planIndex: number }
  } | null>(null)
  const [homework, setHomework] = useState<ProtocolRow[]>([])
  const [managing, setManaging] = useState<ProtocolRow | null>(null)
  const reloadHomework = () => listAthleteHomework(athlete.$id).then(setHomework).catch(console.error)
  // Homework is read through its planPart column — fine to fail quietly
  // until it holds "homework" rows.
  useEffect(() => {
    let cancelled = false
    setHomework([])
    listAthleteHomework(athlete.$id).then((rows) => { if (!cancelled) setHomework(rows) }).catch(console.error)
    return () => { cancelled = true }
  }, [athlete.$id])
  const [activePlan, setActivePlan] = useState<TrainingPlanRow | null>(null)
  // Workouts already built from the active plan (incl. split-off S&C ones).
  const [planWorkouts, setPlanWorkouts] = useState<ProtocolRow[]>([])
  const [loadingPlan, setLoadingPlan] = useState(true)
  // The coach's ⇄ Swap of the next workout's main block, for that workout only.
  const [swappedMain, setSwappedMain] = useState<{ index: number; block: LibraryBlockRef } | null>(null)
  const [planModal, setPlanModal] = useState<"edit" | "new" | null>(null)
  const [flashLevel, setFlashLevelState] = useState<string | null>(athlete.flashLevel ?? null)

  // Re-read the row rather than trusting the `athlete` prop: the coach's
  // athlete list is fetched once, so it'd show a stale flash level after a
  // change made on a previous visit to this athlete.
  useEffect(() => {
    let cancelled = false
    setFlashLevelState(athlete.flashLevel ?? null)
    getUsers(athlete.$id).then((row: any) => { if (!cancelled && row) setFlashLevelState(row.flashLevel ?? null) })
    return () => { cancelled = true }
  }, [athlete.$id])

  async function pickFlashLevel(value: string) {
    const prev = flashLevel
    const next = value === prev ? null : value  // tap the selected colour again to clear
    setFlashLevelState(next)
    try {
      await setFlashLevel(athlete.$id, next)
    } catch (e) {
      console.log(e)
      setFlashLevelState(prev)
      Alert.alert("Couldn't save flash level", "Does the `users` table have a `flashLevel` column in Appwrite yet?")
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setSelectedDate(null)
    getSessionsByUserId(athlete.$id)
      .then((s) => { if (!cancelled) setSessions(s) })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [athlete.$id])

  useEffect(() => {
    let cancelled = false
    setTodayCheckin(null)
    getCheckinForToday(athlete.$id).then((row) => { if (!cancelled) setTodayCheckin(row) })
    return () => { cancelled = true }
  }, [athlete.$id])

  const activePlanId = activePlan?.$id
  useEffect(() => {
    let cancelled = false
    setPlanWorkouts([])
    if (!activePlanId) return
    listPlanWorkouts(activePlanId)
      .then((rows) => { if (!cancelled) setPlanWorkouts(rows) })
      .catch(console.error)
    return () => { cancelled = true }
  }, [activePlanId])

  useEffect(() => {
    let cancelled = false
    setLoadingPlan(true)
    setActivePlan(null)
    getActiveTrainingPlan(athlete.$id)
      .then((plan) => { if (!cancelled) setActivePlan(plan) })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoadingPlan(false) })
    return () => { cancelled = true }
  }, [athlete.$id])

  // Where the plan is: built climbing workouts (split-off S&C doesn't move
  // the rotation), the next one's spec, and whether the plan is over.
  const today = localDateStr(new Date())
  const builtWorkouts: BuiltPlanWorkout[] = planWorkouts
    .filter((w) => !w.planPart && w.planIndex) // not split-off S&C / homework
    .map((w) => ({ planIndex: w.planIndex!, createdAt: w.$createdAt, blocks: w.blocks }))
  const nextIndex = nextPlanIndex(builtWorkouts)
  const planEnded = !!activePlan && planIsOver(activePlan, builtWorkouts, today)
  // Plans made before v2 have no focus and can't be rotated.
  const planShape: PlanShape | null = activePlan?.focus ? { ...activePlan, focus: activePlan.focus } : null
  const rotationSpec: WorkoutSpec | null = planShape && !planEnded
    ? workoutSpec(planShape, nextIndex, builtWorkouts, today)
    : null
  const nextSpec: WorkoutSpec | null = rotationSpec && swappedMain?.index === rotationSpec.index
    ? { ...rotationSpec, mainBlock: swappedMain.block }
    : rotationSpec
  const swapTo = nextSpec ? alternateMainBlock(nextSpec.mainType, nextSpec.mainBlock) : null

  // Re-reads sessions, the plan's workouts and both libraries first, so
  // anything done, built or edited since this page opened counts (e.g. an
  // exercise re-tagged with a different movement pattern).
  async function handleBuild() {
    if (!activePlan || !planShape || !nextSpec) return
    setBuilding(true)
    try {
      const [fresh, built, exerciseRows, blockRows] = await Promise.all([
        getSessionsByUserId(athlete.$id), listPlanWorkouts(activePlan.$id), listExercises(), listBlocks(),
      ])
      setSessions(fresh)
      setPlanWorkouts(built)
      const { blocks, homework: homeworkBlocks, warnings } = buildPlanWorkout(
        planShape, nextSpec, blockRows, exerciseRows, withUpcomingWorkouts(fresh, built), flashLevel,
      )
      // The Density test rides along pre-marked as homework (split off on save).
      const withIds = injectLocalIds([...homeworkBlocks, ...blocks])
      const open = () => setDraftWorkout({
        name: `Workout ${nextSpec.index} · ${MAIN_TYPE_LABEL[nextSpec.mainType]}`,
        blocks: withIds,
        homeworkIds: withIds.slice(0, homeworkBlocks.length).map((b) => b.id),
        plan: { planId: activePlan.$id, planIndex: nextSpec.index },
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

  if (loading) return <ActivityIndicator style={{ marginTop: 40 }} color={C.green} />

  const trainedDays: Record<string, any> = {}
  for (const s of sessions) {
    trainedDays[sessionDateStr(s)] = { selected: true, selectedColor: C.green, selectedTextColor: C.bg }
  }

  const now = new Date()
  const sessionsThisMonth = countSessionsInMonth(sessions, now.getFullYear(), now.getMonth())
  const weekStart = getMondayOfWeek(now, 0)
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6)
  const lastWeekStart = getMondayOfWeek(now, -1)
  const lastWeekEnd = new Date(lastWeekStart); lastWeekEnd.setDate(lastWeekEnd.getDate() + 6)
  const daysThisWeek = countUniqueDaysInRange(sessions, weekStart, weekEnd)
  const daysLastWeek = countUniqueDaysInRange(sessions, lastWeekStart, lastWeekEnd)
  const scExercises = extractSCExercises(sessions)
  // Warnings per S&C exercise (deload / stalled / swapped), shown as badges
  // in the list — the detail is on each exercise's progress screen.
  const scBadges = (() => {
    const out: Record<string, { label: string; color: string }[]> = {}
    for (const name of scExercises) {
      const view = coachExerciseView(sessions, name, scLibrary)
      const badges: { label: string; color: string }[] = []
      if (view.flags.deload) badges.push({ label: "Down 2×", color: C.red })
      if (view.flags.stalled) badges.push({ label: "Stuck", color: C.yellow })
      if (view.swaps.some((sw) => sw.reason === "easier")) badges.push({ label: "Swapped", color: C.yellow })
      if (view.swaps.some((sw) => sw.reason === "choice")) badges.push({ label: "Replaced", color: C.textSecondary })
      if (badges.length) out[name] = badges
    }
    return out
  })()

  // Done homework drops off after 3 weeks; open ones always show.
  const homeworkCutoff = addDays(today, -21)
  const visibleHomework = homework
    .map((hw) => ({ hw, status: homeworkStatus(hw, sessions, today) }))
    .filter(({ hw, status }) => status.state !== "done" || dueByOf(hw) >= homeworkCutoff)

  const freqData = weeklyFrequency(sessions)
  const { bars: focusBars, present: focusAdaptations } = sessionBars(sessions)
  const stats = trainingStats(sessions)
  const maxCount = Math.max(1, ...freqData.map((b) => b.value))

  return (
    <>
      {/* Today's readiness check-in */}
      {todayCheckin && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Today's readiness</Text>
          <View style={styles.checkinRow}>
            <Text style={styles.checkinStat}>Rest {todayCheckin.restRating}/5</Text>
            <Text style={styles.checkinStat}>Ate: {todayCheckin.ate ? "Yes" : "Not yet"}</Text>
          </View>
        </View>
      )}

      {/* Flash level — the athlete's flash colour; constraint warmups pick
          their colour range relative to it. */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Flash level</Text>
        <Text style={styles.sectionSub}>Hardest colour they reliably flash. Tap again to clear.</Text>
        <View style={styles.chipWrap}>
          {BoulderLevelOptions.map((g) => {
            const sel = flashLevel === g.value
            return (
              <Pressable
                key={g.value}
                onPress={() => pickFlashLevel(g.value)}
                style={[styles.gradeChip, sel && { backgroundColor: g.color, borderColor: g.color }]}
              >
                <View style={[styles.gradeDot, { backgroundColor: g.color }, sel && { backgroundColor: g.on }]} />
                <Text style={[styles.gradeText, sel && { color: g.on, fontWeight: "700" }]}>{g.label}</Text>
              </Pressable>
            )
          })}
        </View>
      </View>

      {/* Training plan — the plan's settings and its next workout. */}
      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Training plan</Text>
          {activePlan && !planEnded && (
            <Pressable onPress={() => setPlanModal("edit")} hitSlop={8}>
              <Text style={styles.addTargetText}>Edit</Text>
            </Pressable>
          )}
        </View>

        {loadingPlan ? (
          <ActivityIndicator color={C.green} />
        ) : !activePlan ? (
          <>
            <Text style={styles.sectionSub}>No training plan yet — 6 weeks, 2 workouts a week.</Text>
            <Pressable style={styles.suggestBtn} onPress={() => setPlanModal("new")}>
              <Text style={styles.suggestBtnText}>Start a plan</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.slotTitle}>{activePlan.name}</Text>
            <Text style={styles.planWindowText}>
              {formatPlanDate(activePlan.windowStart)} – {formatPlanDate(activePlan.windowEnd)}
              {activePlan.focus ? ` · ${PLAN_FOCUS_LABEL[activePlan.focus]} focus` : ""}
            </Text>
            {activePlan.hasSc && (
              <View style={styles.chipWrap}>
                {activePlan.scPatterns.map((p) => (
                  <View key={p.movementType} style={styles.focusChip}>
                    <Text style={styles.focusChipText}>{MOVEMENT_TYPE_LABEL[p.movementType]}</Text>
                  </View>
                ))}
                {activePlan.hasMobility && (
                  <View style={styles.focusChip}>
                    <Text style={styles.focusChipText}>+ mobility</Text>
                  </View>
                )}
              </View>
            )}
            <Text style={styles.sectionSub}>
              {Math.min(nextIndex - 1, PLAN_WORKOUTS)} of {PLAN_WORKOUTS} workouts built
            </Text>

            {planEnded ? (
              <View style={styles.planEndedBox}>
                <Text style={styles.planEndedText}>This plan has ended.</Text>
                <Pressable style={styles.suggestBtn} onPress={() => setPlanModal("new")}>
                  <Text style={styles.suggestBtnText}>Start a new plan</Text>
                </Pressable>
              </View>
            ) : !activePlan.focus ? (
              // Plans made before v2 have no focus — the rotation needs one.
              <View style={styles.planEndedBox}>
                <Text style={styles.planEndedText}>This plan was made before the new plan structure. Edit it to set a focus.</Text>
              </View>
            ) : nextSpec && (
              <>
                <View style={styles.suggestDivider} />
                <View style={styles.slotCard}>
                  <View style={styles.sectionHeaderRow}>
                    <Text style={styles.slotTitle}>
                      Next: workout {nextSpec.index} · week {Math.max(1, planWeek(activePlan.windowStart, today))}
                    </Text>
                    <Pressable style={styles.buildBtn} onPress={handleBuild} disabled={building}>
                      <Text style={styles.buildBtnText}>{building ? "…" : "Build"}</Text>
                    </Pressable>
                  </View>
                  {nextSpec.scFocus && (
                    <View style={styles.pickRow}>
                      <View style={[styles.legendDot, { backgroundColor: ADAPTATION_COLOR.conditioning }]} />
                      <Text style={styles.pickText}>S&C · {FOCUS_LABEL[nextSpec.scFocus]}</Text>
                    </View>
                  )}
                  <View style={styles.pickRow}>
                    <View style={[styles.legendDot, { backgroundColor: C.textMuted }]} />
                    <Text style={styles.pickText}>
                      {nextSpec.warmup === "constraints" ? `Warm-up · 3 ${PLAN_FOCUS_LABEL[activePlan.focus].toLowerCase()} constraints`
                        : "Warm-up · 1 on 1 off"}
                    </Text>
                  </View>
                  <View style={styles.pickRow}>
                    <View style={[styles.legendDot, { backgroundColor: ADAPTATION_COLOR[nextSpec.mainType] }]} />
                    <Text style={[styles.pickText, { flex: 1 }]}>{MAIN_TYPE_LABEL[nextSpec.mainType]} · {nextSpec.mainBlock.name} × {MAIN_BLOCK_COPIES}</Text>
                    {swapTo && (
                      <Pressable onPress={() => setSwappedMain({ index: nextSpec.index, block: swapTo })} hitSlop={8}>
                        <Text style={styles.addTargetText}>⇄ Swap</Text>
                      </Pressable>
                    )}
                  </View>
                  {nextSpec.withTest && (
                    <View style={styles.pickRow}>
                      <View style={[styles.legendDot, { backgroundColor: ADAPTATION_COLOR.test }]} />
                      <Text style={styles.pickText}>+ Density test as homework</Text>
                    </View>
                  )}
                </View>
              </>
            )}
          </>
        )}
      </View>

      {/* Homework — open ones, and the last few weeks' done ones. */}
      {visibleHomework.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Homework</Text>
          {visibleHomework.map(({ hw, status }) => (
            <Pressable
              key={hw.$id}
              style={styles.homeworkRow}
              // Done homework has nothing left to manage.
              disabled={status.state === "done"}
              onPress={() => setManaging(hw)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.pickText} numberOfLines={1}>{hw.name}</Text>
                <Text style={styles.homeworkDue}>
                  Due {shortDay(dueByOf(hw))}
                  {hw.planIndex ? ` · workout ${hw.planIndex}` : ""}
                </Text>
                {status.state === "cant_attend" && !!hw.homeworkNote && (
                  <Text style={styles.homeworkNote}>“{hw.homeworkNote}”</Text>
                )}
              </View>
              <Text style={[styles.homeworkState, { color: HOMEWORK_STATE_COLOR[status.state] }]}>
                {HOMEWORK_STATE_LABEL[status.state]}{status.date ? ` ${shortDay(status.date)}` : ""}
              </Text>
              {status.state !== "done" && <Text style={styles.homeworkChevron}>›</Text>}
            </Pressable>
          ))}
        </View>
      )}

      {/* Calendar + consistency */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Training consistency</Text>
        <Calendar
          markedDates={trainedDays}
          maxDate={today}
          onDayPress={(day) => { if (trainedDays[day.dateString]) setSelectedDate(day.dateString) }}
          theme={{
            backgroundColor: C.surface, calendarBackground: C.surface,
            selectedDayBackgroundColor: C.green, selectedDayTextColor: C.bg,
            todayTextColor: C.green, dayTextColor: C.textPrimary,
            textDisabledColor: C.textMuted, arrowColor: C.green, monthTextColor: C.textPrimary,
            textDayFontWeight: "500", textMonthFontWeight: "700", textDayHeaderFontWeight: "600",
          }}
          style={styles.calendar}
        />
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statNum}>{sessionsThisMonth}</Text>
            <Text style={styles.statLabel}>sessions{"\n"}this month</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCard}>
            <Text style={styles.statNum}>{daysThisWeek}</Text>
            <Text style={styles.statLabel}>days trained{"\n"}this week</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCard}>
            <Text style={styles.statNum}>{daysLastWeek}</Text>
            <Text style={styles.statLabel}>days trained{"\n"}last week</Text>
          </View>
        </View>
      </View>

      {/* Frequency */}
      {freqData.length > 1 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Frequency</Text>
          <Text style={styles.sectionSub}>{stats.total} sessions · {stats.avgPerWeek}/week avg</Text>
          <View style={styles.freqList}>
            {freqData.map((b) => (
              <View key={b.label} style={styles.freqRow}>
                <Text style={styles.freqLabel}>{b.label}</Text>
                <View style={styles.freqTrack}>
                  <View style={[styles.freqBar, { width: `${(b.value / maxCount) * 100}%` }]} />
                </View>
                <Text style={styles.freqCount}>{b.value}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Training focus */}
      {focusBars.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Training focus</Text>
          <Text style={styles.sectionSub}>Each bar is a session · width = volume</Text>
          <SessionBarsChart bars={focusBars} onPressBar={(bar) => setSelectedDate(bar.dateStr)} />
          <View style={styles.legendRow}>
            {focusAdaptations.map((a) => (
              <View key={a} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: ADAPTATION_COLOR[a] }]} />
                <Text style={styles.legendText}>{ADAPTATION_LABEL[a]}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* S/C exercises */}
      {scExercises.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Strength & conditioning</Text>
          <Text style={styles.sectionSub}>Tap an exercise to see progress</Text>
          <View>
            {scExercises.map((name, i) => (
              <Pressable
                key={name}
                style={({ pressed }) => [
                  styles.exerciseRow,
                  i === scExercises.length - 1 && { borderBottomWidth: 0 },
                  pressed && { opacity: 0.5 },
                ]}
                onPress={() => router.push({
                  pathname: "/(tabs)/(buttonTabs)/exerciseProgress",
                  params: { name, athleteId: athlete.$id },
                })}
              >
                <Text style={styles.exerciseName}>{name}</Text>
                {(scBadges[name] ?? []).map((b) => (
                  <View key={b.label} style={[styles.scBadge, { borderColor: b.color }]}>
                    <Text style={[styles.scBadgeText, { color: b.color }]}>{b.label}</Text>
                  </View>
                ))}
                <Text style={styles.exerciseChevron}>›</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <SessionDetailModal
        date={selectedDate}
        sessions={sessions}
        onClose={() => setSelectedDate(null)}
        onDeleted={(id) => setSessions((prev) => prev.filter((s) => s.$id !== id))}
        onUpdated={(updated) => setSessions((prev) => prev.map((s) => (s.$id === updated.$id ? updated : s)))}
      />

      {managing && (
        <HomeworkCoachSheet hw={managing} onClose={() => setManaging(null)} onChanged={reloadHomework} />
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
              if (activePlan) listPlanWorkouts(activePlan.$id).then(setPlanWorkouts).catch(console.error)
              reloadHomework()
            }}
            onClose={() => setDraftWorkout(null)}
          />
        </Modal>
      )}

      <TrainingPlanModal
        visible={planModal !== null}
        athleteId={athlete.$id}
        mode={planModal ?? "new"}
        current={activePlan}
        onClose={() => setPlanModal(null)}
        onSaved={setActivePlan}
        onDeleted={() => setActivePlan(null)}
      />
    </>
  )
}

const styles = StyleSheet.create({
  scBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginRight: 6 },
  scBadgeText: { fontSize: 11, fontWeight: "700" },
  section: { backgroundColor: C.surface, borderRadius: 18, padding: 16, gap: 12 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: C.textPrimary },
  sectionSub: { fontSize: 12, color: C.textSecondary, marginTop: -8 },
  sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  addTargetText: { fontSize: 13, fontWeight: "600", color: C.green },
  planWindowText: { fontSize: 13.5, color: C.textPrimary, fontVariant: ["tabular-nums"] },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  focusChip: { backgroundColor: C.surfaceHigh, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  focusChipText: { fontSize: 11.5, fontWeight: "600", color: C.textSecondary },
  gradeChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 1, borderColor: C.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
  },
  gradeDot: { width: 9, height: 9, borderRadius: 5 },
  gradeText: { fontSize: 12.5, color: C.textSecondary },
  planEndedBox: { backgroundColor: C.surfaceHigh, borderRadius: 12, padding: 12, gap: 8, marginTop: 4 },
  planEndedText: { fontSize: 13, fontWeight: "600", color: C.textPrimary },
  suggestDivider: { height: 1, backgroundColor: C.border, marginTop: 4 },
  suggestBtn: { backgroundColor: C.green, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  suggestBtnText: { fontSize: 12.5, fontWeight: "700", color: C.bg },
  slotCard: { backgroundColor: C.surfaceHigh, borderRadius: 12, padding: 12, gap: 8 },
  slotTitle: { fontSize: 13, fontWeight: "700", color: C.textPrimary },
  buildBtn: { borderWidth: 1, borderColor: C.green, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  buildBtnText: { fontSize: 12, fontWeight: "700", color: C.green },
  pickRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  pickText: { fontSize: 13, fontWeight: "600", color: C.textPrimary },
  homeworkRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.border,
  },
  homeworkDue: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  homeworkNote: { fontSize: 12, color: C.textSecondary, fontStyle: "italic", marginTop: 4 },
  homeworkState: { fontSize: 12, fontWeight: "700" },
  homeworkChevron: { fontSize: 18, color: C.textMuted, fontWeight: "700" },
  checkinRow: { flexDirection: "row", gap: 20 },
  checkinStat: { fontSize: 14, fontWeight: "600", color: C.textSecondary },
  freqList: { gap: 6, marginTop: 8 },
  freqRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  freqLabel: { width: 38, fontSize: 11, color: C.textMuted, textAlign: "right" },
  freqTrack: { flex: 1, height: 14, borderRadius: 5, backgroundColor: C.surfaceHigh, overflow: "hidden" },
  freqBar: { height: 14, borderRadius: 5, backgroundColor: C.green, minWidth: 2 },
  freqCount: { width: 20, fontSize: 11, color: C.textSecondary, textAlign: "right" },
  legendRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, color: C.textSecondary },
  calendar: { borderRadius: 12, overflow: "hidden" },
  statsRow: { flexDirection: "row", alignItems: "center", backgroundColor: C.surfaceHigh, borderRadius: 14, paddingVertical: 14 },
  statCard: { flex: 1, alignItems: "center", gap: 4 },
  statDivider: { width: 1, height: 32, backgroundColor: C.border },
  statNum: { fontSize: 26, fontWeight: "800", color: C.green },
  statLabel: { fontSize: 11, color: C.textSecondary, textAlign: "center", lineHeight: 15 },
  exerciseRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 13, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  exerciseName: { fontSize: 15, fontWeight: "500", color: C.textPrimary },
  exerciseChevron: { fontSize: 20, color: C.textMuted },
})
