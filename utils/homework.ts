// Homework (docs/training-plan-implementation.md §8–10): a workout the coach
// split off a block (or blocks) into, for the athlete to do on a day of their
// choosing before a deadline. Stored as a protocol row with planPart
// "homework". Pure — no React, no Appwrite.

import { addDays, localDateStr } from "@/utils/planRotation"
import { sessionLocalDate, type ProgressSession } from "@/utils/planProgress"

// Days the athlete gets by default (coach 2026-10-07); the coach can change it.
export const HOMEWORK_DAYS = 5

export interface HomeworkRow {
  $id: string
  $createdAt: string
  name: string
  dueBy?: string | null          // "YYYY-MM-DD", last day it can be done
  scheduledFor?: string | null   // ISO date-time the athlete picked
  homeworkStatus?: "cant_attend" | null
  homeworkNote?: string | null   // the athlete's "can't attend" message
}

export type HomeworkState = "not_scheduled" | "scheduled" | "missed" | "cant_attend" | "overdue" | "done"

export interface HomeworkStatus {
  state: HomeworkState
  date?: string // done: the day it was done; scheduled / missed: the day picked
}

export const HOMEWORK_STATE_LABEL: Record<HomeworkState, string> = {
  not_scheduled: "Not scheduled",
  scheduled: "Scheduled",
  missed: "Missed",
  cant_attend: "Can't attend",
  overdue: "Overdue",
  done: "Done",
}

// The default deadline for homework assigned on `today`.
export function defaultDueBy(today: string): string {
  return addDays(today, HOMEWORK_DAYS)
}

// The homework's deadline; rows saved without one get the default from the
// day they were made.
export function dueByOf(hw: Pick<HomeworkRow, "$createdAt" | "dueBy">): string {
  return hw.dueBy || defaultDueBy(localDateStr(new Date(hw.$createdAt)))
}

// Where a homework stands, as of `today` ("YYYY-MM-DD", local):
//   done          a session was started from it (protocolId)
//   cant_attend   the athlete said they can't make it — and hasn't moved it
//   overdue       the deadline passed
//   missed        the picked day passed, but there are days left to move it
//   scheduled     a day is picked, today or later
//   not_scheduled no day picked yet
export function homeworkStatus(hw: HomeworkRow, sessions: ProgressSession[], today: string): HomeworkStatus {
  let doneOn: string | null = null
  for (const s of sessions) {
    if (s.protocolId !== hw.$id) continue
    const d = sessionLocalDate(s)
    if (!doneOn || d < doneOn) doneOn = d
  }
  if (doneOn) return { state: "done", date: doneOn }
  if (hw.homeworkStatus === "cant_attend") return { state: "cant_attend" }
  if (today > dueByOf(hw)) return { state: "overdue" }
  if (hw.scheduledFor) {
    const day = localDateStr(new Date(hw.scheduledFor))
    return { state: day < today ? "missed" : "scheduled", date: day }
  }
  return { state: "not_scheduled" }
}

// "Sun 12 Oct" for a "YYYY-MM-DD".
export function shortDay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  const date = new Date(y, m - 1, d)
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${DAYS[date.getDay()]} ${d} ${MONTHS[m - 1]}`
}

// The name a homework workout gets: its block's name when it's just one,
// else the workout's name + " · Homework".
export function homeworkName(workoutName: string, blocks: { blockName?: string }[]): string {
  const only = blocks.length === 1 ? blocks[0].blockName?.trim() : ""
  return only || `${workoutName.trim()} · Homework`
}

// "6:05 PM", local time.
export function timeLabel(d: Date): string {
  const h = d.getHours()
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`
}

// A local Date for "YYYY-MM-DD" at hh:mm.
export function atLocal(dateStr: string, hours: number, minutes = 0): Date {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(y, m - 1, d, hours, minutes)
}

// Days still open to do it in: today…dueBy (empty once the deadline's passed).
export function daysToPick(today: string, dueBy: string): string[] {
  const out: string[] = []
  for (let d = today; d <= dueBy && out.length < 60; d = addDays(d, 1)) out.push(d)
  return out
}

export interface HomeworkReminder {
  homeworkId: string
  kind: "day_before" | "hour_before" | "missed" | "pick_day"
  at: Date
  title: string
  body: string
  withActions: boolean // "I can't attend" / "Reschedule" buttons
}

export const PICK_DAY_AFTER = 2   // days without a day picked → "pick a day"
export const NUDGE_HOUR = 9       // the morning after a missed day
export const PICK_DAY_HOUR = 10

// The local reminders a homework should have right now (only future ones):
//   scheduled      the day before at the same time, and 1 hour before
//   scheduled/missed  the morning after the day, in case it didn't happen
//   not scheduled  "pick a day" PICK_DAY_AFTER days after it was given
// None once it's done, can't-attend or overdue.
export function homeworkReminders(hw: HomeworkRow, sessions: ProgressSession[], now: Date): HomeworkReminder[] {
  const today = localDateStr(now)
  const status = homeworkStatus(hw, sessions, today)
  const due = dueByOf(hw)
  const out: HomeworkReminder[] = []
  const add = (r: Omit<HomeworkReminder, "homeworkId">) => { if (r.at > now) out.push({ homeworkId: hw.$id, ...r }) }

  if ((status.state === "scheduled" || status.state === "missed") && hw.scheduledFor) {
    const when = new Date(hw.scheduledFor)
    add({ kind: "day_before", at: new Date(when.getTime() - 24 * 3600_000), withActions: true,
      title: "Homework tomorrow", body: `${hw.name} — tomorrow at ${timeLabel(when)}` })
    add({ kind: "hour_before", at: new Date(when.getTime() - 3600_000), withActions: true,
      title: "Homework in 1 hour", body: `${hw.name} at ${timeLabel(when)}` })
    const nextDay = addDays(localDateStr(when), 1)
    add({ kind: "missed", at: atLocal(nextDay, NUDGE_HOUR), withActions: nextDay <= due,
      title: "Missed your homework?",
      body: nextDay <= due
        ? `${hw.name} — pick another day before ${shortDay(due)}`
        : `${hw.name} is overdue — let your coach know` })
  } else if (status.state === "not_scheduled") {
    const day = addDays(localDateStr(new Date(hw.$createdAt)), PICK_DAY_AFTER)
    if (day <= due) {
      add({ kind: "pick_day", at: atLocal(day, PICK_DAY_HOUR), withActions: false,
        title: "Pick a day for your homework", body: `${hw.name} — due ${shortDay(due)}` })
    }
  }
  return out
}
