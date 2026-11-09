// Jump rope cardio: a plan the app runs by itself (no coach building it).
// Pure logic only — protocol per step and cycle, how a session is graded, the
// up / repeat / down rules, deloads and the starting test. See
// docs/cardio-rope.md for the reasoning behind each rule.

// ── protocol ──────────────────────────────────────────────────────────────

export type CardioStep = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface CardioProtocol {
  series: number
  workSec: number
  restSec: number
  /** Doubles / crosses every N seconds of each work interval (step 5). */
  doublesEverySec: number | null
  /** Triples or a heavy rope instead of plain doubles (cycle 4+, step 6). */
  triplesOrHeavy: boolean
  /** Step 0: 30 s of rope-less jumps before the series. */
  dryJumps: boolean
}

const P = (series: number, workSec: number, restSec: number, extra: Partial<CardioProtocol> = {}): CardioProtocol => ({
  series, workSec, restSec, doublesEverySec: null, triplesOrHeavy: false, dryJumps: false, ...extra,
})

export const MAX_STEP: CardioStep = 6
export const MAX_SERIES = 15

/** Steps 3–6 for each cycle (1-based). Cycles from 5 on reuse cycle 4 plus one series each. */
function upperSteps(cycle: number): Record<3 | 4 | 5 | 6, CardioProtocol> {
  if (cycle <= 1) return {
    3: P(10, 30, 30), 4: P(10, 30, 20), 5: P(10, 30, 30, { doublesEverySec: 10 }), 6: P(10, 40, 20),
  }
  if (cycle === 2) return {
    3: P(12, 30, 30), 4: P(12, 30, 20), 5: P(12, 30, 30, { doublesEverySec: 10 }), 6: P(12, 40, 20),
  }
  if (cycle === 3) return {
    3: P(12, 30, 20), 4: P(12, 30, 15), 5: P(12, 30, 20, { doublesEverySec: 5 }), 6: P(12, 40, 15),
  }
  const series = Math.min(MAX_SERIES, 12 + (cycle - 4))
  return {
    3: P(series, 40, 20), 4: P(series, 45, 15), 5: P(series, 45, 15, { doublesEverySec: 5 }),
    6: P(series, 45, 15, { triplesOrHeavy: true }),
  }
}

export function protocolFor(step: CardioStep, cycle: number): CardioProtocol {
  if (step === 0) return P(6, 20, 40, { dryJumps: true })
  if (step === 1) return P(6, 30, 30)
  if (step === 2) return P(8, 30, 30)
  return upperSteps(cycle)[step]
}

/** 60 % of the series, rounded half up (10 → 6, 12 → 7, 6 → 4). */
export function deloadSeries(series: number): number {
  return Math.max(1, Math.round(series * 0.6))
}

export function sessionProtocol(step: CardioStep, cycle: number, opts: { deload?: boolean; climbedHard?: boolean } = {}): CardioProtocol {
  // Climbed hard that day: the step below, just for this session.
  const s = (opts.climbedHard && step > 0 ? step - 1 : step) as CardioStep
  const p = protocolFor(s, cycle)
  return opts.deload ? { ...p, series: deloadSeries(p.series) } : p
}

export function protocolLabel(p: CardioProtocol): string {
  let out = `${p.series} × ${p.workSec}s on / ${p.restSec}s off`
  if (p.triplesOrHeavy) out += " · triples or heavy rope"
  else if (p.doublesEverySec) out += ` · doubles every ${p.doublesEverySec}s`
  return out
}

/** Minutes the session takes, rounded up (dry jumps add 30 s). */
export function protocolMinutes(p: CardioProtocol): number {
  const sec = p.series * p.workSec + (p.series - 1) * p.restSec + (p.dryJumps ? 30 : 0)
  return Math.ceil(sec / 60)
}

// ── the 4 questions ───────────────────────────────────────────────────────

export type Rest = "plenty" | "enough" | "short" | "notRecovering"
export type Pain = "none" | "mild" | "pain"
export type Pace = "all" | "stopped1to2" | "stoppedMany"
export type Effort = "easy" | "steady" | "mixed" | "allOut"
export type StopReason = "coordination" | "tired"
export type PainZone = "calf" | "achilles" | "shin" | "foot"

export interface CardioAnswers {
  rest: Rest
  pain: Pain
  pace: Pace
  effort: Effort
  /** Asked when pace isn't "all". */
  stopReason?: StopReason | null
  /** Asked when pain isn't "none". */
  painZone?: PainZone | null
}

export type Light = "green" | "yellow" | "red"

export function lights(a: CardioAnswers): { rest: Light; pain: Light; pace: Light; effort: Light } {
  return {
    rest: a.rest === "short" ? "yellow" : a.rest === "notRecovering" ? "red" : "green",
    pain: a.pain === "mild" ? "yellow" : a.pain === "pain" ? "red" : "green",
    pace: a.pace === "stopped1to2" ? "yellow" : a.pace === "stoppedMany" ? "red" : "green",
    effort: a.effort === "mixed" ? "yellow" : a.effort === "allOut" ? "red" : "green",
  }
}

export function allGreen(a: CardioAnswers): boolean {
  return Object.values(lights(a)).every((l) => l === "green")
}

/** All green, easy effort and rest to spare: the athlete may skip a step. */
export function isEasy(a: CardioAnswers): boolean {
  return allGreen(a) && a.effort === "easy" && a.rest === "plenty"
}

// ── plan state and rules ──────────────────────────────────────────────────

export interface CardioState {
  step: CardioStep
  cycle: number
  /** Green sessions in a row at this step (deloads and climbed-hard days don't count). */
  greenStreak: number
  /** Easy sessions in a row at this step. */
  easyStreak: number
  /** Pain cap: at most 2 sessions a week until 2 painless sessions in a row. */
  painCap: boolean
  painFreeStreak: number
  /** The pain zone of the last session, for "same zone twice" alerts. */
  lastPainZone: PainZone | null
  /** Next session starts with "Go a bit slower this time". */
  slowDown: boolean
  /** A promotion waiting for its deload week to end (to step 6 or the next cycle). */
  pendingUp: { step: CardioStep; cycle: number } | null
}

export type Outcome = "up" | "skip" | "cycleUp" | "repeat" | "down" | "deloadHold"

export interface SessionResult {
  next: CardioState
  outcome: Outcome
  /** Which rule fired (1–8, see docs), for the coach and tests. */
  rule: number
  /** Same pain zone two sessions in a row: tell the coach. */
  alertCoach: boolean
  /** The promotion needs a deload week first. */
  needsDeload: boolean
}

export function initialState(step: CardioStep, cycle = 1): CardioState {
  return {
    step, cycle, greenStreak: 0, easyStreak: 0, painCap: false, painFreeStreak: 0,
    lastPainZone: null, slowDown: false, pendingUp: null,
  }
}

const clampStep = (n: number): CardioStep => Math.max(0, Math.min(MAX_STEP, n)) as CardioStep

/** Moves to a new step: streaks start over. */
function moveTo(s: CardioState, step: CardioStep, cycle = s.cycle): CardioState {
  return { ...s, step, cycle, greenStreak: 0, easyStreak: 0 }
}

/**
 * Grades one finished session and returns the state for the next one.
 * Rules run in order and the first that matches wins (docs/cardio-rope.md).
 *
 * `counts` is false for deload sessions and climbed-hard days: they never add
 * to a green streak, but pain still counts.
 * `deloadDueSoon` tells whether a promotion to step 6 / next cycle has to wait
 * for a deload week (true unless one ended less than 3 weeks ago).
 */
export function gradeSession(
  prev: CardioState,
  a: CardioAnswers,
  opts: { counts: boolean; deloadDueSoon: boolean },
): SessionResult {
  // Pain bookkeeping happens whatever rule fires.
  const zone = a.pain === "pain" ? a.painZone ?? null : null
  const alertCoach = a.pain === "pain" && zone != null && prev.lastPainZone === zone
  let s: CardioState = { ...prev, slowDown: false, lastPainZone: zone }
  if (a.pain === "none") {
    const painFreeStreak = prev.painFreeStreak + 1
    s = { ...s, painFreeStreak, painCap: prev.painCap && painFreeStreak < 2 }
  } else {
    s = { ...s, painFreeStreak: 0 }
  }
  const done = (next: CardioState, outcome: Outcome, rule: number, needsDeload = false): SessionResult =>
    ({ next, outcome, rule, alertCoach, needsDeload })

  // 1. Pain: one step down, pain cap on.
  if (a.pain === "pain") {
    return done({ ...moveTo(s, clampStep(s.step - 1)), painCap: true, pendingUp: null }, "down", 1)
  }
  // 2. Mild discomfort: repeat.
  if (a.pain === "mild") return done(moveTo(s, s.step), "repeat", 2)
  // 3. Many stops for coordination: back to learning the move.
  if (a.pace === "stoppedMany" && a.stopReason === "coordination") {
    const to: CardioStep = s.step <= 1 ? 0 : s.step === 5 ? 4 : 1
    return done({ ...moveTo(s, to), pendingUp: null }, to < s.step ? "down" : "repeat", 3)
  }
  // 4. Tired, not recovering or all-out: repeat, slower.
  if (a.pace === "stoppedMany" || a.rest === "notRecovering" || a.effort === "allOut") {
    return done({ ...moveTo(s, s.step), slowDown: true }, "repeat", 4)
  }
  // 5. Mixed effort, a couple of stops, or rest a bit short: repeat.
  if (!allGreen(a)) return done(moveTo(s, s.step), "repeat", 5)

  // All green from here.
  if (!opts.counts) return done(s, "repeat", 0)
  const greenStreak = s.greenStreak + 1
  const easyStreak = isEasy(a) ? s.easyStreak + 1 : 0
  s = { ...s, greenStreak, easyStreak }
  if (greenStreak < 2) return done(s, "repeat", 6)

  // 8. Two greens at step 6: next cycle, back to step 3 (after a deload).
  if (s.step === 6) {
    const target = { step: 3 as CardioStep, cycle: s.cycle + 1 }
    if (opts.deloadDueSoon) return done({ ...moveTo(s, s.step), pendingUp: target }, "deloadHold", 8, true)
    return done(moveTo(s, target.step, target.cycle), "cycleUp", 8)
  }
  // 7. Two easy sessions in a row: skip a step, landing at step 3 at most.
  if (easyStreak >= 2 && s.step <= 1) {
    return done(moveTo(s, clampStep(s.step + 2)), "skip", 7)
  }
  // 6. Two greens: one step up (step 6 waits for a deload).
  const up = clampStep(s.step + 1)
  if (up === 6 && opts.deloadDueSoon) {
    return done({ ...moveTo(s, s.step), pendingUp: { step: 6, cycle: s.cycle } }, "deloadHold", 6, true)
  }
  return done(moveTo(s, up), "up", 6)
}

/** A deload week ended: apply the promotion it was holding, if any. */
export function afterDeload(s: CardioState): CardioState {
  if (!s.pendingUp) return s
  return { ...moveTo(s, s.pendingUp.step, s.pendingUp.cycle), pendingUp: null }
}

/** Two weeks or more with no session: one step down when coming back. */
export function afterLongBreak(s: CardioState, daysSinceLast: number): CardioState {
  if (daysSinceLast < 14) return s
  return { ...moveTo(s, clampStep(s.step - 1)), pendingUp: null }
}

// ── step 0 exit and the starting test ─────────────────────────────────────

export type StopCount = "0" | "1-3" | "4-5" | "6+"
export const STOP_COUNTS: StopCount[] = ["0", "1-3", "4-5", "6+"]

/** 2 of 3 attempts with 3 stops or fewer. */
export function coordinationPassed(attempts: StopCount[]): boolean {
  return attempts.filter((c) => c === "0" || c === "1-3").length >= 2
}

/** Capacity test (5 × 30/30): all green → 3, green + yellow → 2, any red or pain → 1. */
export function startStepFromCapacity(a: CardioAnswers): CardioStep {
  const l = Object.values(lights(a))
  if (a.pain !== "none" || l.includes("red")) return 1
  if (l.includes("yellow")) return 2
  return 3
}

export const CAPACITY_TEST: CardioProtocol = P(5, 30, 30)

// ── deload calendar ───────────────────────────────────────────────────────

export const DELOAD_EVERY_WEEKS = 5
/** A deload before a big promotion is skipped if one ended less than this ago. */
export const DELOAD_MIN_GAP_WEEKS = 3

/** Monday of the week holding `date` ("YYYY-MM-DD"), as "YYYY-MM-DD". */
export function weekStart(date: string): string {
  const [y, m, d] = date.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const dow = (dt.getUTCDay() + 6) % 7 // Monday = 0
  dt.setUTCDate(dt.getUTCDate() - dow)
  return dt.toISOString().slice(0, 10)
}

export function daysBetween(a: string, b: string): number {
  const t = (s: string) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d) }
  return Math.round((t(b) - t(a)) / 86400000)
}

/**
 * Is the week of `today` a deload week? `lastDeloadWeek` / `startedAt` are
 * "YYYY-MM-DD"; `forcedWeek` is the Monday of a deload asked for by a held
 * promotion.
 */
export function isDeloadWeek(today: string, startedAt: string, lastDeloadWeek: string | null, forcedWeek: string | null): boolean {
  const wk = weekStart(today)
  if (forcedWeek && forcedWeek === wk) return true
  if (lastDeloadWeek && lastDeloadWeek === wk) return true
  const from = weekStart(lastDeloadWeek ?? startedAt)
  return daysBetween(from, wk) >= DELOAD_EVERY_WEEKS * 7
}

/** Should a promotion to step 6 / next cycle wait for a deload week? */
export function deloadDueBeforePromotion(today: string, lastDeloadWeek: string | null): boolean {
  if (!lastDeloadWeek) return true
  return daysBetween(weekStart(lastDeloadWeek), weekStart(today)) >= DELOAD_MIN_GAP_WEEKS * 7
}

// ── days ──────────────────────────────────────────────────────────────────

/** 0 = Monday … 6 = Sunday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6
export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

/** 2 or 3 days, never two in a row (Sunday and Monday count as in a row). */
export function validDays(days: Weekday[]): boolean {
  const set = [...new Set(days)].sort((a, b) => a - b)
  if (set.length < 2 || set.length > 3) return false
  return set.every((d, i) => {
    const next = set[(i + 1) % set.length]
    return (next - d + 7) % 7 !== 1
  })
}

export function weekdayOf(date: string): Weekday {
  const [y, m, d] = date.split("-").map(Number)
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) as Weekday
}

/**
 * May the athlete do a session today? Not if they did one yesterday or today,
 * nor past the week's limit (3, or 2 under the pain cap).
 */
export function canTrainToday(today: string, sessionDates: string[], painCap: boolean): { ok: boolean; reason?: "doneToday" | "yesterday" | "weekFull" } {
  if (sessionDates.includes(today)) return { ok: false, reason: "doneToday" }
  if (sessionDates.some((d) => daysBetween(d, today) === 1)) return { ok: false, reason: "yesterday" }
  const wk = weekStart(today)
  const thisWeek = sessionDates.filter((d) => weekStart(d) === wk).length
  if (thisWeek >= (painCap ? 2 : 3)) return { ok: false, reason: "weekFull" }
  return { ok: true }
}

export type DayStatus = "done" | "today" | "planned" | "missed" | "rest"

/** The 7 days of the week of `today`, for the plan card. */
export function weekStatus(today: string, days: Weekday[], sessionDates: string[]): DayStatus[] {
  const wk = weekStart(today)
  const todayIdx = daysBetween(wk, today)
  return Array.from({ length: 7 }, (_, i) => {
    const [y, m, d] = wk.split("-").map(Number)
    const date = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10)
    if (sessionDates.includes(date)) return "done"
    const planned = days.includes(i as Weekday)
    if (i === todayIdx) return planned ? "today" : "rest"
    if (!planned) return "rest"
    return i < todayIdx ? "missed" : "planned"
  })
}

// ── the whole plan (stored as JSON on users.cardioPlan) ──────────────────

export interface CardioPlan {
  /** Set by the coach before the athlete starts: skips the starting test. */
  coachStartStep?: CardioStep | null
  days: Weekday[]
  /** "HH:MM", local time of the reminder on training days. */
  reminderTime: string
  /** When the athlete said "I'm in" (ISO). Null = not started. */
  committedAt: string | null
  /** First session's date ("YYYY-MM-DD"). */
  startedAt: string | null
  /** Null = the next session is the starting test. */
  state: CardioState | null
  lastDeloadWeek: string | null
  /** A deload week asked for by a held promotion (its Monday). */
  forcedDeloadWeek: string | null
  lastSessionDate: string | null
}

export const DEFAULT_REMINDER = "18:00"

export function parseCardioPlan(raw: string | null | undefined): CardioPlan | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw)
    if (!p || typeof p !== "object") return null
    return {
      coachStartStep: p.coachStartStep ?? null,
      days: Array.isArray(p.days) ? p.days : [],
      reminderTime: typeof p.reminderTime === "string" ? p.reminderTime : DEFAULT_REMINDER,
      committedAt: p.committedAt ?? null,
      startedAt: p.startedAt ?? null,
      state: p.state ?? null,
      lastDeloadWeek: p.lastDeloadWeek ?? null,
      forcedDeloadWeek: p.forcedDeloadWeek ?? null,
      lastSessionDate: p.lastSessionDate ?? null,
    }
  } catch {
    return null
  }
}

export function emptyPlan(): CardioPlan {
  return {
    coachStartStep: null, days: [], reminderTime: DEFAULT_REMINDER, committedAt: null, startedAt: null,
    state: null, lastDeloadWeek: null, forcedDeloadWeek: null, lastSessionDate: null,
  }
}

function addDaysStr(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** The athlete commits: days, reminder, and the coach's start step if any. */
export function commitPlan(plan: CardioPlan | null, days: Weekday[], reminderTime: string, nowIso: string): CardioPlan {
  const base = plan ?? emptyPlan()
  const state = base.state ?? (base.coachStartStep != null ? initialState(base.coachStartStep) : null)
  return { ...base, days: [...days].sort((a, b) => a - b), reminderTime, committedAt: nowIso, state }
}

/** Applies what time alone changes: a long break, the end of a held deload. */
export function normalizePlan(plan: CardioPlan, today: string): CardioPlan {
  if (!plan.state) return plan
  let state = plan.state
  let forcedDeloadWeek = plan.forcedDeloadWeek
  if (plan.lastSessionDate) state = afterLongBreak(state, daysBetween(plan.lastSessionDate, today))
  if (state.pendingUp && forcedDeloadWeek && weekStart(today) > forcedDeloadWeek) {
    state = afterDeload(state)
    forcedDeloadWeek = null
  }
  if (!state.pendingUp) forcedDeloadWeek = null
  return { ...plan, state, forcedDeloadWeek }
}

export interface TodaySession {
  kind: "test" | "session" | "deload"
  step: CardioStep
  cycle: number
  protocol: CardioProtocol
  slowDown: boolean
}

/** What today's session is (the plan already normalized for today). */
export function todaySession(plan: CardioPlan, today: string, climbedHard: boolean): TodaySession {
  const p = normalizePlan(plan, today)
  if (!p.state) return { kind: "test", step: 0, cycle: 1, protocol: CAPACITY_TEST, slowDown: false }
  const deload = isDeloadWeek(today, p.startedAt ?? today, p.lastDeloadWeek, p.forcedDeloadWeek)
  return {
    kind: deload ? "deload" : "session",
    step: p.state.step,
    cycle: p.state.cycle,
    protocol: sessionProtocol(p.state.step, p.state.cycle, { deload, climbedHard }),
    slowDown: p.state.slowDown,
  }
}

/** Records the starting test: coordination attempts, then capacity answers (null if it stopped at coordination). */
export function recordTest(plan: CardioPlan, today: string, attempts: StopCount[], capacity: CardioAnswers | null): { plan: CardioPlan; step: CardioStep } {
  const step: CardioStep = !coordinationPassed(attempts) || !capacity ? 0 : startStepFromCapacity(capacity)
  const state = { ...initialState(step), painCap: capacity?.pain === "pain" }
  return { plan: { ...plan, state, startedAt: plan.startedAt ?? today, lastSessionDate: today }, step }
}

/** Records a regular (or deload) session and moves the plan on. */
export function recordSession(plan: CardioPlan, today: string, answers: CardioAnswers, climbedHard: boolean): { plan: CardioPlan; result: SessionResult; session: TodaySession } {
  const p = normalizePlan(plan, today)
  if (!p.state) throw new Error("recordSession before the starting test")
  const session = todaySession(p, today, climbedHard)
  const deload = session.kind === "deload"
  const lastDeloadWeek = deload ? weekStart(today) : p.lastDeloadWeek
  const result = gradeSession(p.state, answers, {
    counts: !deload && !climbedHard,
    deloadDueSoon: deloadDueBeforePromotion(today, lastDeloadWeek),
  })
  const forcedDeloadWeek = result.needsDeload ? addDaysStr(weekStart(today), 7) : result.next.pendingUp ? p.forcedDeloadWeek : null
  return {
    plan: { ...p, state: result.next, lastDeloadWeek, forcedDeloadWeek, lastSessionDate: today, startedAt: p.startedAt ?? today },
    result,
    session,
  }
}

// ── reminders ────────────────────────────────────────────────────────────

/**
 * The next reminders to schedule: training days in the next `horizon` days at
 * the plan's time, skipping today if a session is already done or the time
 * has passed. Rescheduled every time the app opens or the plan changes, so a
 * day with a session done never rings. `nowMinutes` = minutes since local
 * midnight.
 */
export function reminderDates(plan: CardioPlan, today: string, nowMinutes: number, sessionDates: string[], horizon = 14): { date: string; hour: number; minute: number }[] {
  if (!plan.committedAt || plan.days.length === 0) return []
  const [hour, minute] = plan.reminderTime.split(":").map(Number)
  const out: { date: string; hour: number; minute: number }[] = []
  for (let i = 0; i < horizon; i++) {
    const date = addDaysStr(today, i)
    if (!plan.days.includes(weekdayOf(date))) continue
    if (sessionDates.includes(date)) continue
    if (i === 0 && hour * 60 + minute <= nowMinutes) continue
    out.push({ date, hour, minute })
  }
  return out
}

// ── coach ────────────────────────────────────────────────────────────────

/**
 * The coach sets the step (and cycle). Before the athlete's first session it
 * fixes the starting step and skips the test; after, it moves the plan there
 * with fresh streaks.
 */
export function coachSetStep(plan: CardioPlan | null, step: CardioStep | null, cycle = 1): CardioPlan {
  const base = plan ?? emptyPlan()
  if (!base.state) {
    if (step == null) return { ...base, coachStartStep: null }
    return { ...base, coachStartStep: step, state: base.committedAt ? initialState(step, cycle) : null }
  }
  if (step == null) return base
  return { ...base, state: { ...base.state, step, cycle: Math.max(1, cycle), greenStreak: 0, easyStreak: 0, pendingUp: null }, forcedDeloadWeek: null }
}

/** Pain in the same zone in the last two sessions (newest first): the zone, else null. */
export function repeatedPainZone(answersNewestFirst: (CardioAnswers | null)[]): PainZone | null {
  const [a, b] = answersNewestFirst
  if (a?.pain === "pain" && b?.pain === "pain" && a.painZone && a.painZone === b.painZone) return a.painZone
  return null
}
