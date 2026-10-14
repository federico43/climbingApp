import { SessionRow } from "@/services/BoulderGraphService"

// Date helpers for the training-consistency calendar and stats
// (Settings › Past workouts).

export function getMondayOfWeek(date: Date, weekOffset = 0): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? 6 : day - 1
  d.setDate(d.getDate() - diff + weekOffset * 7)
  d.setHours(0, 0, 0, 0)
  return d
}

export function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10)
}

// The day a session was trained: its first attempt, else when it was saved.
export function sessionDateStr(session: SessionRow): string {
  try {
    const attempts = JSON.parse(session.attempts)
    if (attempts.length > 0 && attempts[0].timestamp) {
      return new Date(attempts[0].timestamp).toISOString().slice(0, 10)
    }
  } catch {}
  return session.$createdAt.slice(0, 10)
}

export function countUniqueDaysInRange(sessions: SessionRow[], start: Date, end: Date): number {
  const s = toDateStr(start)
  const e = toDateStr(end)
  const days = new Set(
    sessions
      .filter((sess) => {
        const d = sessionDateStr(sess)
        return d >= s && d <= e
      })
      .map((sess) => sessionDateStr(sess))
  )
  return days.size
}

export function countSessionsInMonth(sessions: SessionRow[], year: number, month: number): number {
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`
  return sessions.filter((s) => sessionDateStr(s).startsWith(prefix)).length
}
