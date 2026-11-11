// The end-of-block review of a strength & conditioning circuit, as slides:
// each exercise's working sets today next to the last time it was done at
// the same focus — "you improved here", "this stayed the same". Pure, so
// StrengthConditioningBlock.tsx (and tests) only feed it data.
//
// What counts, in order (the first difference decides):
//   1. Load — a harder level on the ladder, more weight, or reaching the
//      hardest setting. Fewer reps at a heavier load is still progress.
//   2. Reps (or seconds) per set, at the same load.
//   3. Effort (average RPE) at the same load and reps — easier is better.
// Today's and last time's sets are the ones at the load each session ended
// on (setsAtFinalLoad), the same sets the progression rule reads.

import type { ScSetsSummary } from "@/utils/scHistory"
import type { FocusEntry } from "@/utils/scNext"
import type { Focus } from "@/utils/scProgression"

export type Trend = "up" | "same" | "down"
export type Verdict = "improved" | "same" | "declined" | "first"

export interface ReviewMetric {
  label: string      // "Weight", "Level", "Reps per set", "Effort"
  before?: string    // last time (absent on a first time)
  after: string      // today
  trend?: Trend      // absent = shown, not judged (first time)
}

export interface ExerciseReview {
  key: string        // stable per exercise in the block (index + id)
  name: string       // what was done today (a level's name)
  exerciseId?: string
  focus?: Focus
  verdict: Verdict
  headline: string
  lastDate?: string  // ISO, the session compared against
  metrics: ReviewMetric[]
}

export interface ReviewInput {
  key: string
  name: string
  focus?: Focus
  today: ScSetsSummary
  // Every past session on this exercise, any focus, newest first.
  past?: FocusEntry[]
  // The exercise's ladder, easiest → hardest (level mode), to rank levels
  // and name them.
  ladder?: { exerciseId: string; name: string }[]
  amountUnit?: "reps" | "seconds"
  weightUnit: string
}

// The last session at today's focus — a max force set says nothing about a
// hypertrophy one.
export function lastAtFocus(past: FocusEntry[] | undefined, focus: Focus | undefined): FocusEntry | undefined {
  return (past ?? []).find((p) => p.focus === focus)
}

const avg = (ns: number[]) => (ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : undefined)
const round1 = (n: number) => Math.round(n * 10) / 10
const cmp = (a: number, b: number, tolerance = 0): Trend => (a > b + tolerance ? "up" : a < b - tolerance ? "down" : "same")
const fmt = (n: number) => String(round1(n))

function amounts(s: ScSetsSummary) { return s.sets.map((x) => x.amount) }
function rpes(s: ScSetsSummary) { return s.sets.map((x) => x.rpe).filter((r): r is number => r != null) }

// RPE has to move by at least this (on average) to count as easier/harder.
const RPE_TOLERANCE = 0.5

export function reviewExercise(input: ReviewInput): ExerciseReview | null {
  const { today } = input
  if (today.sets.length === 0) return null
  const last = lastAtFocus(input.past, input.focus)
  const ladder = input.ladder ?? []
  const levelIdx = (id?: string) => (id ? ladder.findIndex((l) => l.exerciseId === id) : -1)
  const levelName = (id: string | undefined, fallback: string) => (id ? ladder.find((l) => l.exerciseId === id)?.name : undefined) ?? fallback
  const amountLabel = input.amountUnit === "seconds" ? "Seconds per set" : "Reps per set"
  const setsText = (s: ScSetsSummary) => amounts(s).join(" · ")
  const base = { key: input.key, name: input.name, exerciseId: today.exerciseId, ...(input.focus ? { focus: input.focus } : {}) }

  const metrics: ReviewMetric[] = []
  const todayRpe = avg(rpes(today))

  if (!last) {
    if (today.exerciseId && levelIdx(today.exerciseId) >= 0) metrics.push({ label: "Level", after: levelName(today.exerciseId, input.name) })
    if (today.weight != null) metrics.push({ label: "Weight", after: `${fmt(today.weight)} ${input.weightUnit}` })
    metrics.push({ label: amountLabel, after: setsText(today) })
    if (todayRpe != null) metrics.push({ label: "Effort", after: `RPE ${fmt(todayRpe)}` })
    return { ...base, verdict: "first", headline: "First time at this focus — today is your baseline", metrics }
  }

  const prev = last.summary
  // 1. Load
  let load: Trend = "same"
  const ti = levelIdx(today.exerciseId), pi = levelIdx(prev.exerciseId)
  if (ti >= 0 && pi >= 0 && ti !== pi) {
    load = cmp(ti, pi)
    metrics.push({ label: "Level", before: levelName(prev.exerciseId, last.exerciseName ?? ""), after: levelName(today.exerciseId, input.name), trend: load })
  } else if (ti >= 0) {
    metrics.push({ label: "Level", before: levelName(prev.exerciseId, last.exerciseName ?? input.name), after: levelName(today.exerciseId, input.name), trend: "same" })
  }
  if (today.weight != null || prev.weight != null) {
    const w = today.weight != null && prev.weight != null ? cmp(today.weight, prev.weight) : "same"
    if (load === "same") load = w
    metrics.push({
      label: "Weight",
      ...(prev.weight != null ? { before: `${fmt(prev.weight)} ${input.weightUnit}` } : {}),
      after: today.weight != null ? `${fmt(today.weight)} ${input.weightUnit}` : "—",
      trend: w,
    })
  }
  if (load === "same" && !!today.atHardest !== !!prev.atHardest) {
    load = today.atHardest ? "up" : "down"
    metrics.push({ label: "Setting", before: prev.atHardest ? "Hardest" : "Easier", after: today.atHardest ? "Hardest" : "Easier", trend: load })
  }

  // 2. Reps / seconds per set
  const ta = avg(amounts(today))!, pa = avg(amounts(prev))
  const volume: Trend = pa != null ? cmp(ta, pa) : "same"
  metrics.push({ label: amountLabel, before: setsText(prev), after: setsText(today), trend: volume })

  // 3. Effort (lower RPE = easier = better)
  const prevRpe = avg(rpes(prev))
  let effort: Trend = "same"
  if (todayRpe != null && prevRpe != null) {
    effort = cmp(prevRpe, todayRpe, RPE_TOLERANCE)
    metrics.push({ label: "Effort", before: `RPE ${fmt(prevRpe)}`, after: `RPE ${fmt(todayRpe)}`, trend: effort })
  }

  const decisive: Trend = load !== "same" ? load : volume !== "same" ? volume : effort
  const verdict: Verdict = decisive === "up" ? "improved" : decisive === "down" ? "declined" : "same"
  const headline = verdict === "improved"
    ? load === "up" ? "You moved up the load" : volume === "up" ? `More ${input.amountUnit === "seconds" ? "time" : "reps"} at the same load` : "Same work, felt easier"
    : verdict === "declined"
      ? load === "down" ? "Lighter load than last time" : volume === "down" ? `Fewer ${input.amountUnit === "seconds" ? "seconds" : "reps"} than last time` : "Same work, felt harder"
      : "Same as last time"
  return { ...base, verdict, headline, lastDate: last.date, metrics }
}

export interface ReviewTally { improved: number; same: number; declined: number; first: number }

export function tally(reviews: ExerciseReview[]): ReviewTally {
  const t: ReviewTally = { improved: 0, same: 0, declined: 0, first: 0 }
  for (const r of reviews) t[r.verdict]++
  return t
}

// The overview slide's line, e.g. "You improved on 2 of 3 exercises".
export function overviewLine(t: ReviewTally): string {
  const compared = t.improved + t.same + t.declined
  if (compared === 0) return t.first ? "Baseline set — next time you'll see how you progress" : ""
  if (t.improved === compared) return compared === 1 ? "You improved on your exercise" : `You improved on all ${compared} exercises`
  if (t.improved > 0) return `You improved on ${t.improved} of ${compared} exercises`
  return "No progress this time — let's see why"
}

// ─── The athlete's answers on an exercise that didn't improve ────────────────

export type FormAnswer = "good" | "unsure" | "off"

export interface ReviewAnswers {
  form?: FormAnswer
  tired?: boolean
  improve?: string   // what they could do better, in their words
}

// Questions are asked on exercises that stayed the same or went down.
export function asksQuestions(r: ExerciseReview): boolean {
  return r.verdict === "same" || r.verdict === "declined"
}

// What gets logged on the session (an attempt's `scReview`) — one per
// reviewed exercise, answers only where asked and given.
export interface ScReviewLog {
  exerciseId?: string
  exerciseName: string
  focus?: Focus
  verdict: Verdict
  form?: FormAnswer
  tired?: boolean
  improve?: string
}

export function reviewLog(r: ExerciseReview, a: ReviewAnswers | undefined): ScReviewLog {
  const improve = a?.improve?.trim()
  return {
    ...(r.exerciseId ? { exerciseId: r.exerciseId } : {}),
    exerciseName: r.name,
    ...(r.focus ? { focus: r.focus } : {}),
    verdict: r.verdict,
    ...(asksQuestions(r) && a?.form ? { form: a.form } : {}),
    ...(asksQuestions(r) && a?.tired != null ? { tired: a.tired } : {}),
    ...(asksQuestions(r) && improve ? { improve } : {}),
  }
}

export const FORM_LABEL: Record<FormAnswer, string> = { good: "Good form", unsure: "Not sure", off: "Form was off" }

// One line for the coach (session detail), e.g.
// "Same as last time · Good form · Tired · “Slower on the way down”".
export function reviewLogLine(l: ScReviewLog): string {
  const verdict = { improved: "Improved", same: "Same as last time", declined: "Below last time", first: "First time" }[l.verdict]
  return [
    verdict,
    l.form ? FORM_LABEL[l.form] : "",
    l.tired != null ? (l.tired ? "Tired" : "Not tired") : "",
    l.improve ? `“${l.improve}”` : "",
  ].filter(Boolean).join(" · ")
}
