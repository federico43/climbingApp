// Weekly class rules for the server, kept in step with utils/classSchedule.ts
// (the app checks the same rules before it asks). No Appwrite code here, so
// it can be tested on its own (scripts/progression-tests/classRules.test.ts).

export const CLASS_HOURS = 2.5
export const CAPACITY = 4
export const MAX_CLASSES_PER_DAY = 2
export const GRID_START = 6
export const GRID_END = 20
// Missed sessions an athlete can move to a later week, per package.
export const MAX_CARRY = 2
export const LOW_SESSIONS = 2
export const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

export function formatTime(h) {
  const H = Math.floor(h)
  const M = Math.round((h - H) * 60)
  return `${H}:${String(M).padStart(2, "0")}`
}

export const classLabel = (c) => `${WEEK_DAYS[c.day]} ${formatTime(c.start)}`

export const adjacentDays = (a, b) => Math.abs(a - b) === 1 || Math.abs(a - b) === 6

// No two classes on the same day or on days in a row.
export const restDayOk = (taken, day) => !taken.includes(day) && !taken.some((d) => adjacentDays(d, day))

const overlaps = (a, b) => a < b + CLASS_HOURS && b < a + CLASS_HOURS

export function isBlocked(blocks, day, start, end = start + CLASS_HOURS) {
  return blocks.some((b) => b.day === day && (b.all || (start < b.end && end > b.start)))
}

// Why a class can't go at this time, or null. Same as addClassProblem.
export function classProblem(classes, blocks, day, start) {
  if (!Number.isInteger(day) || day < 0 || day > 6) return "day"
  if (typeof start !== "number" || start < GRID_START || start * 2 !== Math.round(start * 2)) return "time"
  const sameDay = classes.filter((c) => c.day === day)
  if (sameDay.length >= MAX_CLASSES_PER_DAY) return "max"
  if (start + CLASS_HOURS > GRID_END) return "late"
  if (sameDay.some((c) => overlaps(c.start, start))) return "overlap"
  if (isBlocked(blocks, day, start)) return "blocked"
  return null
}

export const PROBLEM_TEXT = {
  day: "That's not a day of the week.",
  time: "Pick a time on the half hour.",
  max: `That day already has ${MAX_CLASSES_PER_DAY} classes.`,
  late: `Classes have to end by ${GRID_END}:00.`,
  overlap: "It runs into another class.",
  blocked: "Your coach can't teach then.",
}

// "YYYY-MM-DD" ± days.
export function addDays(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export function mondayOfYmd(ymd) {
  const [y, m, d] = ymd.split("-").map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return addDays(ymd, -((dow + 6) % 7))
}

// The gym's wall clock now, in `tz`: { ymd, hour (9.5 = 9:30), weekday (0 = Mon), ms }.
// `ms` is that wall-clock time read as UTC, so it compares with classMs().
export function gymNow(date, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date).map((p) => [p.type, p.value]),
  )
  const ymd = `${parts.year}-${parts.month}-${parts.day}`
  const hour = Number(parts.hour) + Number(parts.minute) / 60
  const [y, m, d] = ymd.split("-").map(Number)
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
  return { ymd, hour, weekday, ms: Date.UTC(y, m - 1, d) + hour * 3600000 }
}

// When a class starts (offset = 0) or ends (offset = CLASS_HOURS), on the
// same wall-clock-as-UTC scale as gymNow().ms.
export function classMs(c, offset = 0) {
  const [y, m, d] = c.weekStart.split("-").map(Number)
  return Date.UTC(y, m - 1, d + c.day) + (c.start + offset) * 3600000
}

export const slotKey = (day, start) => `${day}@${start}`
export function parseSlot(s) {
  const [d, h] = String(s).split("@").map(Number)
  return Number.isInteger(d) && d >= 0 && d <= 6 && Number.isFinite(h) ? { day: d, start: h } : null
}

// Sessions left in a package: `done` = classes the athlete was in that have
// ended since the package started; skips past the first MAX_CARRY are lost.
export function sessionsLeft(total, done, skips) {
  return Math.max(0, total - done - Math.max(0, skips - MAX_CARRY))
}
