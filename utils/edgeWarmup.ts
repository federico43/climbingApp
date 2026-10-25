// Edge Lifts: the athlete's max and the warm-up ramp built from it (coach
// 2026-10-23). Before the first max force round the athlete does 4 holds,
// each heavier and shorter, 1 min rest between, 2 min before the round;
// the rounds are at 100 % of the max. The max is set by a test the coach
// runs (or typed by the coach) and only changes that way. Pure — no
// fetching or UI.
import { convertWeight, DEFAULT_LOAD_STEP, type Focus, type WeightUnit } from "@/utils/scProgression"

// The library exercise this applies to, by exact name (as SPECIAL_CASE_EXERCISES
// in utils/scPlanBuilder.ts).
export const EDGE_LIFT_NAME = "Edge Lifts"

export const EDGE_WARMUP = {
  sets: [
    { pct: 0.4, secs: 10 },
    { pct: 0.55, secs: 8 },
    { pct: 0.7, secs: 6 },
    { pct: 0.85, secs: 4 },
  ],
  restSecs: 60,       // between warm-up sets
  lastRestSecs: 120,  // after the last one, before round 1
  testHoldSecs: 10,   // the max: heaviest weight held this long
} as const

export interface WarmupSet {
  weight: number   // in the athlete's unit
  secs: number
}

// "Edge Lift" (singular) too — a block typed by hand may say it that way.
export function isEdgeLift(ex: { name?: string }): boolean {
  const name = (ex.name ?? "").trim().toLowerCase()
  const full = EDGE_LIFT_NAME.toLowerCase()
  return name === full || name === full.replace(/s$/, "")
}

// Edge Lifts trained for max force get the ramp; repeaters / explosiveness
// days don't. A block made by hand with no focus picked counts as max force
// (what Edge Lifts are for — see SPECIAL_CASE_EXERCISES).
export function needsWarmup(ex: { name?: string; focus?: Focus }): boolean {
  return isEdgeLift(ex) && (ex.focus === "max_force" || !ex.focus)
}

function roundTo(w: number, step: number): number {
  return Math.round(Math.max(step, Math.round(w / step) * step) * 100) / 100
}

// The 4 warm-up sets for a max (kg), in the athlete's unit, each rounded to
// the exercise's load step (kg; unset → 0.5 kg / 1 lb).
export function warmupRamp(maxKg: number, unit: WeightUnit, loadStep?: number): WarmupSet[] {
  if (!(maxKg > 0)) return []
  const max = convertWeight(maxKg, "kg", unit)
  const step = loadStep && loadStep > 0 ? convertWeight(loadStep, "kg", unit) || DEFAULT_LOAD_STEP[unit] : DEFAULT_LOAD_STEP[unit]
  return EDGE_WARMUP.sets.map((s) => ({ weight: roundTo(max * s.pct, step), secs: s.secs }))
}

// ─── The max, as stored on the athlete's `users` row ────────────────────────
// `edgeLiftMax` (float, kg) is the current one; `edgeLiftMaxLog` (string,
// JSON) keeps every change, newest first.

export type MaxSource = "test" | "coach"

export interface MaxEntry {
  kg: number
  date: string     // "YYYY-MM-DD"
  source: MaxSource
}

export const MAX_LOG_LIMIT = 30

export function parseMaxLog(raw: unknown): MaxEntry[] {
  let list: unknown = raw
  if (typeof raw === "string") {
    try { list = JSON.parse(raw) } catch { return [] }
  }
  if (!Array.isArray(list)) return []
  return list.filter((e): e is MaxEntry => !!e && typeof e.kg === "number" && e.kg > 0 && typeof e.date === "string")
}

// The log with a new max on top (capped).
export function withNewMax(log: MaxEntry[], entry: MaxEntry): MaxEntry[] {
  return [entry, ...log].slice(0, MAX_LOG_LIMIT)
}

// The athlete's current max (kg), or null when there is none.
export function currentMax(row: { edgeLiftMax?: unknown } | null | undefined): number | null {
  const v = Number(row?.edgeLiftMax)
  return Number.isFinite(v) && v > 0 ? v : null
}
