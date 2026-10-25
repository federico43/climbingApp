// Athlete-side plan progress: which plan workouts are done, which days were
// trained, how this week is going. Pure — feeds the Plan tab
// (docs/redesign.md §4, docs/training-plan.md §3 `workoutsession`).

import { addDays, localDateStr, planWeek } from "@/utils/planRotation"
import { pauseOn, type PlanPause } from "@/utils/planPauses"

export interface ProgressSession {
  $createdAt: string
  attempts: string
  protocol: string
  protocolId?: string | null
  planId?: string | null
  planIndex?: number | null
}

export interface ProgressWorkout {
  $id: string
  $createdAt: string
  blocks: string
  planIndex?: number | null
  planPart?: "sc" | "homework" | null
}

// The local day a session was trained: its first attempt, else when it was saved.
export function sessionLocalDate(s: Pick<ProgressSession, "$createdAt" | "attempts">): string {
  try {
    const attempts = JSON.parse(s.attempts)
    if (Array.isArray(attempts) && attempts[0]?.timestamp) return localDateStr(new Date(attempts[0].timestamp))
  } catch {}
  return localDateStr(new Date(s.$createdAt))
}

function blockIds(json: string): Set<string> {
  try {
    const blocks = JSON.parse(json)
    if (Array.isArray(blocks)) return new Set(blocks.map((b: any) => b?.id).filter(Boolean))
  } catch {}
  return new Set()
}

// planIndex → the day it was first done.
//
// A session saved since 2026-10-04 names its workout (protocolId → that
// workout's planIndex; a split-off S&C part doesn't count). Older sessions
// don't, so they're matched on block ids — a session keeps its workout's
// blocks (minus skipped ones), and built workouts get fresh ids — to the
// climbing workout it shares the most blocks with, built on or before it.
export function donePlanWorkouts(
  planId: string,
  workouts: ProgressWorkout[],
  sessions: ProgressSession[],
): Map<number, string> {
  const byId = new Map(workouts.map((w) => [w.$id, w]))
  const climbing = workouts
    .filter((w) => !w.planPart && w.planIndex)
    .map((w) => ({ w, ids: blockIds(w.blocks), built: localDateStr(new Date(w.$createdAt)) }))
  const done = new Map<number, string>()
  const record = (index: number, date: string) => {
    const prev = done.get(index)
    if (!prev || date < prev) done.set(index, date)
  }

  for (const s of sessions) {
    const date = sessionLocalDate(s)
    if (s.protocolId) {
      const w = byId.get(s.protocolId)
      if (w) {
        if (!w.planPart && w.planIndex) record(w.planIndex, date)
      } else if (s.planId === planId && s.planIndex) {
        record(s.planIndex, date) // workout since deleted — trust the session
      }
      continue
    }
    const ids = blockIds(s.protocol)
    if (ids.size === 0) continue
    let best: { index: number; overlap: number } | null = null
    for (const c of climbing) {
      if (c.built > date) continue
      let overlap = 0
      for (const id of ids) if (c.ids.has(id)) overlap++
      if (overlap > 0 && (!best || overlap > best.overlap)) best = { index: c.w.planIndex!, overlap }
    }
    if (best) record(best.index, date)
  }
  return done
}

// Every day of the plan, in order (42 for a 6-week plan).
export function planDays(windowStart: string, windowEnd: string): string[] {
  const days: string[] = []
  for (let d = windowStart; d <= windowEnd; d = addDays(d, 1)) days.push(d)
  return days
}

// Days inside the plan the athlete trained at all (any session).
export function trainedDaysIn(windowStart: string, windowEnd: string, sessions: ProgressSession[]): Set<string> {
  const days = new Set<string>()
  for (const s of sessions) {
    const d = sessionLocalDate(s)
    if (d >= windowStart && d <= windowEnd) days.add(d)
  }
  return days
}

// Plan workouts done in the plan week `today` falls in.
export function doneThisWeek(windowStart: string, done: Map<number, string>, today: string, pauses?: PlanPause[]): number {
  const week = planWeek(windowStart, today, pauses)
  let n = 0
  for (const date of done.values()) if (planWeek(windowStart, date, pauses) === week) n++
  return n
}

// Training days from today to the plan's end, today included (0 once it's
// over). Paused days don't count.
export function daysLeft(windowStart: string, windowEnd: string, today: string, pauses?: PlanPause[]): number {
  const from = today < windowStart ? windowStart : today
  if (from > windowEnd) return 0
  return planDays(from, windowEnd).filter((d) => !pauseOn(pauses, d)).length
}
