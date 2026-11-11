// Pull-up assessment: which pull-up variation each focus uses, from the
// athlete's pulling strength rather than from the session's focus
// (coach 2026-11-11). Some athletes can't do a pull-up, so even
// hypertrophy is band-assisted; some can do negatives but not full
// pull-ups in the hypertrophy range; most need a band for explosive
// pull-ups. Pure: no React, no Appwrite.
//
// The test (scapulas retracted on every rep):
//   1. Max strict pull-ups, one set, bodyweight.
//   2. Only with 0–2: max slow negatives (5 s down each), one set.
//   3. Band finder for each focus that comes out band-assisted
//      (nextTestStep in utils/bands.ts), starting from a band estimated
//      from step 1 instead of always green.

import { BAND_LADDER, comboId, DEFAULT_START_INDEX } from "@/utils/bands"
import { FOCUS_REP_RANGE, type Focus } from "@/utils/scProgression"

export type PullVariation = "band" | "negative" | "bodyweight" | "weighted"

export const VARIATION_LABEL: Record<PullVariation, string> = {
  band:       "Band-assisted pull-ups",
  negative:   "Negative pull-ups",
  bodyweight: "Pull-ups",
  weighted:   "Weighted pull-ups",
}

export interface PullupTestResult {
  maxReps: number      // strict bodyweight pull-ups in one set
  negatives?: number   // controlled 5 s negatives in one set (asked only with maxReps ≤ NEGATIVES_ASKED_UP_TO)
}

// Step 2 is only asked when full pull-ups can't carry max force.
export const NEGATIVES_ASKED_UP_TO = 2
// Negatives carry max force from this many controlled 5 s lowers.
export const MIN_NEGATIVES = 3
// Explosive reps are fast reps, well short of the max: bodyweight only once
// the top of the explosive range is at most half of the max.
const EXPLOSIVE_SHARE = 0.5

// One focus: bodyweight max inside the range → pull-ups; above → weighted;
// below → help. The help is negatives for max force when the athlete
// controls enough of them, a band otherwise (negatives can't be done fast
// or for 8–12).
export function variationFor(focus: Focus, r: PullupTestResult): PullVariation {
  const { low, high } = FOCUS_REP_RANGE[focus]
  if (focus === "explosiveness") return r.maxReps * EXPLOSIVE_SHARE >= high ? "bodyweight" : "band"
  if (r.maxReps > high) return "weighted"
  if (r.maxReps >= low) return "bodyweight"
  if (focus === "max_force" && (r.negatives ?? 0) >= MIN_NEGATIVES) return "negative"
  return "band"
}

export type PullupPlan = Record<Focus, PullVariation>

export function planFromTest(r: PullupTestResult): PullupPlan {
  return {
    max_force:     variationFor("max_force", r),
    hypertrophy:   variationFor("hypertrophy", r),
    explosiveness: variationFor("explosiveness", r),
  }
}

// Where the band finder starts for a focus, from how many reps the athlete
// is short of the range's middle: the bigger the gap, the more help. Saves
// tries compared with always starting on green.
export function bandStartFor(focus: Focus, r: PullupTestResult): number {
  // No pull-up at all: the most help any single band gives.
  if (r.maxReps <= 0) return DEFAULT_START_INDEX
  const { low, high } = FOCUS_REP_RANGE[focus]
  // Explosive reps are judged against the max at half effort (see above).
  const can = focus === "explosiveness" ? r.maxReps * EXPLOSIVE_SHARE : r.maxReps
  const short = (low + high) / 2 - can
  const at = (id: string) => BAND_LADDER.findIndex((c) => comboId(c) === id)
  if (short >= 8) return DEFAULT_START_INDEX       // green
  if (short >= 5) return at("purple")
  if (short >= 3) return at("black")
  return at("red")
}

// The test is done again when the athlete outgrows what it assigned: a band
// focus has reached "no band", or negatives top out. Retest suggestion only.
export const RETEST_AFTER_DAYS = 42

export function retestDue(testedOn: string | undefined, today: string): boolean {
  if (!testedOn) return true
  const days = (Date.parse(today) - Date.parse(testedOn)) / 86_400_000
  return !Number.isFinite(days) || days >= RETEST_AFTER_DAYS
}

// Stored on users.pullupTest (JSON).
export interface SavedPullupTest extends PullupTestResult {
  date: string   // YYYY-MM-DD
}

export function parsePullupTest(raw: string | null | undefined): SavedPullupTest | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw)
    if (!o || typeof o.date !== "string" || !Number.isFinite(o.maxReps) || o.maxReps < 0) return null
    return { date: o.date, maxReps: o.maxReps, ...(Number.isFinite(o.negatives) ? { negatives: o.negatives } : {}) }
  } catch {
    return null
  }
}
