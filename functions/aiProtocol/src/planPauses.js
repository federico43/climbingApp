// Training plan pauses for the server, kept in step with utils/planPauses.ts
// (the app checks the same rules before it asks). No Appwrite code here.

import { addDays } from "./classRules.js"

export const PLAN_DAYS = 42 // 6 weeks of training
export const MAX_PAUSE_WEEKS = 4

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const dayNumber = (ymd) => {
  const [y, m, d] = ymd.split("-").map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86400000)
}

// The column holds a JSON array; anything malformed is dropped. Sorted by start.
export function parsePauses(raw) {
  let list = raw
  if (typeof raw === "string") {
    try { list = JSON.parse(raw) } catch { return [] }
  }
  if (!Array.isArray(list)) return []
  return list
    .filter((p) => DAY_RE.test(p?.start ?? "") && DAY_RE.test(p?.end ?? "") && p.end >= p.start)
    .map((p) => ({ start: p.start, end: p.end, ...(typeof p.reason === "string" && p.reason.trim() ? { reason: p.reason.trim().slice(0, 60) } : {}) }))
    .sort((a, b) => (a.start < b.start ? -1 : 1))
}

export const pauseLength = (p) => dayNumber(p.end) - dayNumber(p.start) + 1
export const pausedDayCount = (pauses) => pauses.reduce((n, p) => n + pauseLength(p), 0)
export const pauseOn = (pauses, ymd) => (pauses ?? []).find((p) => ymd >= p.start && ymd <= p.end) ?? null

// The plan's end date with its pauses: 6 weeks of training plus the paused days.
export const planEndWith = (windowStart, pauses) => addDays(windowStart, PLAN_DAYS - 1 + pausedDayCount(pauses))

// Why this set of pauses can't be saved, or null. Each one starts during the
// plan, runs 4 weeks at most and doesn't overlap the next.
export function pausesProblem(pauses, windowStart) {
  const end = planEndWith(windowStart, pauses)
  for (let i = 0; i < pauses.length; i++) {
    const p = pauses[i]
    if (pauseLength(p) > MAX_PAUSE_WEEKS * 7) return `A pause can be ${MAX_PAUSE_WEEKS} weeks at most.`
    if (p.start < windowStart || p.start > end) return "The pause has to start during the plan."
    if (i > 0 && p.start <= pauses[i - 1].end) return "It overlaps another pause."
  }
  return null
}
