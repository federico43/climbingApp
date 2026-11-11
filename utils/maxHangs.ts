// Max Hangs (coach 2026-11-11): max-strength hangs on the hangboard. Like
// Edge Lifts (utils/edgeWarmup.ts) the athlete has a max set by a test, but
// one per grip — the edge (or pocket) size the fingers go on. The max is the
// heaviest weight ADDED to bodyweight held for 10 s on that edge (0 =
// bodyweight). Max force rounds hang the max for 10 s, after a short
// warm-up ramp on the same edge. Pure — no fetching or UI.
import { DEFAULT_LOAD_STEP, convertWeight, type Focus, type WeightUnit } from "@/utils/scProgression"
import type { MaxSource, WarmupSet } from "@/utils/edgeWarmup"

// The library exercise this applies to, by exact name.
export const MAX_HANGS_NAME = "Max Hangs"

// The grips: edge / pocket depth, biggest (easiest) first.
export const HANG_EDGES = ["30mm", "25mm", "20mm", "15mm", "12mm", "10mm", "8mm", "6mm"] as const
export const DEFAULT_HANG_EDGE = "20mm"

export const MAX_HANGS = {
  holdSecs: 10,        // the test and every main hang
  // Warm-up on the same edge: kg under the max (never below bodyweight),
  // each shorter than the last.
  warmup: [
    { underKg: 15, secs: 10 },
    { underKg: 10, secs: 7 },
    { underKg: 5, secs: 5 },
  ],
} as const

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
