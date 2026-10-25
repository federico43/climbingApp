// Weekly classes: the coach sets them up each week, athletes keep fixed ones
// and ask for changes. Pure rules here; the state lives in
// utils/classScheduleStore.ts and the server checks the same rules
// (functions/aiProtocol/src/classRules.js).

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
// The calendar's visible hours: 6:00 to 20:00 (the last class starts at 17:30).
export const GRID_START = 6
export const GRID_END = 20
export const CLASS_HOURS = 2.5
export const CAPACITY = 4
// Classes a day: 2, or 3 on at most MAX_BIG_DAYS days of the week.
export const CLASSES_PER_DAY = 2
export const MAX_CLASSES_PER_DAY = 3
export const MAX_BIG_DAYS = 2
// Classes an athlete takes a week.
export const MAX_CLASSES_PER_WEEK = 2
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

// Days from `from` on that still leave a rest day around the athlete's other classes.
export const openDays = (taken: number[], from: number) =>
  Array.from({ length: 7 - Math.max(0, from) }, (_, i) => from + i).filter((d) => restDayOk(taken, d))

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

export type AddClassProblem = "max" | "bigDays" | "overlap" | "blocked" | "late"

// Why `day` can't take one more class: it has 3 already, or it has 2 and
// two other days already have 3. Null when there's room.
export function dayFullProblem(classes: { day: number }[], day: number): "max" | "bigDays" | null {
  const count = (d: number) => classes.filter((c) => c.day === d).length
  const n = count(day)
  if (n >= MAX_CLASSES_PER_DAY) return "max"
  if (n < CLASSES_PER_DAY) return null
  const bigDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== day && count(d) >= MAX_CLASSES_PER_DAY).length
  return bigDays >= MAX_BIG_DAYS ? "bigDays" : null
}

// Why the coach can't put a class at this time, or null when they can.
export function addClassProblem(
  classes: GymClass[],
  blocks: BlockedTime[],
  day: number,
  start: number,
): AddClassProblem | null {
  const sameDay = classes.filter((c) => c.day === day)
  const full = dayFullProblem(classes, day)
  if (full) return full
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

// "YYYY-MM-DD" of a local date (the week's key on the server is its Monday).
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function dateOf(ymdStr: string): Date {
  const [y, m, d] = ymdStr.split("-").map(Number)
  return new Date(y, m - 1, d)
}

// When a class starts, as a local Date.
export function classDate(weekStart: string, c: { day: number; start: number }): Date {
  const d = dateOf(weekStart)
  d.setDate(d.getDate() + c.day)
  d.setMinutes(Math.round(c.start * 60))
  return d
}

// An athlete's usual class, as saved on their user row: "0@9.5" = Monday 9:30.
export const slotKey = (c: { day: number; start: number }) => `${c.day}@${c.start}`
export function parseSlot(s: string): { day: number; start: number } | null {
  const [d, h] = s.split("@").map(Number)
  return Number.isInteger(d) && d >= 0 && d <= 6 && Number.isFinite(h) ? { day: d, start: h } : null
}

// Missed sessions that can move to a later week, per package.
export const MAX_CARRY = 2

// Sessions left: `done` = classes the athlete was in that have ended since
// the package started; skips past the first MAX_CARRY are lost.
export const sessionsLeft = (total: number, done: number, skips: number) =>
  Math.max(0, total - done - Math.max(0, skips - MAX_CARRY))

// The package in use on `today`: the latest one already started (the newest
// row when two start the same day).
export function currentPackage<P extends { startsOn: string; $createdAt?: string }>(pkgs: P[], today: string): P | null {
  return pkgs
    .filter((p) => p.startsOn <= today)
    .sort((a, b) => (a.startsOn !== b.startsOn ? (a.startsOn < b.startsOn ? 1 : -1) : (a.$createdAt ?? "") < (b.$createdAt ?? "") ? 1 : -1))[0] ?? null
}

// An athlete is locked out when their package is used up or past its use-by
// date, until the coach adds a new one. No package at all doesn't lock.
export const packageLocked = (pkg: { useBy: string } | null, left: number, today: string) =>
  !!pkg && (left <= 0 || pkg.useBy < today)

// A request row from the server (table class_requests).
export interface ClassRequestRow {
  $id: string
  athleteId: string
  weekStart: string
  kind: "move" | "propose" | "extra" | "skip"
  status: "pending" | "accepted" | "rejected" | "expired"
  fromClassId?: string | null
  toClassId?: string | null
  day?: number | null
  start?: number | null
}

// The server's week (rosters hold everyone, by id) as the athlete screens
// see it: rosters as names without the athlete, their classes, and this
// week's changes from their requests.
export function athleteView(
  classes: GymClass[],
  requests: ClassRequestRow[],
  me: string,
  names: Record<string, string>,
): { classes: GymClass[]; mine: string[]; changes: Record<string, ClassChange>; extra: ExtraClass | null } {
  const mine = classes.filter((c) => c.roster.includes(me)).map((c) => c.id)
  const changes: Record<string, ClassChange> = {}
  let extra: ExtraClass | null = null
  for (const r of requests) {
    if (r.athleteId !== me) continue
    const from = r.fromClassId ?? ""
    if (r.kind === "skip" && r.status === "accepted" && classes.some((c) => c.id === from)) {
      if (!mine.includes(from)) mine.push(from)
      changes[from] = { status: "skip" }
    }
    if (r.status !== "pending") continue
    if (r.kind === "move" && r.toClassId) changes[from] = { status: "move", to: r.toClassId }
    if (r.kind === "propose" && r.day != null && r.start != null) changes[from] = { status: "propose", day: r.day, start: r.start }
    if (r.kind === "extra" && r.toClassId) extra = { to: r.toClassId, approved: false }
  }
  return {
    classes: classes.map((c) => ({ ...c, roster: c.roster.filter((u) => u !== me).map((u) => names[u] ?? "athlete") })),
    mine,
    changes,
    extra,
  }
}
