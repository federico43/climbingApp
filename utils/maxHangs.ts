// Max Hangs (coach 2026-11-11): max-strength hangs on the hangboard. Like
// Edge Lifts (utils/edgeWarmup.ts) the athlete has a max set by a test, but
// one per grip — the edge (or pocket) size the fingers go on. The max is the
// heaviest weight ADDED to bodyweight held for 10 s on that edge (0 =
// bodyweight). Max force rounds hang the max for 10 s, after a short
// warm-up ramp on the same edge. Pure — no fetching or UI.
import { DEFAULT_LOAD_STEP, convertWeight, type Effort, type Focus, type WeightUnit } from "@/utils/scProgression"
import type { MaxSource, WarmupSet } from "@/utils/edgeWarmup"

// The library exercise this applies to, by exact name.
export const MAX_HANGS_NAME = "Max Hangs"

// The grips: edge / pocket depth, biggest (easiest) first.
export const HANG_EDGES = ["30mm", "25mm", "20mm", "15mm", "12mm", "10mm", "8mm", "6mm"] as const
export const DEFAULT_HANG_EDGE = "20mm"

export const MAX_HANGS = {
  holdSecs: 10,        // the test and every main hang
  testRestSecs: 180,   // between test tries
  testMaxTries: 8,     // the test ends by itself after this many
  // Warm-up on the same edge: kg under the max (never below bodyweight),
  // each shorter than the last.
  warmup: [
    { underKg: 15, secs: 10 },
    { underKg: 10, secs: 7 },
    { underKg: 5, secs: 5 },
  ],
} as const

// Coach 2026-11-11: every hang, shoulder blades pulled back and down.
export const SCAPULA_CUE = "Keep your shoulder blades retracted (pulled back and down) the whole hang."

// "Max Hang" / "max hangs" too — a block typed by hand may say it that way.
export function isMaxHang(ex: { name?: string }): boolean {
  const name = (ex.name ?? "").trim().toLowerCase()
  const full = MAX_HANGS_NAME.toLowerCase()
  return name === full || name === full.replace(/s$/, "")
}

// Max force (or no focus picked) hangs get the max and the ramp.
export function needsHangWarmup(ex: { name?: string; focus?: Focus }): boolean {
  return isMaxHang(ex) && (ex.focus === "max_force" || !ex.focus)
}

// "20 mm", "20", "20MM" → "20mm"; anything without a number → "".
export function normalizeEdge(raw: unknown): string {
  const m = String(raw ?? "").match(/\d+(?:[.,]\d+)?/)
  return m ? `${m[0].replace(",", ".")}mm` : ""
}

// The edge a hang exercise is done on (unset → the default).
export function hangEdgeOf(ex: { edge?: string }): string {
  return normalizeEdge(ex.edge) || DEFAULT_HANG_EDGE
}

// ─── The maxes, as stored on the athlete's `users` row ──────────────────────
// `hangMaxLog` (string, JSON) keeps every change, newest first; the current
// max for an edge is its newest entry.

export interface HangMaxEntry {
  edge: string     // normalized, e.g. "20mm"
  kg: number       // added weight; 0 = bodyweight
  date: string     // "YYYY-MM-DD"
  source: MaxSource
}

export const HANG_LOG_LIMIT = 60

export function parseHangLog(raw: unknown): HangMaxEntry[] {
  let list: unknown = raw
  if (typeof raw === "string") {
    if (!raw.trim()) return []
    try { list = JSON.parse(raw) } catch { return [] }
  }
  if (!Array.isArray(list)) return []
  return list
    .filter((e) => !!e && typeof e.kg === "number" && Number.isFinite(e.kg) && e.kg >= 0 && typeof e.date === "string" && !!normalizeEdge(e.edge))
    .map((e) => ({ ...e, edge: normalizeEdge(e.edge) }))
}

// The log with a new max on top (capped).
export function withHangMax(log: HangMaxEntry[], entry: HangMaxEntry): HangMaxEntry[] {
  return [{ ...entry, edge: normalizeEdge(entry.edge) || DEFAULT_HANG_EDGE }, ...log].slice(0, HANG_LOG_LIMIT)
}

// The current max (kg added) for an edge, or null when there is none.
export function hangMaxFor(log: HangMaxEntry[], edge: string): number | null {
  const key = normalizeEdge(edge)
  return log.find((e) => e.edge === key)?.kg ?? null
}

// Every edge that has a max, in HANG_EDGES order (others after), with it.
export function hangMaxes(log: HangMaxEntry[]): { edge: string; kg: number }[] {
  const seen = new Map<string, number>()
  for (const e of log) if (!seen.has(e.edge)) seen.set(e.edge, e.kg)
  const rank = (edge: string) => {
    const i = (HANG_EDGES as readonly string[]).indexOf(edge)
    return i < 0 ? HANG_EDGES.length : i
  }
  return [...seen].map(([edge, kg]) => ({ edge, kg })).sort((a, b) => rank(a.edge) - rank(b.edge))
}

function roundTo(w: number, step: number): number {
  return Math.round(Math.max(0, Math.round(w / step) * step) * 100) / 100
}

// The warm-up hangs for a max (kg added), in the athlete's unit, each
// rounded to the load step (kg; unset → 0.5 kg / 1 lb). A bodyweight max
// warms up at bodyweight, just shorter hangs.
export function hangWarmupRamp(maxKg: number | null | undefined, unit: WeightUnit, loadStep?: number): WarmupSet[] {
  if (maxKg == null || !Number.isFinite(maxKg) || maxKg < 0) return []
  const step = loadStep && loadStep > 0 ? convertWeight(loadStep, "kg", unit) || DEFAULT_LOAD_STEP[unit] : DEFAULT_LOAD_STEP[unit]
  return MAX_HANGS.warmup.map((s) => ({
    weight: roundTo(convertWeight(Math.max(0, maxKg - s.underKg), "kg", unit), step),
    secs: s.secs,
  }))
}

// "Bodyweight" / "+12.5 kg".
export function hangLoadLabel(weight: number, unit: WeightUnit): string {
  return weight > 0 ? `+${weight} ${unit}` : "Bodyweight"
}

// The next bigger edge (easier grip), or null when already on the biggest.
export function biggerEdge(edge: string): string | null {
  const key = normalizeEdge(edge)
  const mm = parseFloat(key)
  const bigger = HANG_EDGES.filter((e) => parseFloat(e) > mm)
  return bigger.length ? bigger[bigger.length - 1] : null
}

// ─── The max test, try by try (coach 2026-11-11) ─────────────────────────────
// Each try is a 10 s hang at a load (added weight, in the athlete's unit).
// Held → how hard was it; let go early → was it a mistake (bad grip,
// slipped: same load again) or too hard. The max is the heaviest load held.

export type HangFailReason = "mistake" | "too_hard"

export interface HangTry {
  weight: number          // added, athlete's unit; 0 = bodyweight
  held: boolean           // the full 10 s
  secs?: number           // how long it lasted
  effort?: Effort         // held: easy / solid / max
  reason?: HangFailReason // not held
}

export type HangTestNext =
  | { kind: "try"; weight: number; why: "start" | "up" | "retry" | "down" }
  | { kind: "done"; weight: number }       // max found
  | { kind: "bigger_edge"; edge: string | null }  // can't hang bodyweight here

// How much to add after a held try, in the athlete's unit.
export const HANG_TEST_JUMP: Record<WeightUnit, Record<"easy" | "solid", number>> = {
  kg: { easy: 5, solid: 2 },
  lb: { easy: 10, solid: 4 },
}

// The heaviest load held so far, or null.
export function bestHeld(tries: HangTry[]): number | null {
  const held = tries.filter((t) => t.held).map((t) => t.weight)
  return held.length ? Math.max(...held) : null
}

// What the test does after these tries. `start` is the first try's load.
export function nextHangTry(tries: HangTry[], unit: WeightUnit, edge: string, start = 0): HangTestNext {
  const last = tries[tries.length - 1]
  const best = bestHeld(tries)
  const round = (w: number) => Math.round(Math.max(0, w) * 100) / 100
  if (!last) return { kind: "try", weight: round(start), why: "start" }
  if (tries.length >= MAX_HANGS.testMaxTries) {
    return best != null ? { kind: "done", weight: best } : { kind: "bigger_edge", edge: biggerEdge(edge) }
  }
  if (last.held) {
    if (last.effort === "max") return { kind: "done", weight: best! }
    // Never go back to a load already failed as too hard: aim between.
    const jump = HANG_TEST_JUMP[unit][last.effort === "easy" ? "easy" : "solid"]
    const ceiling = Math.min(...tries.filter((t) => !t.held && t.reason === "too_hard" && t.weight > last.weight).map((t) => t.weight), Infinity)
    const next = round(Math.min(last.weight + jump, ceiling - DEFAULT_LOAD_STEP[unit]))
    return next > last.weight ? { kind: "try", weight: next, why: "up" } : { kind: "done", weight: best! }
  }
  // Let go early.
  if (last.reason === "mistake") {
    // Two mistakes in a row at the same load count as too hard.
    const prev = tries[tries.length - 2]
    const repeated = prev && !prev.held && prev.reason === "mistake" && prev.weight === last.weight
    if (!repeated) return { kind: "try", weight: last.weight, why: "retry" }
  }
  if (best != null) return { kind: "done", weight: best }
  if (last.weight <= 0) return { kind: "bigger_edge", edge: biggerEdge(edge) }
  return { kind: "try", weight: round(last.weight - HANG_TEST_JUMP[unit].easy), why: "down" }
}

// One line per try for the session log, e.g. "+10 kg held (solid) · +15 kg 6 s (too hard)".
export function hangTriesSummary(tries: HangTry[], unit: WeightUnit): string {
  return tries.map((t) => {
    const load = hangLoadLabel(t.weight, unit)
    if (t.held) return `${load} held${t.effort ? ` (${t.effort})` : ""}`
    return `${load} ${t.secs ?? 0} s (${t.reason === "mistake" ? "mistake" : "too hard"})`
  }).join(" · ")
}
