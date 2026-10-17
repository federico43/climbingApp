// The weekly scheduler (docs/training-plan.md §11): a date for every plan
// workout not done yet, from the athlete's training days. Computed, never
// stored — only the days the athlete moves by hand are saved
// (training_plans.scheduleOverrides). Pure: the plan's dates, what's done,
// the overrides, the homework days and today in, 12 slots out.

import { addDays, localDateStr, PLAN_WORKOUTS, planWeek, WORKOUTS_PER_WEEK } from "@/utils/planRotation"

// One plan workout a day, the plan's pace a week, and a rest day between two
// plan workouts.
export const MAX_PER_DAY = 1
export const MAX_PER_WEEK = WORKOUTS_PER_WEEK
export const MIN_REST_DAYS = 1

// Reminders only for workouts this close, so 12 never pile up.
export const REMINDER_DAYS = 7
export const REMINDER_HOUR = 9 // the morning of, when there's no training time

export interface ScheduleInput {
  windowStart: string               // "YYYY-MM-DD"
  windowEnd: string
  trainingDays: number[] | null     // 0 = Sunday; null / empty = the default days
  trainingTime: string | null       // "18:00", or null
  done: Map<number, string>         // slot → day done (donePlanWorkouts)
  overrides: Record<number, string> // slot → day the athlete picked
  busyDays: Set<string>             // days with homework scheduled
  today: string
  now?: Date                        // only to know whether today's training time has passed
}

//   done       a session was started from it, on `date`
//   scheduled  placed by the rule
//   moved      on the day the athlete picked
//   unfit      no room left before the plan's end
export type ScheduleState = "done" | "scheduled" | "moved" | "unfit"

export interface ScheduledSlot {
  index: number
  date: string | null
  state: ScheduleState
}

function weekday(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

function dayNumber(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86400000)
}

// "18:30" → [18, 30]; null for anything else.
export function parseTrainingTime(time: string | null | undefined): [number, number] | null {
  const m = typeof time === "string" ? /^(\d{1,2}):(\d{2})$/.exec(time.trim()) : null
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h < 24 && min < 60 ? [h, min] : null
}

// Days 1 and 4 of each plan week (a plan starting Monday → Monday, Thursday).
export function defaultTrainingDays(windowStart: string): number[] {
  const first = weekday(windowStart)
  return [first, (first + 3) % 7].sort((a, b) => a - b)
}

export function trainingDaysOf(input: Pick<ScheduleInput, "windowStart" | "trainingDays">): number[] {
  const days = (input.trainingDays ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  return days.length ? [...new Set(days)].sort((a, b) => a - b) : defaultTrainingDays(input.windowStart)
}

// First day anything can still be scheduled: today (unless today's training
// time has passed), never before the plan starts.
export function firstOpenDay(input: Pick<ScheduleInput, "windowStart" | "trainingTime" | "today" | "now">): string {
  let day = input.today
  const time = parseTrainingTime(input.trainingTime)
  if (time && input.now && localDateStr(input.now) === input.today) {
    const minutes = input.now.getHours() * 60 + input.now.getMinutes()
    if (minutes >= time[0] * 60 + time[1]) day = addDays(day, 1)
  }
  return day < input.windowStart ? input.windowStart : day
}

// Day sets the rules check against while placing one slot.
interface Taken {
  days: Map<string, number>  // day → plan workouts on it
  weeks: Map<number, number> // plan week → plan workouts in it
}

function take(t: Taken, windowStart: string, day: string) {
  t.days.set(day, (t.days.get(day) ?? 0) + 1)
  const w = planWeek(windowStart, day)
  t.weeks.set(w, (t.weeks.get(w) ?? 0) + 1)
}

function cloneTaken(t: Taken): Taken {
  return { days: new Map(t.days), weeks: new Map(t.weeks) }
}

export type MoveProblem = "done" | "past" | "outside" | "busy" | "order" | "rest" | "week_full"

export const MOVE_PROBLEM_LABEL: Record<MoveProblem, string> = {
  done: "This workout is already done",
  past: "That day has passed",
  outside: "That day is outside the plan",
  busy: "There's homework that day",
  order: "It can't go before the workout before it",
  rest: "Leave a rest day between two plan workouts",
  week_full: `That plan week already has ${MAX_PER_WEEK} workouts`,
}

// Why `day` can't take one more plan workout, or null if it can.
function dayProblem(input: ScheduleInput, t: Taken, day: string): MoveProblem | null {
  if (input.busyDays.has(day)) return "busy"
  if ((t.days.get(day) ?? 0) >= MAX_PER_DAY) return "rest"
  for (let k = 1; k <= MIN_REST_DAYS; k++) {
    if (t.days.has(addDays(day, k)) || t.days.has(addDays(day, -k))) return "rest"
  }
  if ((t.weeks.get(planWeek(input.windowStart, day)) ?? 0) >= MAX_PER_WEEK) return "week_full"
  return null
}

// Every plan slot with its day:
//   1. done slots stay on the day they were done;
//   2. the rest go in order 1 → 12, each after the one before it;
//   3. a day the athlete picked wins, if it still keeps the rules;
//   4. otherwise the first training day that keeps them: not a homework day,
//      a rest day either side of every other plan workout, at most
//      MAX_PER_WEEK in the plan week;
//   5. nothing left before the plan's end → unfit.
// Picked days still ahead are held for their slot while earlier slots are
// placed, so placing one never steals another's day.
export function schedulePlan(input: ScheduleInput): ScheduledSlot[] {
  const days = new Set(trainingDaysOf(input))
  const open = firstOpenDay(input)
  const taken: Taken = { days: new Map(), weeks: new Map() }
  for (const day of input.done.values()) take(taken, input.windowStart, day)

  // Picked days a slot can still use (not done, not passed, inside the plan).
  const picked = new Map<number, string>()
  for (const [k, day] of Object.entries(input.overrides ?? {})) {
    const index = Number(k)
    if (!input.done.has(index) && day >= open && day <= input.windowEnd) picked.set(index, day)
  }

  const out: ScheduledSlot[] = []
  let after = "" // the last placed slot's day; the next goes after it
  for (let index = 1; index <= PLAN_WORKOUTS; index++) {
    const doneOn = input.done.get(index)
    if (doneOn) {
      out.push({ index, date: doneOn, state: "done" })
      continue
    }
    const earliest = after && addDays(after, 1) > open ? addDays(after, 1) : open

    // Rules checked with the later slots' picked days held.
    const held = cloneTaken(taken)
    for (const [j, day] of picked) if (j > index) take(held, input.windowStart, day)

    const own = picked.get(index)
    let date: string | null = null
    let state: ScheduleState = "unfit"
    if (own && own >= earliest && !dayProblem(input, held, own)) {
      date = own
      state = "moved"
    } else {
      for (let d = earliest; d <= input.windowEnd; d = addDays(d, 1)) {
        if (days.has(weekday(d)) && !dayProblem(input, held, d)) {
          date = d
          state = "scheduled"
          break
        }
      }
    }
    // A later slot whose picked day now comes too early falls back to the rule.
    if (date) {
      take(taken, input.windowStart, date)
      after = date
    }
    out.push({ index, date, state })
  }
  return out
}

// Whether slot `index` can be moved to `day`: true, or the first problem.
export function canMoveSlot(input: ScheduleInput, index: number, day: string): true | MoveProblem {
  if (input.done.has(index)) return "done"
  if (day < input.windowStart || day > input.windowEnd) return "outside"
  if (day < firstOpenDay(input)) return "past"
  const moved = schedulePlan({ ...input, overrides: { ...input.overrides, [index]: day } })
  const slot = moved.find((s) => s.index === index)
  if (slot?.state === "moved" && slot.date === day) return true

  // Explain it: the same checks schedulePlan made, against the slots before
  // it as they stand without this move.
  if (input.busyDays.has(day)) return "busy"
  const { [index]: _, ...others } = input.overrides
  const before = schedulePlan({ ...input, overrides: others }).filter((s) => s.index < index && s.date && s.state !== "done")
  const last = before.length ? before[before.length - 1].date! : ""
  if (last && day <= last) return "order"
  const taken: Taken = { days: new Map(), weeks: new Map() }
  for (const d of input.done.values()) take(taken, input.windowStart, d)
  for (const s of before) take(taken, input.windowStart, s.date!)
  return dayProblem(input, taken, day) ?? "rest"
}

// Days open to move slot `index` to, from today to the plan's end.
export function daysToMove(input: ScheduleInput, index: number): string[] {
  const out: string[] = []
  for (let d = firstOpenDay(input); d <= input.windowEnd; d = addDays(d, 1)) {
    if (canMoveSlot(input, index, d) === true) out.push(d)
  }
  return out
}

// ─── From the rows ───────────────────────────────────────────────────────────

// The parts of a training plan the scheduler reads (TrainingPlanRow has them all).
export interface SchedulePlan {
  windowStart: string
  windowEnd: string
  trainingDays: number[] | null
  trainingTime: string | null
  scheduleOverrides: Record<number, string>
}

export interface ScheduleHomework {
  $id: string
  scheduledFor?: string | null
  homeworkStatus?: "cant_attend" | null
}

// Days with homework still to do on them: picked, not "can't attend", no
// session started from it yet.
export function homeworkBusyDays(homework: ScheduleHomework[], sessions: { protocolId?: string | null }[]): Set<string> {
  return new Set(
    homework
      .filter((hw) => hw.scheduledFor && hw.homeworkStatus !== "cant_attend" && !sessions.some((s) => s.protocolId === hw.$id))
      .map((hw) => localDateStr(new Date(hw.scheduledFor!))),
  )
}

// The plan's schedule as of `now`, from its row, what's done
// (donePlanWorkouts) and the athlete's homework — what the Plan page and the
// coach's cards show.
export function scheduleFor(
  plan: SchedulePlan,
  done: Map<number, string>,
  homework: ScheduleHomework[],
  sessions: { protocolId?: string | null }[],
  now: Date,
): ScheduledSlot[] {
  return schedulePlan(scheduleInputFor(plan, done, homework, sessions, now))
}

export function scheduleInputFor(
  plan: SchedulePlan,
  done: Map<number, string>,
  homework: ScheduleHomework[],
  sessions: { protocolId?: string | null }[],
  now: Date,
): ScheduleInput {
  return {
    windowStart: plan.windowStart,
    windowEnd: plan.windowEnd,
    trainingDays: plan.trainingDays,
    trainingTime: plan.trainingTime,
    done,
    overrides: plan.scheduleOverrides ?? {},
    busyDays: homeworkBusyDays(homework, sessions),
    today: localDateStr(now),
    now,
  }
}

// ─── Reminders ───────────────────────────────────────────────────────────────

export interface PlanReminder {
  index: number
  at: Date
  title: string
  body: string
}

// A local Date for "YYYY-MM-DD" at hh:mm.
function atLocal(dateStr: string, hours: number, minutes = 0): Date {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(y, m - 1, d, hours, minutes)
}

// One reminder per upcoming workout in the next REMINDER_DAYS days: 1 hour
// before the training time, else REMINDER_HOUR that morning. Only future ones.
export function planReminders(
  slots: ScheduledSlot[],
  trainingTime: string | null,
  now: Date,
  labels: Record<number, string> = {},
): PlanReminder[] {
  const today = localDateStr(now)
  const time = parseTrainingTime(trainingTime)
  const out: PlanReminder[] = []
  for (const s of slots) {
    if (!s.date || (s.state !== "scheduled" && s.state !== "moved")) continue
    if (dayNumber(s.date) - dayNumber(today) >= REMINDER_DAYS) continue
    const at = time
      ? new Date(atLocal(s.date, time[0], time[1]).getTime() - 3600_000)
      : atLocal(s.date, REMINDER_HOUR)
    if (at <= now) continue
    const what = labels[s.index] ?? `Workout ${s.index}`
    out.push({
      index: s.index,
      at,
      title: time ? "Training in 1 hour" : "Training today",
      body: time ? `${what} at ${trainingTime}` : what,
    })
  }
  return out
}
