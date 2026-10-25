// Pauses in a training plan (holidays, an injury): whole weeks set by the
// coach in which the plan stands still. The plan keeps its 6 weeks of
// training — its end date moves back by the paused days — and its week
// count stops while a pause runs. The rotation doesn't care: it counts
// built workouts, not dates. Pure; the server keeps the same rules in
// functions/aiProtocol/src/planPauses.js.

export interface PlanPause {
  start: string   // "YYYY-MM-DD", first paused day
  end: string     // "YYYY-MM-DD", last paused day (inclusive)
  reason?: string
}

export const MAX_PAUSE_WEEKS = 4

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

function dayNumber(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86400000)
}

function plusDays(dateStr: string, days: number): string {
  return new Date((dayNumber(dateStr) + days) * 86400000).toISOString().slice(0, 10)
}

// The column holds a JSON array; anything malformed is dropped. Sorted by start.
export function parsePauses(raw: unknown): PlanPause[] {
  let list: unknown = raw
  if (typeof raw === "string") {
    try { list = JSON.parse(raw) } catch { return [] }
  }
  if (!Array.isArray(list)) return []
  return list
    .filter((p) => DAY_RE.test(p?.start ?? "") && DAY_RE.test(p?.end ?? "") && p.end >= p.start)
    .map((p) => ({ start: p.start, end: p.end, ...(typeof p.reason === "string" && p.reason.trim() ? { reason: p.reason.trim().slice(0, 60) } : {}) }))
    .sort((a, b) => (a.start < b.start ? -1 : 1))
}

export function pauseLength(p: PlanPause): number {
  return dayNumber(p.end) - dayNumber(p.start) + 1
}

export function pausedDayCount(pauses: PlanPause[]): number {
  return pauses.reduce((n, p) => n + pauseLength(p), 0)
}

// A pause of `weeks` whole weeks from `start`.
export function pauseFor(start: string, weeks: number, reason?: string): PlanPause {
  return { start, end: plusDays(start, weeks * 7 - 1), ...(reason?.trim() ? { reason: reason.trim() } : {}) }
}

export function pauseOn(pauses: PlanPause[] | undefined, date: string): PlanPause | null {
  return pauses?.find((p) => date >= p.start && date <= p.end) ?? null
}

// The pause running today, else the next one to come.
export function currentOrNextPause(pauses: PlanPause[] | undefined, today: string): PlanPause | null {
  return pauses?.find((p) => p.end >= today) ?? null
}

// Paused days before `date` (not counting `date` itself).
function pausedBefore(pauses: PlanPause[], date: string): number {
  let n = 0
  for (const p of pauses) {
    if (p.start >= date) continue
    n += dayNumber(p.end < date ? p.end : plusDays(date, -1)) - dayNumber(p.start) + 1
  }
  return n
}

// `date` on the plan's own clock, which stops during pauses: the same date
// with the paused days before it taken out. A paused day reads as the last
// day before its pause, so the week count stands still.
export function planClockDate(pauses: PlanPause[] | undefined, date: string): string {
  if (!pauses?.length) return date
  const inPause = pauseOn(pauses, date)
  const at = inPause ? plusDays(inPause.start, -1) : date
  return plusDays(at, -pausedBefore(pauses, at))
}

// Why a new pause can't go in, or null. `pauses` are the plan's others.
export function pauseProblem(
  pause: PlanPause,
  pauses: PlanPause[],
  plan: { windowStart: string; windowEnd: string },
): string | null {
  if (pause.end < pause.start) return "Pick a start date."
  if (pauseLength(pause) > MAX_PAUSE_WEEKS * 7) return `A pause can be ${MAX_PAUSE_WEEKS} weeks at most.`
  if (pause.start < plan.windowStart || pause.start > plan.windowEnd) return "The pause has to start during the plan."
  if (pauses.some((p) => pause.start <= p.end && p.start <= pause.end)) return "It overlaps another pause."
  return null
}

// Ends a pause early: its last day becomes yesterday. null when it hadn't
// started yet (then it's just removed).
export function endPauseEarly(pause: PlanPause, today: string): PlanPause | null {
  const end = plusDays(today, -1)
  if (end < pause.start) return null
  return end < pause.end ? { ...pause, end } : pause
}
