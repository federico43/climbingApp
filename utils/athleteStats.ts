import { BoulderLevelOptions, colourLabel } from "@/utils/boulderColours"

// Coach dashboard Stats card (docs/athlete-stats.md): one tile per metric,
// first point vs last point of the period. Pure — no React Native imports —
// so the change rules can be tested in Node.
//
// For now the card only shows SAMPLE_STATS; reading the real numbers out of
// sessions / users / training_plans is the next step (docs/athlete-stats.md §4).

export type StatsPeriod = "block" | "all"
export type StatUnit = "kg" | "added_kg" | "s" | "colour" | "workouts"
export type StatTrend = "up" | "down" | "same"

export interface StatPoint {
  label: string   // x-axis: "W1"…"W6" in a block, "B1"… across blocks
  value: number   // colour metrics: index on BoulderLevelOptions
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
  delta: string   // the pill ("▲ 11%", "▼ 4 kg", "= same", "1 missed")
}

export function formatStatValue(unit: StatUnit, v: number): string {
  switch (unit) {
    case "kg": return `${round1(v)} kg`
    case "added_kg": return `${v >= 0 ? "+" : "−"}${round1(Math.abs(v))} kg`
    case "s": return `${round1(v)} s`
    case "colour": return colourLabel(BoulderLevelOptions[Math.round(v)]?.value)
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
  else if (m.unit === "colour") delta = `${arrow} ${Math.abs(Math.round(diff))} colour${Math.abs(Math.round(diff)) === 1 ? "" : "s"}`
  else if (m.unit === "kg" && first > 0) delta = `${arrow} ${Math.round(Math.abs(diff) / first * 100)}%`
  else delta = `${arrow} ${round1(Math.abs(diff))} ${m.unit === "s" ? "s" : "kg"}`

  return {
    trend,
    value: formatStatValue(m.unit, last),
    from: m.points.length === 1 ? "first record" : `was ${formatStatValue(m.unit, first)}`,
    delta,
  }
}

function round1(v: number): string {
  return String(Math.round(v * 10) / 10)
}

// ─── Sample data (UI mockup only) ─────────────────────────────────────────────

const weeks = (...values: number[]) => values.map((value, i) => ({ label: `W${i + 1}`, value }))
const blocks = (...values: number[]) => values.map((value, i) => ({ label: `B${i + 1}`, value }))

export const SAMPLE_STATS: Record<StatsPeriod, StatMetric[]> = {
  block: [
    { id: "edge_lift_max", label: "Edge lift max", unit: "kg", points: weeks(38, 39, 40.5, 42) },
    { id: "four_by_four", label: "4×4", unit: "colour", points: weeks(2, 2, 3, 3) },
    { id: "intervals", label: "Intervals", unit: "s", points: weeks(45, 45, 55, 60) },
    { id: "sc_pull", label: "Pull-up", unit: "added_kg", points: weeks(12, 12, 12, 12) },
    { id: "sc_split_squat", label: "Split squat", unit: "kg", points: weeks(30, 30, 28, 26) },
    { id: "workouts", label: "Workouts", unit: "workouts", points: weeks(2, 2, 1, 2), planned: 8 },
  ],
  all: [
    { id: "edge_lift_max", label: "Edge lift max", unit: "kg", points: blocks(33, 36, 38, 42) },
    { id: "four_by_four", label: "4×4", unit: "colour", points: blocks(1, 2, 2, 3) },
    { id: "intervals", label: "Intervals", unit: "s", points: blocks(30, 40, 45, 60) },
    { id: "sc_pull", label: "Pull-up", unit: "added_kg", points: blocks(5, 8, 12, 12) },
    { id: "sc_split_squat", label: "Split squat", unit: "kg", points: blocks(20, 26, 30, 26) },
    { id: "workouts", label: "Workouts", unit: "workouts", points: blocks(11, 12, 10, 7), planned: 44 },
  ],
}
