// The athlete's default week: which days they train, and when
// (Settings › My week). UI-only for now; nothing is saved to the backend.

export interface WeekSession {
  id: string
  day: number    // 0 = Monday … 6 = Sunday
  start: number  // hours from midnight, in half-hour steps (18.5 = 18:30)
  hours: number
}

export const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
// The calendar's visible hours: 6:00 to 18:00.
export const GRID_START = 6
export const GRID_END = 18
export const DURATIONS = [1.5, 2, 2.5, 3]
// A usual session runs two and a half hours.
export const DEFAULT_HOURS = 2.5

// Example week shown until the screen loads real data.
export const EXAMPLE_WEEK: WeekSession[] = [
  { id: "ex1", day: 0, start: 7, hours: 2.5 },
  { id: "ex2", day: 2, start: 9, hours: 2.5 },
  { id: "ex3", day: 4, start: 7, hours: 2.5 },
  { id: "ex4", day: 5, start: 10, hours: 2.5 },
]

export function formatTime(h: number): string {
  const H = Math.floor(h)
  const M = Math.round((h - H) * 60)
  return `${H}:${String(M).padStart(2, "0")}`
}

export function formatHours(h: number): string {
  const H = Math.floor(h)
  const M = Math.round((h - H) * 60)
  if (!M) return `${H}h`
  return H ? `${H}h ${M}m` : `${M}m`
}

// A tap at `y` px down a day column, snapped to the half hour and kept inside the grid.
export function startFromOffset(y: number, hourHeight: number): number {
  const half = Math.floor(y / (hourHeight / 2)) / 2
  return Math.max(GRID_START, Math.min(GRID_END - 0.5, GRID_START + half))
}

// Moves a start time by half-hour steps, staying inside the grid.
export function stepStart(start: number, steps: number): number {
  return Math.max(GRID_START, Math.min(GRID_END - 0.5, start + steps * 0.5))
}

// A session can't run past the end of the grid.
export function clampHours(start: number, hours: number): number {
  return Math.min(hours, GRID_END - start)
}

export function weekSummary(sessions: WeekSession[]) {
  return {
    days: new Set(sessions.map((s) => s.day)).size,
    hours: sessions.reduce((sum, s) => sum + s.hours, 0),
  }
}
