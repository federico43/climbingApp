import { BoulderLevelOptions, colourIndex, colourLabel, shiftColour } from "@/utils/boulderColours"
import type { Attempt } from "@/hooks/WorkoutHook"
import type { BlockRun } from "@/utils/blockHistory"
import { FOUR_BY_FOUR_RULES } from "@/utils/progression/profiles"
import type { Direction } from "@/utils/scProgression"

// Pure decision engine for 4×4 progression — spec §3.3 in
// docs/progression-spec.md. A "boulder" is an abstract slot with a colour;
// the block holds one colour per slot (e.g. [yellow, green, green, green]).
// In session (live): a fall in set 1 or 2 lowers one boulder one colour for
// the remaining sets — the last boulder holding the highest colour, so drops
// run last → first, mirroring upgrades (liveStepDown):
//   [Y,Y,Y,Y] → [Y,Y,Y,G] → [Y,Y,G,G].
// Between sessions, starting from the colours the athlete finished on:
//   - no fall in any set      → the first slot holding the lowest colour goes up;
//   - fall in set 1 or 2      → same colours they finished on (already lowered
//                               live); a drop that couldn't happen live (fall
//                               in the final set, older logs) is applied now;
//   - falls only in set 3+    → same boulders.
// The first session (no history) starts every slot one colour below the
// athlete's flash level, unless the coach set the colours on the block.
// No fetching or UI here — the athlete runtime and coach editor share it.

const TOP = BoulderLevelOptions[BoulderLevelOptions.length - 1].value
const FLOOR = BoulderLevelOptions[0].value

// Fit a colour list to `n` slots: extra slots copy the last colour, surplus
// ones are dropped. Null when there's nothing usable to fit.
export function fitGrades(grades: unknown, n: number): string[] | null {
  if (!Array.isArray(grades)) return null
  const valid = grades.filter((g): g is string => typeof g === "string" && colourIndex(g) >= 0)
  if (valid.length === 0 || n <= 0) return null
  return Array.from({ length: n }, (_, i) => valid[Math.min(i, valid.length - 1)])
}

// The colours a block will run with as the coach authored it. Blocks from
// before per-slot colours have none (the athlete used to pick one colour).
export function authoredGrades(block: any): string[] | null {
  return fitGrades(block?.boulderGrades, block?.bouldersPerSet ?? 4)
}

// The slot colours of one logged set: `scData.grades`, or — for sessions
// logged before per-slot colours — the single colour picked, on every slot.
export function attemptGrades(a: Attempt | undefined, n: number): string[] | null {
  if (!a) return null
  if (Array.isArray(a.scData?.grades)) return fitGrades(a.scData!.grades, n)
  return a.level ? fitGrades([a.level], n) : null
}

// The colours the athlete *finished* a past run on (the last set logged).
export function runGrades(run: BlockRun): string[] | null {
  const n = run.block?.bouldersPerSet ?? 4
  return attemptGrades(run.attempts[run.attempts.length - 1], n)
}

export function startingGrades(flashLevel: string | null | undefined, n: number): string[] | null {
  if (colourIndex(flashLevel) < 0) return null
  return fitGrades([shiftColour(flashLevel!, -FOUR_BY_FOUR_RULES.startBelowFlash)], n)
}

// ─── Reading one run ─────────────────────────────────────────────────────────

function fell(a: Attempt, n: number): boolean {
  return typeof a.scData?.tops === "number" && a.scData.tops < n
}
function setNumber(a: Attempt, i: number): number {
  return typeof a.scData?.set === "number" ? a.scData.set : i + 1
}

export interface FourByFourRunSummary {
  sets: number
  tops: number
  possible: number
  fellInSets: number[]   // 1-based set numbers with tops < boulders per set
}

export function summarizeFourByFourRun(run: BlockRun): FourByFourRunSummary {
  const n = run.block?.bouldersPerSet ?? 4
  const fellInSets: number[] = []
  let tops = 0
  run.attempts.forEach((a, i) => {
    tops += typeof a.scData?.tops === "number" ? a.scData.tops : n
    if (fell(a, n)) fellInSets.push(setNumber(a, i))
  })
  return { sets: run.attempts.length, tops, possible: run.attempts.length * n, fellInSets }
}

// ─── In session ──────────────────────────────────────────────────────────────

// Lower one boulder one colour after a fall in sets 1…earlyFallSets: the
// last slot holding the highest colour (the mirror of nextSlotToRaise). Null
// when every boulder is already at the floor.
export function liveStepDown(grades: string[]): { grades: string[]; slot: number } | null {
  let slot = grades.length - 1
  for (let i = grades.length - 1; i >= 0; i--) if (colourIndex(grades[i]) > colourIndex(grades[slot])) slot = i
  if (grades[slot] === FLOOR) return null
  return { grades: withSlot(grades, slot, shiftColour(grades[slot], -FOUR_BY_FOUR_RULES.colourStep)), slot }
}

// Early-fall drops the log shows were owed but not applied live — a fall in
// the final set (no set left to lower), or sessions logged before live
// drops existed. Early falls minus the colour changes between logged sets.
export function pendingStepDowns(attempts: Attempt[], n: number): number {
  let early = 0
  let changes = 0
  attempts.forEach((a, i) => {
    if (fell(a, n) && setNumber(a, i) <= FOUR_BY_FOUR_RULES.earlyFallSets) early++
    if (i > 0 && attemptGrades(a, n)?.join() !== attemptGrades(attempts[i - 1], n)?.join()) changes++
  })
  return Math.max(0, early - changes)
}

// ─── Between sessions ────────────────────────────────────────────────────────

export interface FourByFourSuggestion {
  direction: Direction
  grades: string[]
  // Plain-language reason, shown on two lines like the sequence banner.
  lastTime: string
  note: string
}

function lastTimeText(s: FourByFourRunSummary): string {
  const fellText = s.fellInSets.length === 0
    ? "no falls"
    : `fell in set${s.fellInSets.length > 1 ? "s" : ""} ${s.fellInSets.join(", ")}`
  return `Last time: ${s.tops} of ${s.possible} tops — ${fellText}.`
}

// The slot the next upgrade goes to: the first one holding the lowest colour
// (so upgrades run first → last, and a dropped last slot is refilled first).
export function nextSlotToRaise(grades: string[]): number {
  let best = 0
  grades.forEach((g, i) => { if (colourIndex(g) < colourIndex(grades[best])) best = i })
  return best
}

function withSlot(grades: string[], i: number, colour: string): string[] {
  return grades.map((g, j) => (j === i ? colour : g))
}

// `bouldersPerSet` = the block about to run (it may differ from past runs).
// `authored` = the coach's colours on the block, if any — with no history
// they win and there's no suggestion. Null = no suggestion: the block runs as
// authored, or the athlete picks a colour if nothing was set.
export function suggestNextFourByFour(
  runs: BlockRun[],
  opts: { bouldersPerSet: number; flashLevel?: string | null; authored?: string[] | null },
): FourByFourSuggestion | null {
  const n = opts.bouldersPerSet
  const { earlyFallSets, colourStep } = FOUR_BY_FOUR_RULES
  const last = runs[0]
  const finished = last ? fitGrades(runGrades(last), n) : null

  if (!last || !finished) {
    if (opts.authored) return null
    const start = startingGrades(opts.flashLevel, n)
    if (!start) return null
    const why = start[0] === opts.flashLevel
      ? `the easiest colour (flash level is ${colourLabel(opts.flashLevel)})`
      : `one colour below the athlete's flash level (${colourLabel(opts.flashLevel)})`
    return { direction: "hold", grades: start, lastTime: "First time on this block.",
      note: `Next: every boulder ${colourLabel(start[0])}, ${why}.` }
  }

  const s = summarizeFourByFourRun(last)
  const lastTime = lastTimeText(s)

  if (s.fellInSets.length === 0) {
    if (finished.every((g) => g === TOP)) {
      return { direction: "hold", grades: finished, lastTime,
        note: `Every boulder is already ${colourLabel(TOP)}, the top colour — next: the same boulders.` }
    }
    const i = nextSlotToRaise(finished)
    const up = shiftColour(finished[i], colourStep)
    return { direction: "increase", grades: withSlot(finished, i, up), lastTime,
      note: `Next: boulder ${i + 1} goes up to ${colourLabel(up)}.` }
  }

  const early = s.fellInSets.find((set) => set <= earlyFallSets)
  if (early == null) {
    return { direction: "hold", grades: finished, lastTime,
      note: `Falls only after set ${earlyFallSets} — next: the same boulders.` }
  }

  // Drops owed but not applied live, starting from the run's first colours.
  const start = fitGrades(attemptGrades(last.attempts[0], last.block?.bouldersPerSet ?? 4), n) ?? finished
  let grades = finished
  const lowered: number[] = []
  for (let k = pendingStepDowns(last.attempts, last.block?.bouldersPerSet ?? 4); k > 0; k--) {
    const step = liveStepDown(grades)
    if (!step) break
    grades = step.grades
    lowered.push(step.slot)
  }
  if (lowered.length > 0) {
    return { direction: "decrease", grades, lastTime,
      note: `Next: ${lowered.map((i) => `boulder ${i + 1} drops to ${colourLabel(grades[i])}`).join(", ")}.` }
  }
  return { direction: "hold", grades, lastTime,
    note: grades.join() === start.join()
      ? `Fell in set ${early}, but every boulder is already ${colourLabel(FLOOR)} — next: the same boulders.`
      : "Boulders were lowered during the session — next: start on the colours finished on." }
}
