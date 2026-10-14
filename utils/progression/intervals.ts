import type { Attempt } from "@/hooks/WorkoutHook"
import type { BlockRun } from "@/utils/blockHistory"
import { INTERVALS_RULES } from "@/utils/progression/profiles"
import type { Direction } from "@/utils/scProgression"

// Pure decision engine for intervals progression — spec §3.4 in
// docs/progression-spec.md. Two kinds, picked by the coach on the block:
//   - warm-up: athletes shouldn't fall or find it hard. Live: each fall takes
//     10 s off the following rounds (liveWorkAfterFall). Next session starts
//     on the work time they finished on (a fall in the last round, with no
//     round left to shorten, is applied then). No fall: "very pumped in the
//     last two rounds" → −10 s; not pumped → +10 s.
//   - power endurance: a fall in the first two thirds of the rounds is too
//     much time on the wall → −10 s; a later fall → same; no fall and "felt
//     very easy" → +10 s, or — already at 90 s — one more round.
// Work time stays within 30–90 s; rest never changes.
// No fetching or UI here — the athlete runtime and coach editor share it.

export type IntervalsKind = "warmup" | "power_endurance"

export const INTERVALS_KIND_LABEL: Record<IntervalsKind, string> = {
  warmup: "Warm-up",
  power_endurance: "Power endurance",
}

// The block's description, built from its settings so it always matches
// what the athlete runs (including a suggested work time / extra round).
// The coach's own text, if any, is shown under it as notes.
export function intervalsDescription(o: { kind?: IntervalsKind; series: number; workTime: number; restTime: number }): string {
  const t = (sec: number) => (sec >= 60 && sec % 60 === 0 ? `${sec / 60} min` : `${sec} s`)
  const what = `${o.series} rounds of ${t(o.workTime)} on the wall, ${t(o.restTime)} rest between rounds.`
  if (o.kind === "warmup") return `Warm-up intervals: ${what} It should never get hard — no falls, not very pumped.`
  if (o.kind === "power_endurance") return `Power endurance intervals: ${what} Stay on the wall the whole round; if you come off, tap "I fell".`
  return `Intervals: ${what}`
}

// What one run logs (scData on the block's single attempt).
export interface IntervalsLog {
  kind?: IntervalsKind
  series: number
  workTime: number         // work time of the last round (after live cuts)
  startWorkTime?: number   // work time the block started on
  restTime: number
  fellInRound?: number   // first round they came off in, 1-based
  falls?: number[]       // every round with a fall (warm-up cuts per fall)
  pumped?: boolean       // warm-up, asked only with no fall
  veryEasy?: boolean     // power endurance, asked only with no fall
}

export function intervalsLog(a: Attempt | undefined): IntervalsLog | null {
  const d = a?.scData
  if (!d || typeof d.workTime !== "number" || typeof d.series !== "number") return null
  return d as IntervalsLog
}

// Rounds 1…this count as an early fall for power endurance (8 → 5).
export function earlyFallLimit(series: number): number {
  return Math.max(1, Math.floor(series * INTERVALS_RULES.earlyFallFraction))
}

export function clampWork(sec: number): number {
  return Math.max(INTERVALS_RULES.minWork, Math.min(INTERVALS_RULES.maxWork, sec))
}

// Warm-up, in session: the work time for the rounds after a fall.
export function liveWorkAfterFall(workTime: number): number {
  return clampWork(workTime - INTERVALS_RULES.workStep)
}

export interface IntervalsSuggestion {
  direction: Direction
  workTime: number
  series: number
  // Plain-language reason, shown on two lines like the other banners.
  lastTime: string
  note: string
}

function lastTimeText(log: IntervalsLog): string {
  const start = log.startWorkTime ?? log.workTime
  const what = start !== log.workTime
    ? `${log.series} rounds, ${start} s → ${log.workTime} s`
    : `${log.series} × ${log.workTime} s`
  const falls = log.falls?.length ? log.falls : log.fellInRound != null ? [log.fellInRound] : []
  if (falls.length) return `Last time: ${what} — fell in round${falls.length > 1 ? "s" : ""} ${falls.join(", ")}.`
  if (log.pumped != null) return `Last time: ${what} — no fall, ${log.pumped ? "very pumped" : "not very pumped"} in the last two rounds.`
  if (log.veryEasy != null) return `Last time: ${what} — no fall, ${log.veryEasy ? "felt very easy" : "didn't feel very easy"}.`
  return `Last time: ${what} — no fall.`
}

// `kind` = the block about to run; unset → no suggestion (the coach hasn't
// said which rule applies). Null also when there's no usable history — e.g.
// sessions logged before falls/answers were recorded.
export function suggestNextIntervals(runs: BlockRun[], kind: IntervalsKind | undefined): IntervalsSuggestion | null {
  if (!kind || !runs[0]) return null
  const log = intervalsLog(runs[0].attempts[runs[0].attempts.length - 1])
  if (!log) return null
  const { workStep, minWork, maxWork } = INTERVALS_RULES
  const base = clampWork(log.workTime)
  const series = log.series
  const lastTime = lastTimeText(log)

  const up = (why: string): IntervalsSuggestion => {
    if (base < maxWork) {
      const next = clampWork(base + workStep)
      return { direction: "increase", workTime: next, series, lastTime, note: `${why} — next: ${next} s work.` }
    }
    return kind === "power_endurance"
      ? { direction: "increase", workTime: base, series: series + 1, lastTime,
          note: `${why} at ${maxWork} s — next: one more round (${series + 1} × ${maxWork} s).` }
      : { direction: "hold", workTime: base, series, lastTime,
          note: `${why} — already at ${maxWork} s, the longest work time; next: the same.` }
  }
  const down = (why: string, steps = 1): IntervalsSuggestion => base <= minWork
    ? { direction: "hold", workTime: base, series, lastTime,
        note: `${why} — already at ${minWork} s, the shortest work time; next: the same.` }
    : { direction: "decrease", workTime: clampWork(base - steps * workStep), series, lastTime,
        note: `${why} — next: ${clampWork(base - steps * workStep)} s work.` }
  const hold = (why: string): IntervalsSuggestion =>
    ({ direction: "hold", workTime: base, series, lastTime, note: `${why} — next: the same ${base} s.` })

  if (kind === "warmup") {
    const falls = log.falls?.length ?? (log.fellInRound != null ? 1 : 0)
    if (falls > 0) {
      // Cuts owed but not applied live (fall in the last round, older logs).
      const applied = Math.round(((log.startWorkTime ?? log.workTime) - log.workTime) / workStep)
      const owed = Math.max(0, falls - applied)
      return owed > 0
        ? down("A warm-up shouldn't end in a fall", owed)
        : hold("Work time was cut after the fall")
    }
    if (log.pumped === true) return down("Too pumped for a warm-up")
    if (log.pumped === false) return up("Not pumped")
    return null
  }

  if (log.fellInRound != null) {
    const limit = earlyFallLimit(series)
    return log.fellInRound <= limit
      ? down(`Fell in the first ${limit} of ${series} rounds — too much time on the wall`)
      : hold("Fell only near the end")
  }
  if (log.veryEasy === true) return up("No fall and it felt very easy")
  if (log.veryEasy === false) return hold("No fall, but not very easy")
  return null
}
