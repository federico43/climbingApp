// Weekly classes: the coach sets them up each week, athletes keep fixed ones
// and ask for changes. Pure rules here; the screens keep the state
// (utils/classScheduleStore.ts). UI only for now: example data, no backend.

export interface GymClass {
  id: string
  day: number       // 0 = Monday … 6 = Sunday
  start: number     // hours from midnight, half-hour steps (9.5 = 9:30)
  roster: string[]  // usernames signed up, not counting the athlete using the app
}

// A time the coach can't teach. `all` blocks the whole day.
export interface BlockedTime {
  day: number
  start: number
  end: number
  all?: boolean
}

// What the athlete did with one of their classes this week.
export type ClassChange =
  | { status: "skip" }
  | { status: "move"; to: string }                  // to another class, waiting for the coach
  | { status: "propose"; day: number; start: number } // a new time, waiting for the coach

export interface ExtraClass { to: string; approved: boolean }

export type EntryState = "on" | "skip" | "pending"

export interface WeekEntry {
  cls: GymClass
  state: EntryState
  from?: string       // the class it replaces (a move or a proposal)
  proposal?: boolean  // a time with no class yet
  extra?: boolean
}

export const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
// The calendar's visible hours: 6:00 to 18:00.
export const GRID_START = 6
export const GRID_END = 18
export const CLASS_HOURS = 2.5
export const CAPACITY = 4
export const MAX_CLASSES_PER_DAY = 2
// Sessions left at which the athlete and the coach get a heads-up.
export const LOW_SESSIONS = 2

export function formatTime(h: number): string {
  const H = Math.floor(h)
  const M = Math.round((h - H) * 60)
  return `${H}:${String(M).padStart(2, "0")}`
}

export const classLabel = (c: { day: number; start: number }) => `${WEEK_DAYS[c.day]} ${formatTime(c.start)}`

// A tap `y` px down a day column → a class start, snapped to the half hour so
// the whole class fits before the end of the grid.
export function startFromOffset(y: number, hourHeight: number): number {
  const half = Math.floor(y / (hourHeight / 2)) / 2
  return Math.max(GRID_START, Math.min(GRID_END - CLASS_HOURS, GRID_START + half))
}

// Days next to each other, Sunday → Monday included.
export const adjacentDays = (a: number, b: number) => Math.abs(a - b) === 1 || Math.abs(a - b) === 6

// No two classes on the same day or on days in a row.
export const restDayOk = (taken: number[], day: number) =>
  !taken.includes(day) && !taken.some((d) => adjacentDays(d, day))

// The athlete's week: their classes with this week's changes, plus the extra.
export function athleteWeek(
  classes: GymClass[],
  mine: string[],
  changes: Record<string, ClassChange>,
  extra: ExtraClass | null,
): WeekEntry[] {
  const byId = (id: string) => classes.find((c) => c.id === id)
  const out: WeekEntry[] = []
  for (const id of mine) {
    const cls = byId(id)
    if (!cls) continue
    const ch = changes[id]
    if (ch?.status === "move") {
      const to = byId(ch.to)
      if (to) out.push({ cls: to, state: "pending", from: id })
    } else if (ch?.status === "propose") {
      out.push({ cls: { id: `prop-${id}`, day: ch.day, start: ch.start, roster: [] }, state: "pending", from: id, proposal: true })
    } else {
      out.push({ cls, state: ch?.status === "skip" ? "skip" : "on" })
    }
  }
  const ex = extra && byId(extra.to)
  if (ex) out.push({ cls: ex, state: extra!.approved ? "on" : "pending", extra: true })
  return out.sort((a, b) => a.cls.day - b.cls.day || a.cls.start - b.cls.start)
}

// Days the athlete is already busy, leaving out `except` (the class being changed).
export function busyDays(week: WeekEntry[], except?: string): number[] {
  return week
    .filter((e) => e.state !== "skip" && (!except || (e.cls.id !== except && e.from !== except)))
    .map((e) => e.cls.day)
}

// People in a class, counting the athlete when it's theirs (or on its way to be).
export function headcount(cls: GymClass, week: WeekEntry[]): number {
  const mineHere = week.some((e) => e.cls.id === cls.id && e.state !== "skip")
  return cls.roster.length + (mineHere ? 1 : 0)
}

const overlaps = (a: number, b: number) => a < b + CLASS_HOURS && b < a + CLASS_HOURS

export function isBlocked(blocks: BlockedTime[], day: number, start: number, end = start + CLASS_HOURS): boolean {
  return blocks.some((b) => b.day === day && (b.all || (start < b.end && end > b.start)))
}

export type AddClassProblem = "max" | "overlap" | "blocked" | "late"

// Why the coach can't put a class at this time, or null when they can.
export function addClassProblem(
  classes: GymClass[],
  blocks: BlockedTime[],
  day: number,
  start: number,
): AddClassProblem | null {
  const sameDay = classes.filter((c) => c.day === day)
  if (sameDay.length >= MAX_CLASSES_PER_DAY) return "max"
  if (start + CLASS_HOURS > GRID_END) return "late"
  if (sameDay.some((c) => overlaps(c.start, start))) return "overlap"
  if (isBlocked(blocks, day, start)) return "blocked"
  return null
}

// The Monday of the week holding `date`, at midnight.
export function mondayOf(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

// Day index (0 = Monday) of `date` in its week.
export const weekdayOf = (date: Date) => (date.getDay() + 6) % 7

// The seven dates of the week starting on `monday`.
export function weekDates(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })
}

// Classes the coach runs most weeks (example data until classes live in Appwrite).
export const EXAMPLE_CLASSES: GymClass[] = [
  { id: "c1", day: 0, start: 9.5, roster: ["lu_crimps", "jp_slab", "sofi_k"] },
  { id: "c2", day: 0, start: 15.5, roster: ["mari_dyno", "vale_r", "diego_m", "cami_p"] },
  { id: "c3", day: 1, start: 9.5, roster: ["ana_v", "nico_h"] },
  { id: "c4", day: 1, start: 15.5, roster: ["lu_crimps", "jp_slab", "sofi_k", "diego_m"] },
  { id: "c6", day: 2, start: 9.5, roster: ["mari_dyno"] },
  { id: "c7", day: 2, start: 15.5, roster: ["vale_r", "ana_v", "jp_slab"] },
  { id: "c8", day: 3, start: 9.5, roster: ["lu_crimps", "sofi_k", "diego_m"] },
  { id: "c9", day: 3, start: 15.5, roster: ["nico_h", "tomas_b"] },
  { id: "c10", day: 4, start: 7, roster: ["mari_dyno", "rocio_t"] },
  { id: "c11", day: 4, start: 9.5, roster: ["cami_p", "vale_r", "ana_v", "jp_slab"] },
  { id: "c13", day: 5, start: 9.5, roster: ["tomas_b", "nico_h"] },
]
// The example athlete's default classes: Monday and Thursday at 9:30.
export const EXAMPLE_MINE = ["c1", "c8"]
