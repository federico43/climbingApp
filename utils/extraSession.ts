// Extra solo session (coach 2026-11-11): conditioning works faster when it's
// spread over the week, not just tied to the gym days. An athlete who trains
// Tue + Thu at the gym gets a short S&C session on their own on Sat or Sun —
// the middle of the longest gap, with a rest day either side. The coach sends
// it in one tap; it goes out as homework (same card, day picker, reminders),
// never as a workout on the athlete's Home, and it doesn't count towards the
// plan's 12 workouts. Pure — no React, no Appwrite.

import { parseSlot, WEEK_DAYS } from "@/utils/classSchedule"
import { homeworkStatus, type HomeworkRow } from "@/utils/homework"
import { sessionLocalDate, type ProgressSession } from "@/utils/planProgress"
import {
  addDays, workoutSpec, WORKOUTS_PER_WEEK,
  type BuiltPlanWorkout, type PlanShape, type WorkoutSpec,
} from "@/utils/planRotation"

// Weekday numbers as in classSchedule: 0 = Mon … 6 = Sun.
export type Weekday = number

// Up to this many gym days a week, an extra session is worth suggesting;
// from 3 on, the week is already spread.
export const EXTRA_MAX_TRAINING_DAYS = WORKOUTS_PER_WEEK
// Fallback when the athlete has no default classes: weekdays they trained
// on at least this often in the last SESSION_LOOKBACK_DAYS.
export const SESSION_LOOKBACK_DAYS = 28
export const SESSION_DAY_MIN = 2
// At most this many days offered ("Sat or Sun").
export const EXTRA_WINDOW_MAX = 2

const weekdayOfDate = (dateStr: string): Weekday => {
  const [y, m, d] = dateStr.split("-").map(Number)
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

// The athlete's gym days: their default classes ("day@start" slots), else
// the weekdays they've been training on lately. Sorted, no repeats.
export function trainingDays(
  defaultClasses: string[] | null | undefined,
  sessions: ProgressSession[],
  today: string,
): Weekday[] {
  const fromClasses = new Set<Weekday>()
  for (const slot of defaultClasses ?? []) {
    const p = parseSlot(slot)
    if (p) fromClasses.add(p.day)
  }
  if (fromClasses.size > 0) return [...fromClasses].sort((a, b) => a - b)

  const since = addDays(today, -SESSION_LOOKBACK_DAYS)
  const datesByDay = new Map<Weekday, Set<string>>()
  for (const s of sessions) {
    const date = sessionLocalDate(s)
    if (date < since || date > today) continue
    const wd = weekdayOfDate(date)
    if (!datesByDay.has(wd)) datesByDay.set(wd, new Set())
    datesByDay.get(wd)!.add(date)
  }
  return [...datesByDay.entries()]
    .filter(([, dates]) => dates.size >= SESSION_DAY_MIN)
    .map(([wd]) => wd)
    .sort((a, b) => a - b)
}

// Days apart in the weekly cycle (Sun → Tue = 2).
const cyclicDistance = (a: Weekday, b: Weekday) => {
  const d = Math.abs(a - b) % 7
  return Math.min(d, 7 - d)
}

// The best weekdays for the extra session: inside the longest gap between
// gym days, never next to one (a rest day either side), and the middle
// EXTRA_WINDOW_MAX of those. [] when there are no gym days, too many, or no
// day leaves a rest day either side (Mon / Wed / Fri).
export function extraSessionDays(days: Weekday[]): Weekday[] {
  const gym = [...new Set(days)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b)
  if (gym.length === 0 || gym.length > EXTRA_MAX_TRAINING_DAYS) return []
  let best: Weekday[] = []
  for (let i = 0; i < gym.length; i++) {
    const from = gym[i]
    const to = gym[(i + 1) % gym.length]
    const gapLen = ((to - from + 7) % 7) || 7 // one gym day: the whole week
    const ok: Weekday[] = []
    for (let k = 1; k < gapLen; k++) {
      const d = (from + k) % 7
      if (gym.every((g) => cyclicDistance(g, d) >= 2)) ok.push(d)
    }
    if (ok.length > best.length) best = ok
  }
  if (best.length <= EXTRA_WINDOW_MAX) return best
  // The middle of the gap, furthest from both gym days; when it can't be
  // exactly centred, the earlier pair (sooner after the last gym day).
  const start = Math.floor((best.length - EXTRA_WINDOW_MAX) / 2)
  return best.slice(start, start + EXTRA_WINDOW_MAX)
}

// "Sat or Sun", "Sat", "Fri, Sat or Sun".
export function weekdaysLabel(days: Weekday[]): string {
  const names = days.map((d) => WEEK_DAYS[d])
  if (names.length <= 1) return names[0] ?? ""
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`
}

// "Tue & Thu".
export function gymDaysLabel(days: Weekday[]): string {
  const names = days.map((d) => WEEK_DAYS[d])
  if (names.length <= 1) return names[0] ?? ""
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`
}

export interface ExtraWindow {
  from: string // "YYYY-MM-DD"
  to: string   // the last suggested day — the homework's deadline
}

// The next run of suggested days, from today on (today included).
export function nextExtraWindow(today: string, days: Weekday[]): ExtraWindow | null {
  if (days.length === 0) return null
  const set = new Set(days)
  let from: string | null = null
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i)
    if (set.has(weekdayOfDate(d))) { from = d; break }
  }
  if (!from) return null
  let to = from
  while (set.has(weekdayOfDate(addDays(to, 1))) && to < addDays(from, 6)) to = addDays(to, 1)
  return { from, to }
}

// ─── The homework row ─────────────────────────────────────────────────────────

// The note each of the extra session's blocks carries (like leftAsHomework),
// so the cards can tell it apart without a column of its own.
export interface ExtraSessionNote {
  from: string        // first suggested day
  to: string          // last suggested day (= dueBy)
  days: Weekday[]     // the suggested weekdays
  gymDays: Weekday[]  // the gym days it was worked out from
}

export const EXTRA_SESSION_NAME = "Extra session"

// The note when this homework is an extra session, else null.
export function extraSessionOf(hw: { blocks?: string | null }): ExtraSessionNote | null {
  try {
    const blocks = JSON.parse(hw.blocks ?? "[]")
    if (!Array.isArray(blocks)) return null
    for (const b of blocks) if (b?.extraSession?.to) return b.extraSession as ExtraSessionNote
  } catch { /* not JSON */ }
  return null
}

// The extra session still open (not done, deadline not passed), if any — the
// coach's card shows it instead of offering another.
export function pendingExtraSession<H extends HomeworkRow & { blocks?: string | null }>(
  homework: H[],
  sessions: ProgressSession[],
  today: string,
): H | null {
  for (const hw of homework) {
    if (!extraSessionOf(hw)) continue
    const st = homeworkStatus(hw, sessions, today).state
    if (st !== "done" && st !== "overdue") return hw
  }
  return null
}

// What the extra session trains: the S&C of the plan's latest built workout
// (the same focus, so it adds frequency to what the athlete is working on),
// with the pattern's other exercise for variety. S&C only — no warm-up,
// climbing block or test, on any kind of plan. Before any workout is built,
// workout 1's.
export function extraSessionSpec(plan: PlanShape, built: BuiltPlanWorkout[], today: string): WorkoutSpec | null {
  if (!plan.hasSc) return null
  const latest = built.reduce((max, w) => Math.max(max, w.planIndex), 0) || 1
  const sOnly: PlanShape = { ...plan, kind: "conditioning" }
  const spec = workoutSpec(sOnly, latest, built, today)
  return { ...spec, exerciseSlot: spec.exerciseSlot === 0 ? 1 : 0 }
}

// Tags the S&C blocks as the extra session's, done alone (never coached).
export function extraSessionBlocks<B extends object>(blocks: B[], note: ExtraSessionNote): B[] {
  return blocks.map((b) => ({ ...b, coached: undefined, extraSession: note }))
}

// The first suggested day still open to pick, for the day picker.
export function preferredDay(note: ExtraSessionNote | null, open: string[]): string | undefined {
  if (!note) return undefined
  return open.find((d) => d >= note.from && d <= note.to)
}
