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

import { BAND_LADDER, comboId, DEFAULT_START_INDEX, isBandAssisted } from "@/utils/bands"
import { isWeightedStep } from "@/utils/levelChain"
import { FOCUS_REP_RANGE, type Focus, type LevelStep } from "@/utils/scProgression"

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

// The test is done again every RETEST_AFTER_DAYS, or sooner once a focus
// the test put on bands has reached "no band" (the athlete outgrew it) —
// not in the first week after a test, so a fresh result isn't asked again.
export const RETEST_AFTER_DAYS = 42
const MIN_DAYS_BEFORE_EARLY_RETEST = 7

const daysBetween = (from: string, to: string) => (Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / 86_400_000

export function retestDue(test: SavedPullupTest | null | undefined, today: string, bands: Partial<Record<Focus, string>> = {}): boolean {
  if (!test) return false   // never tested: that's the first test, not a retest
  const days = daysBetween(test.date, today)
  if (!Number.isFinite(days) || days >= RETEST_AFTER_DAYS) return true
  if (days < MIN_DAYS_BEFORE_EARLY_RETEST) return false
  return (Object.keys(FOCUS_REP_RANGE) as Focus[]).some((f) => bands[f] === "" && variationFor(f, test) === "band")
}

// Whether the test's result should set a pull-up ladder's level at a focus:
// no history there, or the test is newer than the last session at it.
export function testIsNewer(test: SavedPullupTest | null | undefined, lastAtFocus: string | undefined): boolean {
  if (!test) return false
  return !lastAtFocus || lastAtFocus.slice(0, 10) < test.date
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

// ─── On the pull-up ladder ───────────────────────────────────────────────────

const isNegative = (n: string) => /negative/i.test(n)
const isFullPullup = (n: string) => /pull[- ]?ups?\b/i.test(n) && !/band|assist|negative|weighted|isometric|explosive/i.test(n)

// A ladder the assessment applies to: it has a band-assisted or a full
// pull-up step.
export function isPullupLadder(chain: LevelStep[]): boolean {
  return chain.some((l) => isBandAssisted(l.name) || isFullPullup(l.name))
}

// The ladder step for a variation (index, -1 = none). A missing step falls
// back to the closest one that exists: weighted → pull-ups, negatives →
// band.
export function stepForVariation(chain: LevelStep[], v: PullVariation): number {
  const find = (test: (n: string) => boolean) => chain.findIndex((l) => test(l.name))
  if (v === "weighted") { const i = find(isWeightedStep); return i >= 0 ? i : stepForVariation(chain, "bodyweight") }
  if (v === "bodyweight") return find(isFullPullup)
  if (v === "negative") { const i = find(isNegative); return i >= 0 ? i : stepForVariation(chain, "band") }
  return find(isBandAssisted)
}

// No negatives, and short of the range even with the most help the bands
// give: the step below the band-assisted one on the ladder (e.g. a chin-up
// isometric), or -1 when there is none — then the athlete stays on the most
// help and does what they can.
export function easierThanBands(chain: LevelStep[]): number {
  const band = chain.findIndex((l) => isBandAssisted(l.name))
  return band > 0 ? band - 1 : -1
}
