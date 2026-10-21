// Pure decision engine for S&C load progression. Given how an exercise is
// meant to be trained (its focus) and what the athlete actually did last
// time (reps vs. target, RPE optional), decides whether next time should go up,
// hold, or come down — and what that means concretely, whether the exercise
// is progressed by weight or by stepping through a named level list.
//
// Kept dependency-free (no scData/session parsing here) so it's the single
// source of truth for both StrengthConditioningBlock.tsx (where it reads
// history to prefill) and any future coach-facing view of the same call.

export type Focus = "max_force" | "hypertrophy" | "explosiveness"
export type LoadMode = "weight" | "level"

export const FOCUSES: Focus[] = ["max_force", "hypertrophy", "explosiveness"]

// The focuses an exercise of this movement pattern can be trained at. Core
// never trains explosiveness — it only alternates max force and hypertrophy
// (coach 2026-10-21).
export function focusesFor(movementType?: string): Focus[] {
  return movementType === "core" ? FOCUSES.filter((f) => f !== "explosiveness") : FOCUSES
}

export const FOCUS_LABEL: Record<Focus, string> = {
  max_force:     "Max force",
  hypertrophy:   "Hypertrophy",
  explosiveness: "Explosiveness",
}

export const FOCUS_COLOR: Record<Focus, string> = {
  max_force:     "#DB504A",  // red — high intensity, long rest
  hypertrophy:   "#4F8FE0",  // blue — steady volume
  explosiveness: "#FED766",  // yellow — fast, light, never grind
}

// What the focus means while doing the set, in one line — shown on the
// exercise brief so "Max force" isn't just a coloured label. Unit-neutral
// (works for reps and timed holds).
export const FOCUS_CUE: Record<Focus, string> = {
  max_force:     "Heavy, every rep clean. Stop with 1–2 left in the tank, and rest fully.",
  hypertrophy:   "Moderate load, controlled tempo. Finish about 2 short of failure.",
  explosiveness: "Light and fast. Every rep at full speed — end the set as soon as you slow down.",
}

interface RpeBand { low: number; high: number }

// Low reps/high intensity/long rest for max force, medium/medium/medium for
// hypertrophy, low reps/low intensity/fast for explosiveness — explosiveness
// stays capped low because grinding a rep defeats the point of the quality.
export const FOCUS_RPE_BAND: Record<Focus, RpeBand> = {
  max_force:     { low: 8, high: 9.5 },
  hypertrophy:   { low: 7, high: 8.5 },
  explosiveness: { low: 4, high: 6 },
}

interface RepRange { low: number; high: number }

// Rep window a weight-mode set should land in for the exercise's focus.
// Reaching the top of the range means the current weight is no longer
// enough of a limiter — time to add load rather than add reps.
export const FOCUS_REP_RANGE: Record<Focus, RepRange> = {
  max_force:     { low: 3, high: 6 },
  hypertrophy:   { low: 8, high: 12 },
  explosiveness: { low: 3, high: 6 },
}

export type Direction = "increase" | "hold" | "decrease"

// ─── Rule engine (docs/sc-progression-plan.md §3) ────────────────────────────
//
// One decision for every place that judges an S&C exercise: next session's
// prefill and the end-of-block "next time" summary today, the in-session
// adjustment and the coach's view later. Double progression: reps (or
// seconds) drive it — every set at the top of the range → step up, any set
// under the floor → step down, otherwise hold and add a rep. RPE is optional
// and only refines the call.

export type AmountUnit = "reps" | "seconds"

export interface Target {
  low: number
  high: number
  unit: AmountUnit
}

// What a set is judged against. Rep-counted with a focus → the focus's rep
// range. Otherwise the prescribed amount ("20-30", "10") — timed holds are
// never compared to a rep range. null = nothing to judge against.
export function targetFor(focus: Focus | undefined, prescribed: string | undefined, unit: AmountUnit = "reps"): Target | null {
  if (unit === "reps" && focus) return { ...FOCUS_REP_RANGE[focus], unit }
  const nums = (prescribed ?? "").match(/\d+(\.\d+)?/g)?.map(Number) ?? []
  if (!nums.length) return null
  return { low: Math.min(...nums), high: Math.max(...nums), unit }
}

export interface WorkingSet {
  amount: number   // reps or seconds; both sides → the weaker side
  rpe?: number     // both sides → the harder side
}

export type DecisionReason =
  | "top_of_range"     // every set at the top → step up
  | "in_range"         // hold, add a rep
  | "max_effort"       // every set at the top, but effort was above the band → hold
  | "under_floor"      // a set under the floor → step down
  | "effort_too_high"  // most rated sets above the band → step down
  | "dropped_in_session" // would step up, but the load was lowered mid-session → hold
  | "speed_focus"      // explosiveness: more reps isn't progress → hold (speed is up to the athlete)
  | "no_data"

export interface Decision {
  direction: Direction
  reason: DecisionReason
  target: Target
}

// `droppedInSession`: the session had an automatic easier round (see
// planRoundDrop). Topping out on the easier load doesn't earn a step
// straight back up — next time holds there instead.
export function decideNext(target: Target, sets: WorkingSet[], focus?: Focus, opts: { droppedInSession?: boolean } = {}): Decision {
  const judged = sets.filter((s) => Number.isFinite(s.amount))
  const decision = (direction: Direction, reason: DecisionReason): Decision => ({ direction, reason, target })
  if (judged.length === 0) return decision("hold", "no_data")
  if (judged.some((s) => s.amount < target.low)) return decision("decrease", "under_floor")

  const band = focus ? FOCUS_RPE_BAND[focus] : undefined
  const rated = band ? judged.filter((s) => s.rpe != null && Number.isFinite(s.rpe)) : []
  const overBand = rated.filter((s) => s.rpe! > band!.high).length
  if (rated.length > 0 && overBand > rated.length / 2) return decision("decrease", "effort_too_high")

  // Explosiveness progresses by speed, which the app can't measure — the
  // athlete moves every rep as fast as they can. More reps isn't progress,
  // so it never steps up from reps; its load follows max force instead
  // (planNextForFocus in scNext.ts). Missing the floor or too much effort
  // still steps down: too heavy to move fast.
  if (focus === "explosiveness") return decision("hold", "speed_focus")

  if (judged.every((s) => s.amount >= target.high)) {
    if (overBand > 0) return decision("hold", "max_effort")
    return opts.droppedInSession ? decision("hold", "dropped_in_session") : decision("increase", "top_of_range")
  }
  return decision("hold", "in_range")
}

// ─── Logging helpers (docs/sc-progression-plan.md Phase 4) ──────────────────

// Effort as three words instead of RPE 4–10 (which most athletes can't
// judge), stored as an RPE inside the focus's band so decideNext reads it
// unchanged: Easy = below the band, Solid = mid-band, Max = above it.
export type Effort = "easy" | "solid" | "max"
export const EFFORTS: Effort[] = ["easy", "solid", "max"]
export const EFFORT_LABEL: Record<Effort, string> = { easy: "Easy", solid: "Solid", max: "Max" }

const DEFAULT_RPE_BAND: RpeBand = { low: 7, high: 9 }

export function effortToRpe(effort: Effort, focus?: Focus): number {
  const band = focus ? FOCUS_RPE_BAND[focus] : DEFAULT_RPE_BAND
  if (effort === "easy") return band.low - 1
  if (effort === "max") return band.high + 0.5
  return Math.round(((band.low + band.high) / 2) * 2) / 2
}

// The rep buttons for a target: one under the floor up to one over the
// top ("13+" for 8–12). Anything else goes through "Other".
export function repChoices(target: Target): number[] {
  const from = Math.max(1, Math.floor(target.low) - 1)
  const to = Math.ceil(target.high) + 1
  return Array.from({ length: to - from + 1 }, (_, i) => from + i)
}

// ─── Weight ──────────────────────────────────────────────────────────────────

export type WeightUnit = "kg" | "lb"

const LB_PER_KG = 2.20462

// A logged weight in another unit, rounded to 0.5 (a loadable number).
export function convertWeight(weight: number, from: WeightUnit, to: WeightUnit): number {
  if (from === to) return weight
  const raw = from === "kg" ? weight * LB_PER_KG : weight / LB_PER_KG
  return Math.round(raw * 2) / 2
}

// Smallest jump when the exercise has no `loadStep` of its own.
export const DEFAULT_LOAD_STEP: Record<WeightUnit, number> = { kg: 0.5, lb: 1 }

// Largest change the app suggests at once — in-round banners, next
// session, and deloads alike (coach, 2026-10-06). A coach-set `loadStep`
// above it still wins: a 4 kg kettlebell jump can't be 2.5 kg.
export const MAX_WEIGHT_CHANGE: Record<WeightUnit, number> = { kg: 2.5, lb: 5 }

const WEIGHT_STEP_PCT = 0.05

// ±`pct` (5 %, or 10 % for drops / deloads), kept between the exercise's
// smallest jump (default 0.5 kg) and MAX_WEIGHT_CHANGE (2.5 kg), and a
// whole number of jumps — 5 % of a 4 kg dumbbell used to round to nothing.
export function nextWeight(current: number, direction: Direction, loadStep?: number, unit: WeightUnit = "kg", pct = WEIGHT_STEP_PCT): number {
  if (direction === "hold" || current <= 0) return current
  const step = loadStep && loadStep > 0 ? loadStep : DEFAULT_LOAD_STEP[unit]
  const cap = Math.max(MAX_WEIGHT_CHANGE[unit], step)
  const sign = direction === "increase" ? 1 : -1
  const wanted = Math.min(cap, Math.max(step, current * pct))
  // Whole jumps, rounded down so the cap is never exceeded (at least one).
  const change = Math.max(step, Math.floor(wanted / step + 1e-9) * step)
  return Math.max(0, Math.round((current + sign * change) * 100) / 100)
}

// ─── Inside the session (docs/sc-progression-plan.md §3.3) ──────────────────
//
// A round under the floor makes the next round of that exercise one step
// easier, right away: −10 % weight (at least one loadStep) or one level
// down. Always one step, however many reps short (coach's call). Reaching
// the ceiling changes nothing mid-session — that's next session's call.

const IN_SESSION_DROP_PCT = 0.10

export type RoundLoad =
  | { kind: "weight"; weight: number; loadStep?: number; unit: WeightUnit }
  | { kind: "level"; chain: LevelStep[]; idx: number; usable?: (step: LevelStep) => boolean }

export interface RoundDrop {
  note: string
  // The easier load for the next round — absent when there's nothing to
  // lower (bodyweight, or already the easiest level): the note says what
  // to do instead.
  weight?: number
  level?: LevelStep
  // What it was, for Undo.
  undo?: { weight?: number; level?: LevelStep }
  // Nothing to lower (bodyweight with no ladder, or already the easiest
  // level): the athlete picks an easier exercise for the rest of the block.
  pickEasier?: boolean
  // A suggestion only — nothing changes automatically: an exercise setup
  // ("make it easier: raise the bench", sc-modifications-plan Q5; the
  // "hardest setup" toggle turns off) or a weight ("lower the weight a
  // little: try 18 kg", coach 2026-10-06).
  bannerOnly?: boolean
  // The opposite direction: the round went above the range — make it
  // harder (planRoundRaise). Always banner-only.
  raise?: boolean
}

export function planRoundDrop(target: Target | null, amount: number | undefined, load: RoundLoad, settingEasier?: string): RoundDrop | null {
  if (!target || amount == null || !Number.isFinite(amount) || amount >= target.low) return null
  const noun = target.unit === "seconds" ? " s" : " reps"
  const range = target.low === target.high ? `${target.low}` : `${target.low}–${target.high}`
  const got = `you got ${amount} of ${range}${noun}`
  if (settingEasier) return { note: `Make it easier this round: ${lowerFirst(settingEasier)} — ${got}`, bannerOnly: true }

  if (load.kind === "level") {
    const move = stepLevel(load.chain, load.idx, "decrease", load.usable)
    const from = load.chain[load.idx]
    if (!move || !from || move.index === load.idx) {
      return { note: `${capitalise(got)} on the easiest level — pick an easier exercise for this round`, pickEasier: true }
    }
    return { note: `Easier this round: ${from.name} → ${move.step.name} — ${got}`, level: move.step, undo: { level: from } }
  }
  if (load.weight <= 0) return { note: `${capitalise(got)} — pick an easier exercise for this round`, pickEasier: true }
  // A suggested number, not an automatic change (coach, 2026-10-06).
  const to = nextWeight(load.weight, "decrease", load.loadStep, load.unit, IN_SESSION_DROP_PCT)
  return { note: `Lower the weight a little: try ${to} ${load.unit} — ${got}`, bannerOnly: true }
}

// ─── Wording ─────────────────────────────────────────────────────────────────

// `when`: "last time" for next session's banner, "today" for the summary
// at the end of the block.
export type When = "last time" | "today" | "that day"

export function reasonText(d: Decision, when: When): string {
  const noun = d.target.unit === "seconds" ? "s" : " reps"
  switch (d.reason) {
    case "top_of_range":    return `${d.target.high}${noun} on every set`
    case "max_effort":      return "top of the range, but effort was max"
    case "under_floor":     return `under ${d.target.low}${noun} ${when}`
    case "effort_too_high": return `effort above target ${when}`
    case "dropped_in_session": return `the weight was lowered mid-session ${when}`
    case "speed_focus":     return "keep every rep as fast as you can"
    case "in_range":        return d.target.unit === "seconds" ? "aim for a few more seconds" : "aim for one more rep"
    case "no_data":         return ""
  }
}

const ARROW: Record<Direction, string> = { increase: "▲", decrease: "▼", hold: "" }

// Weight mode. `from` 0 = bodyweight: never "add weight" — there's no
// number to move, so it says what the result means instead.
export function describeWeight(d: Decision, from: number, to: number, unit: WeightUnit, when: When = "last time"): string {
  if (d.reason === "no_data") return ""
  const why = reasonText(d, when)
  if (from > 0 && to !== from) return `${ARROW[d.direction]} ${from} → ${to} ${unit} — ${why}`
  if (from > 0) return `Same weight — ${why}`
  if (d.direction === "increase") return `${capitalise(why)} — ready for a harder version`
  if (d.direction === "decrease") return `${capitalise(why)} — try an easier version`
  return capitalise(why)
}

// Level mode. At either end of the chain nothing moves; the note says so.
export function describeLevel(d: Decision, from: LevelStep, move: LevelMove, when: When = "last time"): string {
  if (d.reason === "no_data") return ""
  const why = reasonText(d, when)
  if (move.step.exerciseId !== from.exerciseId || move.step.name !== from.name) {
    return `${ARROW[d.direction]} ${from.name} → ${move.step.name} — ${why}`
  }
  if (d.direction === "increase") return "Top level reached — stay on this level"
  if (d.direction === "decrease") return "Easiest level — stay on this level"
  return `Same level — ${why}`
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

// A round above the top of the range: tell the athlete right away to make
// it harder — a suggestion, nothing changes automatically.
// - With an exercise setup not at its hardest: the coach's hint ("lower
//   the box height").
// - Weight (no setup, or setup already at its hardest): "add a little
//   weight: try 21 kg" (~5 %, rounded to the weight jump).
// - Ladders without a setup, bodyweight: wait for next session (coach,
//   2026-10-06). Explosiveness never: more reps there isn't the goal.
export interface RaiseLoad {
  settingHarder?: string
  atHardest?: boolean
  weight?: number
  loadStep?: number
  unit: WeightUnit
  level?: boolean   // a ladder exercise
}

export function planRoundRaise(target: Target | null, amount: number | undefined, focus: Focus | undefined, load: RaiseLoad): RoundDrop | null {
  if (!target || focus === "explosiveness") return null
  if (amount == null || !Number.isFinite(amount) || amount <= target.high) return null
  const noun = target.unit === "seconds" ? " s" : " reps"
  const range = target.low === target.high ? `${target.low}` : `${target.low}–${target.high}`
  const got = `you got ${amount} of ${range}${noun}`
  if (load.settingHarder && !load.atHardest) {
    return { note: `Make it harder this round: ${lowerFirst(load.settingHarder)} — ${got}`, bannerOnly: true, raise: true }
  }
  if (load.level || !load.weight || load.weight <= 0) return null
  const to = nextWeight(load.weight, "increase", load.loadStep, load.unit)
  return { note: `Add a little weight: try ${to} ${load.unit} — ${got}`, bannerOnly: true, raise: true }
}

export function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s
}

// A level is a reference to another library exercise, not a free-typed
// label — the same snapshot shape (id + name at the time it was picked) a
// block already uses for its main exercise. `exerciseId` is what matching
// keys off; `name` is only for display.
export interface LevelStep {
  exerciseId: string
  name: string
}

// Level mode: one step along the full chain (see resolveExerciseChain in
// levelChain.ts), from a known position. Clamped at both ends — the result
// says whether it's sitting at the top or bottom, so callers can explain a
// "no move" instead of guessing from a null.
export interface LevelMove {
  index: number
  step: LevelStep
  atTop: boolean
  atBottom: boolean
}

// `usable`: steps that may be moved onto (e.g. tagged for today's focus —
// a negative pull-up can't be done explosively). Unusable steps are skipped
// over; with none left in that direction it stays put.
export function stepLevel(chain: LevelStep[], fromIdx: number, direction: Direction, usable: (step: LevelStep) => boolean = () => true): LevelMove | null {
  if (chain.length === 0) return null
  const from = Math.min(Math.max(fromIdx, 0), chain.length - 1)
  const delta = direction === "increase" ? 1 : direction === "decrease" ? -1 : 0
  let index = from
  for (let i = from + delta; delta !== 0 && i >= 0 && i < chain.length; i += delta) {
    if (usable(chain[i])) { index = i; break }
  }
  const anyUsable = (lo: number, hi: number) => chain.slice(lo, hi).some(usable)
  return { index, step: chain[index], atTop: !anyUsable(index + 1, chain.length), atBottom: !anyUsable(0, index) }
}
