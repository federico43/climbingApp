import type { SessionRow } from "@/services/BoulderGraphService"
import type { Attempt } from "@/hooks/WorkoutHook"
import type {
  PeriodStats, ProjectSessionStat, ScExerciseStats, ScPatternStats, StatFocus, StatMetric, StatPoint, WarmupSessionStat,
} from "@/utils/athleteStats"
import { colourIndex } from "@/utils/boulderColours"
import { parseMaxLog } from "@/utils/edgeWarmup"
import { MOVEMENT_TYPES, type MovementType } from "@/utils/movementTypes"
import { donePlanWorkouts, sessionLocalDate, type ProgressWorkout } from "@/utils/planProgress"
import { pauseOn, type PlanPause } from "@/utils/planPauses"
import { addDays, PLAN_WEEKS, planWeek, WORKOUTS_PER_WEEK } from "@/utils/planRotation"
import { attemptGrades } from "@/utils/progression/fourByFour"
import { intervalsLog } from "@/utils/progression/intervals"
import { normalizeProjectBlock } from "@/utils/progression/projectBouldering"
import { loggedFocus, readRound, setsAtFinalLoad } from "@/utils/scHistory"

// Reads the coach Stats card's numbers out of an athlete's history
// (docs/athlete-stats.md §3–5). Pure: the dashboard loads the rows, this
// turns them into PeriodStats. Dates are the session's real day
// (sessionLocalDate); weeks are the plan's own weeks, which stand still
// during a pause.

export interface StatsPlan {
  $id: string
  windowStart: string
  windowEnd: string
  pauses?: PlanPause[]
}

export interface StatsLibraryExercise {
  $id: string
  name?: string
  movementType?: string
  loadMode?: "weight" | "level"
  unit?: "reps" | "seconds"
}

export interface StatsInput {
  athlete: { edgeLiftMaxLog?: string | null }
  sessions: SessionRow[]          // any order
  library: StatsLibraryExercise[]
  today: string                   // "YYYY-MM-DD"
}

// ─── Sessions, parsed once ────────────────────────────────────────────────────

interface ParsedSession {
  id: string
  date: string
  protocol: any[]
  attempts: Attempt[]
}

// A block of a session with its own attempts (in logged order).
interface BlockLog {
  date: string
  block: any
  attempts: Attempt[]
  protocol: any[]
}

export function parseSessions(sessions: SessionRow[]): ParsedSession[] {
  const out: ParsedSession[] = []
  for (const s of sessions) {
    let protocol: unknown
    let attempts: unknown
    try { protocol = JSON.parse(s.protocol || "[]") } catch { continue }
    try { attempts = JSON.parse(s.attempts || "[]") } catch { continue }
    if (!Array.isArray(protocol) || !Array.isArray(attempts)) continue
    out.push({ id: s.$id, date: sessionLocalDate(s), protocol, attempts: attempts as Attempt[] })
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

function blockLogs(sessions: ParsedSession[], from: string, to: string, match: (block: any) => boolean): BlockLog[] {
  const logs: BlockLog[] = []
  for (const s of sessions) {
    if (s.date < from || s.date > to) continue
    s.protocol.forEach((block, i) => {
      if (!match(block)) return
      const own = s.attempts.filter((a) => a?.blockIndex === i)
      if (own.length > 0) logs.push({ date: s.date, block, attempts: own, protocol: s.protocol })
    })
  }
  return logs
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export function shortDay(date: string): string {
  const [, m, d] = date.split("-").map(Number)
  return `${MONTHS[m - 1]} ${d}`
}

// ─── Weeks of a block ─────────────────────────────────────────────────────────

export interface BlockWeek {
  week: number
  label: string   // "W1"
  end: string     // last day of the week on the calendar (paused days included)
}

// The plan's weeks that have started by `today` (all of them once it's over).
export function blockWeeks(plan: StatsPlan, today: string): BlockWeek[] {
  const last = today < plan.windowEnd ? today : plan.windowEnd
  const weeks: BlockWeek[] = []
  for (let day = plan.windowStart; day <= plan.windowEnd; day = addDays(day, 1)) {
    const w = Math.min(Math.max(planWeek(plan.windowStart, day, plan.pauses), 1), PLAN_WEEKS)
    if (day > last && (weeks.length === 0 || weeks[weeks.length - 1].week !== w)) break
    const current = weeks[weeks.length - 1]
    if (current?.week === w) current.end = day
    else weeks.push({ week: w, label: `W${w}`, end: day })
  }
  return weeks
}

function weekOf(plan: StatsPlan, date: string): number {
  return Math.min(Math.max(planWeek(plan.windowStart, date, plan.pauses), 1), PLAN_WEEKS)
}

// ─── One series per metric ────────────────────────────────────────────────────

// Edge lift max: the max that stood at the end of each week. Weeks before
// the first recorded max have no point.
export function edgeLiftSeries(rawLog: unknown, weeks: BlockWeek[]): StatPoint[] {
  const log = parseMaxLog(rawLog).slice().sort((a, b) => (a.date < b.date ? -1 : 1))
  const points: StatPoint[] = []
  for (const w of weeks) {
    let kg: number | null = null
    for (const e of log) if (e.date <= w.end) kg = e.kg
    if (kg != null) points.push({ label: w.label, value: kg })
  }
  return points
}

// Group values by week, keeping one per week: the best (`max`) or the last.
function byWeek(plan: StatsPlan, weeks: BlockWeek[], items: { date: string; value: number }[], keep: "max" | "last"): StatPoint[] {
  const values = new Map<number, number>()
  for (const it of items) {
    const w = weekOf(plan, it.date)
    const prev = values.get(w)
    values.set(w, prev == null || keep === "last" ? it.value : Math.max(prev, it.value))
  }
  return weeks.filter((w) => values.has(w.week)).map((w) => ({ label: w.label, value: values.get(w.week)! }))
}

// 4×4: the average colour of the slots the athlete finished on (last set),
// best session of the week.
export function fourByFourValues(sessions: ParsedSession[], from: string, to: string): { date: string; value: number }[] {
  return blockLogs(sessions, from, to, (b) => b?.type === "four_by_four" && !b.coached).flatMap((log) => {
    const grades = attemptGrades(log.attempts[log.attempts.length - 1], log.block?.bouldersPerSet ?? 4)
    if (!grades) return []
    const idx = grades.map(colourIndex).filter((i) => i >= 0)
    return idx.length ? [{ date: log.date, value: idx.reduce((a, b) => a + b, 0) / idx.length }] : []
  })
}

function isOneOnOneOff(block: any): boolean {
  return block?.type === "intervals" && (block.kind === "warmup" || /1\s*on\s*1\s*off/i.test(block.blockName ?? ""))
}

// Power endurance intervals: work time per round the session ended on.
export function intervalsValues(sessions: ParsedSession[], from: string, to: string): { date: string; value: number }[] {
  return blockLogs(sessions, from, to, (b) => b?.type === "intervals" && b.kind === "power_endurance").flatMap((log) => {
    const last = [...log.attempts].reverse().map(intervalsLog).find((l) => l != null)
    return last ? [{ date: log.date, value: last.workTime }] : []
  })
}

export function warmupSessions(sessions: ParsedSession[], from: string, to: string): WarmupSessionStat[] {
  return blockLogs(sessions, from, to, isOneOnOneOff).flatMap((log) => {
    const last = [...log.attempts].reverse().map(intervalsLog).find((l) => l != null)
    return last ? [{ label: shortDay(log.date), minutes: Math.round((last.series * last.workTime) / 6) / 10 }] : []
  })
}

// Project bouldering: minutes from the first to the last attempt (one
// attempt alone → the block's time limit), the grade worked, and whether
// any attempt sent it. A coached block's Done marker isn't an attempt, and
// a session logged after the fact (one placeholder attempt, no grade) never
// counts as a send.
export function projectSessions(sessions: ParsedSession[], from: string, to: string): ProjectSessionStat[] {
  return blockLogs(sessions, from, to, (b) => b?.type === "project_bouldering").map((log) => {
    const settings = normalizeProjectBlock(log.block)
    const real = log.attempts.filter((a) => !(a.coached && !a.routeId))
    const times = real.map((a) => a.timestamp).filter((t) => typeof t === "number")
    const span = times.length > 1 ? Math.round((Math.max(...times) - Math.min(...times)) / 60000) : 0
    const graded = [...real].reverse().find((a) => colourIndex(a.level) >= 0)
    return {
      label: shortDay(log.date),
      minutes: span > 0 ? span : settings.timeLimit,
      grade: graded?.level ?? settings.grade,
      sent: real.some((a) => a.success && (a.level || a.pbv != null || a.routeId)),
    }
  })
}

// S&C by movement pattern → exercise → focus: one point per session (the
// best of a day), what the session ended on: the weight (kg), the step for a
// level exercise, else — bodyweight, no weight logged — the reps or seconds.
// A workout with no focus on the exercise (built by hand) goes under "none".
export function scPatternStats(
  sessions: ParsedSession[],
  library: StatsLibraryExercise[],
  from: string,
  to: string,
): ScPatternStats[] {
  const lib = new Map(library.map((e) => [e.$id, e]))
  // Exercises saved before blocks kept the library id are found by name.
  const libByName = new Map(library.filter((e) => e.name).map((e) => [e.name!.trim().toLowerCase(), e]))
  const exercises = new Map<string, { pattern: MovementType; stats: ScExerciseStats }>()
  const dayPoints = new Map<string, StatPoint>()

  for (const log of blockLogs(sessions, from, to, (b) => b?.type === "strength_conditioning" && Array.isArray(b.exercises))) {
    const byExercise = new Map<any, Attempt[]>()
    for (const a of log.attempts) {
      if (a?.type !== "strength_conditioning" || !a.scData) continue
      const id = a.scData.exerciseId
      const ex = log.block.exercises.find((e: any) =>
        (id && (e?.exerciseId === id || (e?.levels ?? []).some((l: any) => l?.exerciseId === id)))
        || e?.name === a.scData!.exerciseName)
      if (!ex) continue
      const list = byExercise.get(ex)
      if (list) list.push(a)
      else byExercise.set(ex, [a])
    }

    for (const [ex, attempts] of byExercise) {
      const libEx = (ex.exerciseId ? lib.get(ex.exerciseId) : undefined) ?? libByName.get(String(ex.name ?? "").trim().toLowerCase())
      const movement = (ex.movementType ?? libEx?.movementType) as MovementType | undefined
      if (!movement || !MOVEMENT_TYPES.includes(movement) || movement === "mobility") continue
      const focus: StatFocus = loggedFocus(attempts[0], log.protocol) ?? ex.focus ?? "none"

      const rounds = [...attempts].sort((a, b) => (a.scData?.round ?? 0) - (b.scData?.round ?? 0)).map((a) => readRound(a.scData, "kg"))
      const final = setsAtFinalLoad(rounds)
      const levels: any[] = Array.isArray(ex.levels) ? ex.levels : []
      const isLevel = (libEx?.loadMode ?? ex.loadMode) === "level" && levels.length > 0
      let value: number | undefined
      let unit: ScExerciseStats["unit"] = "kg"
      if (isLevel) {
        const step = levels.findIndex((l) => l?.exerciseId === final?.exerciseId)
        value = step >= 0 ? step + 1 : undefined
        unit = "level"
      } else if (final?.weight != null && final.weight > 0) {
        value = final.weight
      } else {
        // Bodyweight: the most reps (or seconds) in a set at the final load.
        const amounts = (final?.sets ?? []).map((st) => st.amount).filter((n) => typeof n === "number" && n > 0)
        value = amounts.length ? Math.max(...amounts) : undefined
        unit = (ex.unit ?? libEx?.unit) === "seconds" ? "s" : "reps"
      }
      if (value == null) continue

      // A weighted and a bodyweight version of one exercise are tracked apart.
      const base = ex.exerciseId ?? ex.name
      const key = unit === "kg" || unit === "level" ? base : `${base}:${unit}`
      let entry = exercises.get(key)
      if (!entry) {
        const name = ex.name ?? "Exercise"
        entry = { pattern: movement, stats: { id: key, name: unit === "reps" || unit === "s" ? `${name} (bodyweight)` : name, unit, byFocus: {} } }
        exercises.set(key, entry)
      }
      // One point per day: the same "Oct 6" a year apart stays two points.
      const points = entry.stats.byFocus[focus] ?? (entry.stats.byFocus[focus] = [])
      const dayKey = `${key}|${focus}|${log.date}`
      const same = dayPoints.get(dayKey)
      if (same) same.value = Math.max(same.value, value)
      else {
        const point = { label: shortDay(log.date), value }
        points.push(point)
        dayPoints.set(dayKey, point)
      }
    }
  }

  const patterns = new Map<MovementType, ScExerciseStats[]>()
  for (const { pattern, stats } of exercises.values()) {
    const list = patterns.get(pattern)
    if (list) list.push(stats)
    else patterns.set(pattern, [stats])
  }
  // Library order of patterns; within one, the most-logged exercise first.
  return MOVEMENT_TYPES.filter((m) => patterns.has(m)).map((pattern) => ({
    pattern,
    exercises: patterns.get(pattern)!.sort((a, b) => pointCount(b) - pointCount(a)),
  }))
}

function pointCount(e: ScExerciseStats): number {
  return Object.values(e.byFocus).reduce((n, pts) => n + (pts?.length ?? 0), 0)
}

// Plan workouts done each week, against 2 a week planned so far.
export function workoutsMetric(
  plan: StatsPlan,
  weeks: BlockWeek[],
  planWorkouts: ProgressWorkout[],
  sessions: SessionRow[],
): StatMetric {
  const done = donePlanWorkouts(plan.$id, planWorkouts, sessions)
  const perWeek = new Map<number, number>()
  for (const date of done.values()) {
    if (pauseOn(plan.pauses, date)) continue
    const w = weekOf(plan, date)
    perWeek.set(w, (perWeek.get(w) ?? 0) + 1)
  }
  return {
    id: "workouts",
    label: "Workouts",
    unit: "workouts",
    points: weeks.map((w) => ({ label: w.label, value: perWeek.get(w.week) ?? 0 })),
    planned: Math.min(weeks.length, PLAN_WEEKS) * WORKOUTS_PER_WEEK,
  }
}

// ─── Periods ──────────────────────────────────────────────────────────────────

// One block (the active plan, or any past one for its review).
export function buildBlockStats(input: StatsInput & { plan: StatsPlan; planWorkouts: ProgressWorkout[] }, parsed = parseSessions(input.sessions)): PeriodStats {
  const { plan, today } = input
  const weeks = blockWeeks(plan, today)
  const from = plan.windowStart
  const to = today < plan.windowEnd ? today : plan.windowEnd
  return {
    metrics: [
      { id: "edge_lift_max", label: "Edge lift max", unit: "kg", points: edgeLiftSeries(input.athlete.edgeLiftMaxLog, weeks) },
      { id: "four_by_four", label: "4×4", unit: "colour", points: byWeek(plan, weeks, fourByFourValues(parsed, from, to), "max") },
      { id: "intervals", label: "Intervals", unit: "s", points: byWeek(plan, weeks, intervalsValues(parsed, from, to), "last") },
      workoutsMetric(plan, weeks, input.planWorkouts, input.sessions),
    ],
    sc: scPatternStats(parsed, input.library, from, to),
    projects: projectSessions(parsed, from, to),
    warmups: warmupSessions(parsed, from, to),
  }
}

// Every plan, oldest first, one point each (B1, B2…): the value the block
// ended on. Projects and 1 on 1 off list every session since the first plan.
export function buildAllBlocksStats(input: StatsInput & { plans: StatsPlan[]; workoutsByPlan: Record<string, ProgressWorkout[]> }): PeriodStats {
  const plans = [...input.plans].sort((a, b) => (a.windowStart < b.windowStart ? -1 : 1)).filter((p) => p.windowStart <= input.today)
  const parsed = parseSessions(input.sessions)
  const lastOf = (pts: StatPoint[]) => pts[pts.length - 1]
  const edge: StatPoint[] = []
  const four: StatPoint[] = []
  const intervals: StatPoint[] = []
  const workouts: StatPoint[] = []
  let planned = 0
  plans.forEach((plan, i) => {
    const block = buildBlockStats({ ...input, plan, planWorkouts: input.workoutsByPlan[plan.$id] ?? [] }, parsed)
    const label = `B${i + 1}`
    const [e, f, iv, w] = block.metrics
    if (lastOf(e.points)) edge.push({ label, value: lastOf(e.points).value })
    if (f.points.length) four.push({ label, value: Math.max(...f.points.map((p) => p.value)) })
    if (lastOf(iv.points)) intervals.push({ label, value: lastOf(iv.points).value })
    workouts.push({ label, value: w.points.reduce((n, p) => n + p.value, 0) })
    planned += w.planned ?? 0
  })

  const from = plans[0]?.windowStart ?? input.today
  return {
    metrics: [
      { id: "edge_lift_max", label: "Edge lift max", unit: "kg", points: edge },
      { id: "four_by_four", label: "4×4", unit: "colour", points: four },
      { id: "intervals", label: "Intervals", unit: "s", points: intervals },
      { id: "workouts", label: "Workouts", unit: "workouts", points: workouts, planned },
    ],
    // S&C: every session ever, plan or not — hand-built workouts count too.
    sc: scPatternStats(parsed, input.library, "0000-01-01", input.today),
    projects: projectSessions(parsed, from, input.today),
    warmups: warmupSessions(parsed, from, input.today),
  }
}
