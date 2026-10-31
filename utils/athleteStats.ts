import { BoulderLevelOptions, colourLabel } from "@/utils/boulderColours"
import type { MovementType } from "@/utils/movementTypes"
import { FOCUS_COLOR, FOCUS_LABEL, type Focus } from "@/utils/scProgression"

// Coach dashboard Stats card (docs/athlete-stats.md): one tile per metric,
// first point vs last point of the period. Pure — no React Native imports —
// so the change rules can be tested in Node.
//
// The numbers are read out of sessions / users / training_plans by
// utils/athleteStatsData.ts; SAMPLE_STATS is the card's preview data.

export type StatsPeriod = "block" | "all"
export type StatUnit = "kg" | "added_kg" | "s" | "reps" | "colour" | "level" | "workouts"
export type StatTrend = "up" | "down" | "same"

export interface StatPoint {
  label: string   // x-axis: "W1"…"W6" in a block, "B1"… across blocks
  value: number   // colour: index on BoulderLevelOptions (averages allowed); level: 1-based step
}

export interface StatMetric {
  id: string
  label: string
  unit: StatUnit
  points: StatPoint[]   // oldest first
  // workouts only: how many were planned in the period so far.
  planned?: number
}

export interface StatChange {
  trend: StatTrend
  value: string   // last point, formatted ("42 kg", "Yellow", "7 / 8")
  from: string    // what it's compared with ("was 38 kg")
  start?: string  // the first point alone ("38 kg"), when there's one to compare with
  delta: string   // the pill ("▲ 11%", "▼ 4 kg", "= same", "1 missed")
}

export function formatStatValue(unit: StatUnit, v: number): string {
  switch (unit) {
    case "kg": return `${round1(v)} kg`
    case "added_kg": return `${v >= 0 ? "+" : "−"}${round1(Math.abs(v))} kg`
    case "s": return `${round1(v)} s`
    // An average of slots (Green, Green, Yellow, Yellow = 2.5) reads as the
    // colour every slot has reached.
    case "colour": return colourLabel(BoulderLevelOptions[Math.floor(v + 1e-9)]?.value)
    case "level": return `Level ${Math.round(v)}`
    case "reps": return `${round1(v)} reps`
    case "workouts": return `${round1(v)}`
  }
}

// Higher is always better for the metrics on the card today.
export function statChange(m: StatMetric): StatChange | null {
  if (m.points.length === 0) return null

  if (m.unit === "workouts") {
    const done = m.points.reduce((sum, p) => sum + p.value, 0)
    const planned = m.planned ?? done
    const missed = Math.max(0, planned - done)
    return {
      trend: missed === 0 ? "up" : "down",
      value: `${done} / ${planned}`,
      from: "done so far",
      delta: missed === 0 ? "All done" : `${missed} missed`,
    }
  }

  const first = m.points[0].value
  const last = m.points[m.points.length - 1].value
  const diff = last - first
  const trend: StatTrend = Math.abs(diff) < 1e-9 ? "same" : diff > 0 ? "up" : "down"
  const arrow = trend === "up" ? "▲" : "▼"
  let delta: string
  if (trend === "same") delta = "= same"
  else if (m.unit === "colour" || m.unit === "level") {
    const n = Math.abs(diff)
    const noun = m.unit === "colour" ? "colour" : "level"
    delta = `${arrow} ${round1(n)} ${noun}${n === 1 ? "" : "s"}`
  }
  else if (m.unit === "kg" && first > 0) delta = `${arrow} ${Math.round(Math.abs(diff) / first * 100)}%`
  else delta = `${arrow} ${round1(Math.abs(diff))} ${m.unit === "s" ? "s" : m.unit === "reps" ? "reps" : "kg"}`

  return {
    trend,
    value: formatStatValue(m.unit, last),
    from: m.points.length === 1 ? "first record" : `was ${formatStatValue(m.unit, first)}`,
    ...(m.points.length > 1 ? { start: formatStatValue(m.unit, first) } : {}),
    delta,
  }
}

function round1(v: number): string {
  return String(Math.round(v * 10) / 10)
}

// ─── S&C by movement pattern ──────────────────────────────────────────────────
// One chart per pattern; a pattern can hold several exercises, and each
// exercise is tracked per focus — a hypertrophy set says nothing about a
// max-force one, so they're never on the same line.

// "none": an exercise in a workout with no focus set (built by hand).
export type StatFocus = Focus | "none"

export const FOCUS_ORDER: StatFocus[] = ["max_force", "hypertrophy", "explosiveness", "none"]

export const STAT_FOCUS_LABEL: Record<StatFocus, string> = { ...FOCUS_LABEL, none: "No focus" }
export const STAT_FOCUS_COLOR: Record<StatFocus, string> = { ...FOCUS_COLOR, none: "#8A8A8E" }

export interface ScExerciseStats {
  id: string
  name: string
  unit: "kg" | "added_kg" | "level" | "reps" | "s"
  byFocus: Partial<Record<StatFocus, StatPoint[]>>   // points oldest first
}

export interface ScPatternStats {
  pattern: MovementType
  exercises: ScExerciseStats[]
}

// Patterns the card shows: mobility is left out, and so is any pattern with
// nothing logged.
export function visiblePatterns(patterns: ScPatternStats[]): ScPatternStats[] {
  return patterns
    .filter((p) => p.pattern !== "mobility")
    .map((p) => ({ ...p, exercises: p.exercises.filter((e) => FOCUS_ORDER.some((f) => (e.byFocus[f]?.length ?? 0) > 0)) }))
    .filter((p) => p.exercises.length > 0)
}

// The focuses an exercise was done at, in display order, as metrics
// statChange can read.
export function focusMetrics(e: ScExerciseStats): { focus: StatFocus; metric: StatMetric }[] {
  return FOCUS_ORDER
    .filter((f) => (e.byFocus[f]?.length ?? 0) > 0)
    .map((f) => ({ focus: f, metric: { id: `${e.id}:${f}`, label: e.name, unit: e.unit, points: e.byFocus[f]! } }))
}

// ─── Blocks: project bouldering and 1 on 1 off ───────────────────────────────

export interface ProjectSessionStat {
  label: string     // session date ("Oct 7")
  minutes: number   // time on the project (first → last attempt)
  grade: string     // BoulderLevelOptions value worked
  sent: boolean     // the project went down that session
}

export interface WarmupSessionStat {
  label: string
  minutes: number   // time on: rounds × work time
}

export interface PeriodStats {
  metrics: StatMetric[]
  sc: ScPatternStats[]
  projects: ProjectSessionStat[]
  warmups: WarmupSessionStat[]
}

export function isEmptyPeriod(p: PeriodStats): boolean {
  return p.metrics.every((m) => m.unit === "workouts" || m.points.length === 0)
    && visiblePatterns(p.sc).length === 0 && p.projects.length === 0 && p.warmups.length === 0
}

// ─── Block review ─────────────────────────────────────────────────────────────
// A finished (or running) block in one list: every measured thing, start of
// the block → end, sorted better first. Only things measured at least twice
// can say better or worse; the rest are left out.

export interface ReviewRow {
  id: string
  name: string
  detail?: string        // the focus, for S&C ("Max force")
  focus?: StatFocus
  change: StatChange
}

export interface BlockReview {
  workouts: StatChange | null
  rows: ReviewRow[]
  better: number
  same: number
  worse: number
  projectsSent: number
  projectSessions: number
}

const TREND_ORDER: Record<StatTrend, number> = { up: 0, same: 1, down: 2 }

// 1 on 1 off: minutes of work, first session → last.
export function minutesChange(first: number, last: number): StatChange {
  const diff = last - first
  const trend: StatTrend = Math.abs(diff) < 1e-9 ? "same" : diff > 0 ? "up" : "down"
  return {
    trend,
    value: `${round1(last)} min`,
    from: `was ${round1(first)} min`,
    start: `${round1(first)} min`,
    delta: trend === "same" ? "= same" : `${trend === "up" ? "▲" : "▼"} ${round1(Math.abs(diff))} min`,
  }
}

export function blockReview(p: PeriodStats): BlockReview {
  const rows: ReviewRow[] = []
  for (const m of p.metrics) {
    if (m.unit === "workouts" || m.points.length < 2) continue
    const change = statChange(m)
    if (change) rows.push({ id: m.id, name: m.label, change })
  }
  for (const pattern of visiblePatterns(p.sc)) {
    for (const e of pattern.exercises) {
      for (const { focus, metric } of focusMetrics(e)) {
        if (metric.points.length < 2) continue
        const change = statChange(metric)
        if (change) rows.push({ id: metric.id, name: e.name, detail: STAT_FOCUS_LABEL[focus], focus, change })
      }
    }
  }
  if (p.warmups.length >= 2) {
    rows.push({ id: "warmup", name: "1 on 1 off", change: minutesChange(p.warmups[0].minutes, p.warmups[p.warmups.length - 1].minutes) })
  }
  rows.sort((a, b) => TREND_ORDER[a.change.trend] - TREND_ORDER[b.change.trend])
  const workoutsMetric = p.metrics.find((m) => m.unit === "workouts")
  return {
    workouts: workoutsMetric ? statChange(workoutsMetric) : null,
    rows,
    better: rows.filter((r) => r.change.trend === "up").length,
    same: rows.filter((r) => r.change.trend === "same").length,
    worse: rows.filter((r) => r.change.trend === "down").length,
    projectsSent: p.projects.filter((s) => s.sent).length,
    projectSessions: p.projects.length,
  }
}

// ─── Sample data (UI mockup only) ─────────────────────────────────────────────

const weeks = (...values: number[]) => values.map((value, i) => ({ label: `W${i + 1}`, value }))
const blocks = (...values: number[]) => values.map((value, i) => ({ label: `B${i + 1}`, value }))

const dated = (labels: string[], values: number[]) => values.map((value, i) => ({ label: labels[i], value }))
const blockDates = ["Oct 6", "Oct 13", "Oct 20", "Oct 27", "Nov 3"]
const blockLabels = ["B1", "B2", "B3", "B4"]

export const SAMPLE_STATS: Record<StatsPeriod, PeriodStats> = {
  block: {
    metrics: [
      { id: "edge_lift_max", label: "Edge lift max", unit: "kg", points: weeks(38, 39, 40.5, 42) },
      { id: "four_by_four", label: "4×4", unit: "colour", points: weeks(2, 2, 3, 3) },
      { id: "intervals", label: "Intervals", unit: "s", points: weeks(45, 45, 55, 60) },
      { id: "workouts", label: "Workouts", unit: "workouts", points: weeks(2, 2, 1, 2), planned: 8 },
    ],
    sc: [
      { pattern: "pull_vertical", exercises: [
        { id: "pullup", name: "Weighted pull-up", unit: "added_kg", byFocus: {
          max_force: dated(blockDates, [10, 12, 14]),
          hypertrophy: dated(blockDates.slice(1), [5, 5]),
        } },
        { id: "lat", name: "Lat pulldown", unit: "kg", byFocus: { hypertrophy: dated(blockDates, [40, 42.5, 45]) } },
        { id: "pullup_expl", name: "Explosive pull-up", unit: "added_kg", byFocus: { explosiveness: dated(blockDates, [0, 2.5]) } },
      ] },
      { pattern: "push", exercises: [
        { id: "dips", name: "Dips", unit: "added_kg", byFocus: {
          max_force: dated(blockDates, [8, 10]),
          hypertrophy: dated(blockDates.slice(1), [0, 0, 2]),
        } },
      ] },
      { pattern: "hinge", exercises: [
        { id: "rdl", name: "Romanian deadlift", unit: "kg", byFocus: {
          max_force: dated(blockDates, [60, 65, 70]),
          hypertrophy: dated(blockDates.slice(1), [40, 40]),
        } },
      ] },
      { pattern: "squat", exercises: [
        { id: "split", name: "Split squat", unit: "kg", byFocus: {
          max_force: dated(blockDates, [30, 28, 26]),
          explosiveness: dated(blockDates.slice(1), [10, 12]),
        } },
      ] },
      { pattern: "mobility", exercises: [
        { id: "pancake", name: "Pancake stretch", unit: "kg", byFocus: { hypertrophy: dated(blockDates, [0, 0]) } },
      ] },
    ],
    projects: [
      { label: "Oct 7", minutes: 20, grade: "green", sent: false },
      { label: "Oct 14", minutes: 25, grade: "yellow", sent: false },
      { label: "Oct 21", minutes: 30, grade: "yellow", sent: true },
      { label: "Oct 28", minutes: 20, grade: "red", sent: false },
      { label: "Nov 4", minutes: 35, grade: "red", sent: false },
    ],
    warmups: [
      { label: "Oct 9", minutes: 8 },
      { label: "Oct 16", minutes: 9 },
      { label: "Oct 23", minutes: 10 },
      { label: "Oct 30", minutes: 10 },
    ],
  },
  all: {
    metrics: [
      { id: "edge_lift_max", label: "Edge lift max", unit: "kg", points: blocks(33, 36, 38, 42) },
      { id: "four_by_four", label: "4×4", unit: "colour", points: blocks(1, 2, 2, 3) },
      { id: "intervals", label: "Intervals", unit: "s", points: blocks(30, 40, 45, 60) },
      { id: "workouts", label: "Workouts", unit: "workouts", points: blocks(11, 12, 10, 7), planned: 44 },
    ],
    sc: [
      { pattern: "pull_vertical", exercises: [
        { id: "pullup", name: "Weighted pull-up", unit: "added_kg", byFocus: {
          max_force: dated(blockLabels, [4, 7, 10, 14]),
          hypertrophy: dated(blockLabels, [0, 2.5, 5, 5]),
        } },
        { id: "lat", name: "Lat pulldown", unit: "kg", byFocus: { hypertrophy: dated(blockLabels, [32.5, 35, 40, 45]) } },
      ] },
      { pattern: "push", exercises: [
        { id: "dips", name: "Dips", unit: "added_kg", byFocus: { max_force: dated(blockLabels, [0, 4, 8, 10]) } },
      ] },
      { pattern: "hinge", exercises: [
        { id: "rdl", name: "Romanian deadlift", unit: "kg", byFocus: { max_force: dated(blockLabels, [45, 55, 60, 70]) } },
      ] },
      { pattern: "squat", exercises: [
        { id: "split", name: "Split squat", unit: "kg", byFocus: { max_force: dated(blockLabels, [20, 26, 30, 26]) } },
      ] },
    ],
    projects: [
      { label: "Aug 5", minutes: 15, grade: "blue", sent: true },
      { label: "Aug 19", minutes: 20, grade: "green", sent: false },
      { label: "Sep 2", minutes: 20, grade: "green", sent: true },
      { label: "Sep 16", minutes: 25, grade: "green", sent: false },
      { label: "Sep 30", minutes: 25, grade: "yellow", sent: false },
      { label: "Oct 14", minutes: 25, grade: "yellow", sent: false },
      { label: "Oct 21", minutes: 30, grade: "yellow", sent: true },
      { label: "Oct 28", minutes: 20, grade: "red", sent: false },
      { label: "Nov 4", minutes: 35, grade: "red", sent: false },
    ],
    warmups: [
      { label: "Aug 7", minutes: 6 },
      { label: "Aug 21", minutes: 6 },
      { label: "Sep 4", minutes: 7 },
      { label: "Sep 18", minutes: 8 },
      { label: "Oct 2", minutes: 8 },
      { label: "Oct 16", minutes: 9 },
      { label: "Oct 30", minutes: 10 },
    ],
  },
}
