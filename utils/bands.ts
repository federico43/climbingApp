// Resistance-band assistance for band-assisted exercises (pull-ups first).
//
// Bands, from most assistance to least: green, purple, black, red, yellow
// (coach 2026-11-07). One ladder of single bands and two-band combos orders
// every option by how much help it gives; the guided test walks it until a
// set lands in the focus's rep range, and progression later moves one step
// toward less help. Pure: no React, no Appwrite.

import { FOCUS_REP_RANGE, type Direction, type Focus, type RoundDrop } from "@/utils/scProgression"

export type BandColor = "green" | "purple" | "black" | "red" | "yellow"

// Most → least assistance.
export const BAND_COLORS: BandColor[] = ["green", "purple", "black", "red", "yellow"]

export const BAND_LABEL: Record<BandColor, string> = {
  green:  "Green",
  purple: "Purple",
  black:  "Black",
  red:    "Red",
  yellow: "Yellow",
}

export const BAND_HEX: Record<BandColor, string> = {
  green:  "#3FA34D",
  purple: "#7B4FB8",
  black:  "#222222",
  red:    "#DB504A",
  yellow: "#FED766",
}

// A step: the bands looped together (empty = no band).
export type BandCombo = BandColor[]

// Most → least assistance. Max two bands; combos that land almost on top of
// another step are left out so every move feels different. The first two
// steps only exist for someone who can't reach the range even with green.
// Typical assistance: green ≈ 40 kg, purple ≈ 27, black ≈ 20, red ≈ 11,
// yellow ≈ 5.
export const BAND_LADDER: BandCombo[] = [
  ["green", "purple"],
  ["green", "red"],
  ["green"],
  ["purple", "yellow"],
  ["purple"],
  ["black"],
  ["red", "yellow"],
  ["red"],
  ["yellow"],
  [],
]

// Where an untested athlete starts when they don't know: the strongest
// single band.
export const DEFAULT_START_INDEX = BAND_LADDER.findIndex((c) => c.length === 1 && c[0] === "green")

// Stable id for storage: "green+red", "" for no band.
export function comboId(combo: BandCombo): string {
  return [...combo].sort((a, b) => BAND_COLORS.indexOf(a) - BAND_COLORS.indexOf(b)).join("+")
}

export function comboLabel(combo: BandCombo): string {
  return combo.length ? combo.map((c) => BAND_LABEL[c]).join(" + ") : "No band"
}

// Ladder index of a stored id, or -1 when it isn't on the ladder.
export function ladderIndexOf(id: string | null | undefined): number {
  if (id == null) return -1
  return BAND_LADDER.findIndex((c) => comboId(c) === id)
}

// Band-assisted exercises are recognised by name ("Band Assisted Pull-Ups",
// "Band assisted pull-up", "Banded pull-ups").
export function isBandAssisted(name: string | null | undefined): boolean {
  return /\bband(ed)?\b/i.test(name ?? "") && /assist|pull|chin/i.test(name ?? "")
}

// ─── Guided test ────────────────────────────────────────────────────────────

export interface TestAttempt {
  index: number  // ladder step tried
  reps: number
}

export type TestResult =
  | { done: false; next: number }                   // try this step next
  | { done: true; index: number; reason: TestDoneReason }

export type TestDoneReason =
  | "in_range"     // last set landed in the range
  | "bracketed"    // one step too easy, the next too hard → keep the easier
  | "no_band"      // over the range with no band: nothing lighter to try
  | "max_help"     // under the range with the most help there is

// How far over the top counts as "way too easy" → skip a step.
const BIG_OVERSHOOT = 4

// Next step of the test from the attempts so far (oldest first). Over the
// range → less help (two steps when it overshoots by BIG_OVERSHOOT or more),
// under → more help, in range → done. Never retries a step already judged:
// once a too-easy and a too-hard step are neighbours, it keeps the easier
// (more help) one and lets progression move it later.
export function nextTestStep(focus: Focus, attempts: TestAttempt[]): TestResult {
  const { low, high } = FOCUS_REP_RANGE[focus]
  const last = attempts[attempts.length - 1]
  if (!last) return { done: false, next: DEFAULT_START_INDEX }
  if (last.reps >= low && last.reps <= high) return { done: true, index: last.index, reason: "in_range" }

  const tooEasy = attempts.filter((a) => a.reps > high).map((a) => a.index)
  const tooHard = attempts.filter((a) => a.reps < low).map((a) => a.index)
  // Least-help step known to be too easy, and most-help step known to be too hard.
  const easyEdge = tooEasy.length ? Math.max(...tooEasy) : -1
  const hardEdge = tooHard.length ? Math.min(...tooHard) : BAND_LADDER.length

  const last_ = BAND_LADDER.length - 1
  if (last.reps > high) {
    if (last.index >= last_) return { done: true, index: last_, reason: "no_band" }
    const jump = last.reps - high >= BIG_OVERSHOOT ? 2 : 1
    const next = Math.min(last.index + jump, hardEdge - 1, last_)
    if (next <= easyEdge) return { done: true, index: easyEdge, reason: "bracketed" }
    return { done: false, next }
  }
  // Under the range.
  if (last.index <= 0) return { done: true, index: 0, reason: "max_help" }
  const next = last.index - 1
  if (next <= easyEdge) return { done: true, index: easyEdge, reason: "bracketed" }
  return { done: false, next }
}

// ─── Saved combos ───────────────────────────────────────────────────────────

// Per athlete, per focus: { hypertrophy: "green+red", max_force: "purple" }.
// Stored as a JSON string in users.bandCombos.
export type SavedBands = Partial<Record<Focus, string>>

export function parseSavedBands(raw: string | null | undefined): SavedBands {
  if (!raw) return {}
  try {
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {}
    const out: SavedBands = {}
    for (const f of Object.keys(FOCUS_REP_RANGE) as Focus[]) {
      if (typeof obj[f] === "string" && ladderIndexOf(obj[f]) >= 0) out[f] = obj[f]
    }
    return out
  } catch {
    return {}
  }
}

export function withSavedBand(saved: SavedBands, focus: Focus, index: number): SavedBands {
  return { ...saved, [focus]: comboId(BAND_LADDER[index]) }
}

// ─── Progression ────────────────────────────────────────────────────────────

export interface BandMove {
  index: number
  changed: boolean
  atNoBand: boolean  // already at "no band" and told to increase → time for the next level
}

// One ladder step from the progression rule's direction: "increase" (harder)
// means less help, "decrease" means more help.
export function stepBands(fromIdx: number, direction: Direction): BandMove {
  const lastIdx = BAND_LADDER.length - 1
  const from = Math.min(Math.max(fromIdx, 0), lastIdx)
  const delta = direction === "increase" ? 1 : direction === "decrease" ? -1 : 0
  const index = Math.min(Math.max(from + delta, 0), lastIdx)
  return { index, changed: index !== from, atNoBand: direction === "increase" && from === lastIdx }
}

// Next session on a band-assisted level, from last time's decision at this
// focus. Bands move before the level does: ▲ means one band step less help
// on the same level, until "no band" — only then does the ladder's next
// level take over (keepLevel false). ▼ means more help, until the most help
// there is. With no saved band yet the test runs (bandIdx -1).
export interface BandPlan {
  bandIdx: number     // -1 = no saved band → guided test
  keepLevel: boolean  // stay on the band-assisted level instead of the level move
  note?: string
}

export function planBandNext(savedIdx: number, direction: Direction | undefined, lastWasBand: boolean): BandPlan {
  if (savedIdx < 0) return { bandIdx: -1, keepLevel: lastWasBand }
  if (!lastWasBand || !direction || direction === "hold") return { bandIdx: savedIdx, keepLevel: lastWasBand }
  const move = stepBands(savedIdx, direction)
  if (!move.changed) return { bandIdx: savedIdx, keepLevel: false }
  const to = comboLabel(BAND_LADDER[move.index])
  const note = direction === "increase"
    ? `▲ Top of the range last time. Next band: ${to}`
    : `▼ Under the range last time. More help: ${to}`
  return { bandIdx: move.index, keepLevel: true, note }
}

// In-session, after a round on bands. Under the range → the next round
// starts one step more help, applied with Undo (like a weight or level
// drop). Over the range → a suggestion only, one step less help
// (explosiveness never: more reps isn't the goal). null = nothing to say,
// or already at the most help (the level drop takes over).
export function bandRoundChange(focus: Focus, amount: number | undefined, bandIdx: number): RoundDrop | null {
  if (amount == null || !Number.isFinite(amount) || bandIdx < 0) return null
  const { low, high } = FOCUS_REP_RANGE[focus]
  const got = `you got ${amount} of ${low}–${high} reps`
  if (amount < low) {
    if (bandIdx <= 0) return null
    const to = bandIdx - 1
    return { note: `More help this round: ${comboLabel(BAND_LADDER[to])} — ${got}`, band: to, undo: { band: bandIdx } }
  }
  if (amount > high && focus !== "explosiveness" && bandIdx < BAND_LADDER.length - 1) {
    return { note: `Less help this round: try ${comboLabel(BAND_LADDER[bandIdx + 1])} — ${got}`, bannerOnly: true, raise: true }
  }
  return null
}
