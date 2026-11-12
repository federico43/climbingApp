import type { BlockType } from "@/components/workoutBlocks"
import type { MovementType } from "@/utils/movementTypes"
import { FOCUS_LABEL, type Focus } from "@/utils/scProgression"
import { pausedDayCount, planClockDate, type PlanPause } from "@/utils/planPauses"
import { explorationAllowed, hasExplorationBlock } from "@/utils/routeExploration"

// The training plan's fixed rotation (docs/training-plan.md §9): what
// workout n of a plan is — main type, main block, warm-up kind, S&C focus,
// which of each pattern's two exercises, and whether the Density test goes
// in. Pure: the plan, the plan's already-built workouts and today's date in,
// a spec out. Turning a spec into blocks is utils/planWorkout.ts.

export type PlanFocus = "strength" | "power_endurance" | "power" | "technique" | "fear_management"
export type MainType = "strength" | "power_endurance" | "power"

export const PLAN_FOCUSES: PlanFocus[] = ["strength", "power_endurance", "power", "technique", "fear_management"]
export const PLAN_FOCUS_LABEL: Record<PlanFocus, string> = {
  strength: "Strength",
  power_endurance: "Power endurance",
  power: "Power",
  technique: "Technique",
  fear_management: "Mental",
}

// What a plan trains. "climbing": the full workout (warm-up, main climbing
// block, S&C). "conditioning": for athletes who can't climb — S&C (and
// mobility) only, no climbing focus, warm-up, main block or Density test
// (coach 2026-11-09). Conditioning is where cardio (jump rope) goes next;
// it keeps its own plan, see docs/conditioning-plan.md.
export type PlanKind = "climbing" | "conditioning"
export const DEFAULT_PLAN_KIND: PlanKind = "climbing"

export function isConditioningOnly(plan: { kind?: PlanKind | null }): boolean {
  return plan.kind === "conditioning"
}

// A plan the rotation can run: conditioning plans have no climbing focus;
// climbing plans need one (plans made before v2 don't have it).
export function canRotate(plan: { kind?: PlanKind | null; focus: PlanFocus | null }): boolean {
  return isConditioningOnly(plan) || !!plan.focus
}

// S&C patterns per plan: 1 to 4 (coach 2026-10-03: exactly 4; 2026-11-04:
// at least 1). A plan with mobility can also have none — mobility only.
export const SC_PATTERN_MAX = 4
// Conditioning plans: S&C is the whole workout, so up to 6 — 3 blocks of
// two (coach 2026-11-09).
export const SC_PATTERN_MAX_CONDITIONING = 6

export function scPatternMax(kind?: PlanKind | null): number {
  return kind === "conditioning" ? SC_PATTERN_MAX_CONDITIONING : SC_PATTERN_MAX
}
export const SC_PATTERN_MIN = 1
export const EXERCISES_PER_PATTERN = 2

export interface ScPattern {
  movementType: MovementType
  exerciseIds: string[] // 1–2 library exercise ids; empty for fingers (fixed exercises)
}

// The parts of a training plan the rotation reads (TrainingPlanRow has them all).
export interface PlanShape {
  windowStart: string // "YYYY-MM-DD"
  windowEnd: string   // "YYYY-MM-DD"
  // Missing / null = climbing.
  kind?: PlanKind | null
  // The climbing focus; null only on conditioning plans (see canRotate).
  focus: PlanFocus | null
  hasSc: boolean // always true on conditioning plans
  hasMobility: boolean
  // Mobility exercises the coach chose; missing / empty = the app picks from
  // the whole library.
  mobilityIds?: string[]
  // S&C focuses the coach left on (coach 2026-11-12); missing / empty = all
  // three. A workout whose focus is off uses the next one on (effectiveFocus).
  scFocuses?: Focus[] | null
  scPatterns: ScPattern[]
  // Main type of workout 1; the cycle carries on from it. Missing / null =
  // strength, so plans made before it existed keep their rotation.
  startType?: MainType | null
  // Weeks the coach paused the plan (utils/planPauses.ts).
  pauses?: PlanPause[]
}

// A workout already built from this plan (a protocol row with planId set).
export interface BuiltPlanWorkout {
  planIndex: number
  createdAt: string // ISO timestamp
  blocks?: string   // the row's blocks JSON — which main block it really uses
}

export interface LibraryBlockRef { name: string; type: BlockType }

export interface WorkoutSpec {
  index: number // 1-based position in the plan
  // Still cycles on conditioning plans: it sets the day's S&C focus.
  mainType: MainType
  mainBlock: LibraryBlockRef | null // null on conditioning plans (no climbing)
  // "exploration": route exploration, Fear management plans only — first in
  // the workout, before S&C (utils/routeExploration.ts). "none":
  // conditioning plans (the warm-ups are climbing).
  warmup: WarmupKind
  scFocus: Focus | null       // null when the plan has no S&C
  exerciseSlot: 0 | 1         // which of each pattern's two exercises
  withTest: boolean
}

export type WarmupKind = "constraints" | "one_on_one_off" | "exploration" | "none"

export const PLAN_WEEKS = 6
export const WORKOUTS_PER_WEEK = 2
export const PLAN_WORKOUTS = PLAN_WEEKS * WORKOUTS_PER_WEEK

export const MAIN_CYCLE: MainType[] = ["strength", "power_endurance", "power"]
export const DEFAULT_START_TYPE: MainType = "strength"

// Library blocks per main type, in the order they alternate. Matched by name
// AND type ("Base 1" once existed as both a sequence and a free session).
export const MAIN_BLOCKS: Record<MainType, LibraryBlockRef[]> = {
  strength: [
    { name: "Project Bouldering", type: "project_bouldering" },
    { name: "Max bouldering", type: "sequence" },
  ],
  power_endurance: [
    { name: "Power endurance - 4x4", type: "four_by_four" },
    { name: "Base 1", type: "sequence" },
  ],
  power: [{ name: "Power boulders", type: "free_session" }],
}

// Every workout runs its main block twice, back to back (coach 2026-10-04).
export const MAIN_BLOCK_COPIES = 2

// Main blocks that run differently from the × MAIN_BLOCK_COPIES default:
// Max bouldering is 3 blocks of 15 minutes each (coach 2026-11-10).
export interface MainBlockRun { copies: number; timeLimit?: number }
const MAIN_BLOCK_RUNS: { ref: LibraryBlockRef; run: MainBlockRun }[] = [
  { ref: { name: "Max bouldering", type: "sequence" }, run: { copies: 3, timeLimit: 15 } },
]

export function mainBlockRun(ref: LibraryBlockRef): MainBlockRun {
  return MAIN_BLOCK_RUNS.find((r) => sameRef(r.ref, ref))?.run ?? { copies: MAIN_BLOCK_COPIES }
}

// A second block that follows the main block's copies, also × MAIN_BLOCK_COPIES:
// Power days are 2 Power boulders + 2 Coordination boulders (coach 2026-11-09).
export const COORDINATION_BLOCK: LibraryBlockRef = { name: "Coordination boulders", type: "free_session" }
export const MAIN_COMPANION_BLOCK: Partial<Record<MainType, LibraryBlockRef>> = {
  power: COORDINATION_BLOCK,
}

export const WARMUP_INTERVALS_BLOCK: LibraryBlockRef = { name: "1 on 1 off", type: "intervals" }
export const TEST_BLOCK: LibraryBlockRef = { name: "Density test", type: "exploration_session" }
// Library copy of the route exploration, if the coach saved one (its notes
// win); otherwise the app's default block is used.
export const EXPLORATION_BLOCK: LibraryBlockRef = { name: "Route exploration", type: "route_exploration" }

// S&C focus is tied to the day's main type (coach 2026-10-03).
export const SC_FOCUS_FOR: Record<MainType, Focus> = {
  strength: "max_force",
  power_endurance: "hypertrophy",
  power: "explosiveness",
}

// How a workout's type reads to people: the climbing type, or on a
// conditioning plan the S&C focus it sets (Max force / Hypertrophy /
// Explosiveness).
export function mainTypeLabel(mainType: MainType, kind?: PlanKind | null, scFocuses?: Focus[] | null): string {
  return kind === "conditioning" ? FOCUS_LABEL[effectiveFocus(SC_FOCUS_FOR[mainType], scFocuses)] : PLAN_FOCUS_LABEL[mainType]
}

// Core and the joint patterns never train explosiveness (coach 2026-10-21,
// 2026-11-04): they have their own cycle, max force ↔ hypertrophy, whatever
// the day's S&C focus. It flips every week, so each of the pattern's two
// exercises (one per workout of the week) alternates max force →
// hypertrophy → max force … on its own.
export const NO_POWER_FOCUS_CYCLE: Focus[] = ["max_force", "hypertrophy"]

// `enabled`: the plan's S&C focuses on (scFocuses); the cycle keeps only
// those. If neither max force nor hypertrophy is on (only explosiveness),
// these patterns stay on max force — they never train explosiveness.
export function noPowerFocusFor(index: number, enabled?: Focus[] | null): Focus {
  const on = enabled && enabled.length ? NO_POWER_FOCUS_CYCLE.filter((f) => enabled.includes(f)) : NO_POWER_FOCUS_CYCLE
  const cycle = on.length ? on : ["max_force" as Focus]
  return cycle[Math.floor((index - 1) / WORKOUTS_PER_WEEK) % cycle.length]
}

// When the coach turns a focus off, its workouts use the next one that's on
// (coach 2026-11-12, option A): Hypertrophy → Max force → Explosiveness,
// Max force → Hypertrophy → Explosiveness, Explosiveness → Max force →
// Hypertrophy. Missing / empty `enabled` = all on.
const FOCUS_FALLBACK: Record<Focus, Focus[]> = {
  hypertrophy: ["max_force", "explosiveness"],
  max_force: ["hypertrophy", "explosiveness"],
  explosiveness: ["max_force", "hypertrophy"],
}

export function effectiveFocus(planned: Focus, enabled?: Focus[] | null): Focus {
  if (!enabled || enabled.length === 0 || enabled.includes(planned)) return planned
  return FOCUS_FALLBACK[planned].find((f) => enabled.includes(f)) ?? planned
}

// Core's name for the same cycle.
export const CORE_FOCUS_CYCLE = NO_POWER_FOCUS_CYCLE
export const coreFocusFor = noPowerFocusFor

// ─── Dates ───────────────────────────────────────────────────────────────────

// "YYYY-MM-DD" in the device's own timezone (not UTC — a late-evening
// workout must land on the day it happened).
export function localDateStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function dayNumber(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86400000)
}

export function addDays(dateStr: string, days: number): string {
  return new Date((dayNumber(dateStr) + days) * 86400000).toISOString().slice(0, 10)
}

// A plan's end date: PLAN_WEEKS full weeks from its start, inclusive, plus
// the days it's paused.
export function planEndFor(windowStart: string, pauses?: PlanPause[]): string {
  return addDays(windowStart, PLAN_WEEKS * 7 - 1 + pausedDayCount(pauses ?? []))
}

// 1-based week of the plan a date falls in (can be < 1 or > PLAN_WEEKS).
// Paused days don't count: the week stands still during a pause.
export function planWeek(windowStart: string, dateStr: string, pauses?: PlanPause[]): number {
  return Math.floor((dayNumber(planClockDate(pauses, dateStr)) - dayNumber(windowStart)) / 7) + 1
}

// The plan's last week (week 6 for a standard plan).
function lastWeek(plan: PlanShape): number {
  return planWeek(plan.windowStart, plan.windowEnd, plan.pauses)
}

// ─── Rotation ────────────────────────────────────────────────────────────────

export function nextPlanIndex(built: BuiltPlanWorkout[]): number {
  return built.reduce((max, w) => Math.max(max, w.planIndex), 0) + 1
}

// Plans end at their end date even if fewer than 12 were built
// (coach 2026-10-03), or once all 12 are built.
export function planIsOver(plan: Pick<PlanShape, "windowEnd">, built: BuiltPlanWorkout[], today: string): boolean {
  return today > plan.windowEnd || nextPlanIndex(built) > PLAN_WORKOUTS
}

// Main type of workout `index`: the fixed cycle, starting at the plan's
// start type (strength unless the coach picked another).
export function mainTypeFor(index: number, startType?: MainType | null): MainType {
  const offset = Math.max(0, MAIN_CYCLE.indexOf(startType ?? DEFAULT_START_TYPE))
  return MAIN_CYCLE[(index - 1 + offset) % MAIN_CYCLE.length]
}

// First workout index of a main type, given the start type.
function firstIndexOf(mainType: MainType, startType?: MainType | null): number {
  const offset = Math.max(0, MAIN_CYCLE.indexOf(startType ?? DEFAULT_START_TYPE))
  return ((MAIN_CYCLE.indexOf(mainType) - offset + MAIN_CYCLE.length) % MAIN_CYCLE.length) + 1
}

// Main type of a built plan workout, without its plan: from the main block it
// uses, else the default cycle (plans that start with strength). Use
// hasBuiltMainBlock first where a workout without a climbing block (a
// conditioning plan's) shouldn't get a climbing label.
export function hasBuiltMainBlock(blocksJson: string | undefined): boolean {
  return MAIN_CYCLE.some((t) => builtMainBlock(t, blocksJson) !== null)
}

export function builtMainType(planIndex: number, blocksJson: string | undefined): MainType {
  for (const t of MAIN_CYCLE) if (builtMainBlock(t, blocksJson)) return t
  return mainTypeFor(planIndex)
}

const sameRef = (a: LibraryBlockRef, b: LibraryBlockRef) =>
  a.type === b.type && a.name.trim().toLowerCase() === b.name.trim().toLowerCase()

// The main block a built workout actually uses: its first block matching one
// of its main type's library blocks (by name + type — "Base 1" is a sequence
// AND a free session). null when the coach replaced it with something else.
export function builtMainBlock(mainType: MainType, blocksJson: string | undefined): LibraryBlockRef | null {
  if (!blocksJson) return null
  let blocks: any[] = []
  try { blocks = JSON.parse(blocksJson) } catch { return null }
  if (!Array.isArray(blocks)) return null
  for (const b of blocks) {
    if (typeof b?.blockName !== "string" || typeof b?.type !== "string") continue
    const hit = MAIN_BLOCKS[mainType].find((ref) => sameRef(ref, { name: b.blockName, type: b.type }))
    if (hit) return hit
  }
  return null
}

// The other main block of the same type (Project ↔ Max, 4×4 ↔ Base 1);
// null when the type has only one (Power).
export function alternateMainBlock(mainType: MainType, current: LibraryBlockRef): LibraryBlockRef | null {
  const blocks = MAIN_BLOCKS[mainType]
  if (blocks.length < 2) return null
  const i = blocks.findIndex((b) => sameRef(b, current))
  return blocks[(i + 1) % blocks.length]
}

// Workout n's main block, from what earlier workouts of its type really used
// (not its position in the cycle), so a swap — or a block changed by hand in
// the builder — fixes the rest of the rotation by itself: the block used
// fewer times so far; on a tie, not the one used last; at the start, the
// first in MAIN_BLOCKS. Earlier slots not built yet count with the block
// this same rule gives them.
function mainBlockFor(index: number, built: BuiltPlanWorkout[], startType?: MainType | null): LibraryBlockRef {
  const mainType = mainTypeFor(index, startType)
  const blocks = MAIN_BLOCKS[mainType]
  // Newest build per slot (a slot can be rebuilt).
  const bySlot = new Map<number, BuiltPlanWorkout>()
  for (const w of built) {
    const prev = bySlot.get(w.planIndex)
    if (!prev || w.createdAt > prev.createdAt) bySlot.set(w.planIndex, w)
  }
  const uses = blocks.map(() => 0)
  let last = -1
  let pick = 0
  for (let n = firstIndexOf(mainType, startType); n <= index; n += MAIN_CYCLE.length) {
    pick = 0
    for (let i = 1; i < blocks.length; i++) {
      if (uses[i] < uses[pick] || (uses[i] === uses[pick] && pick === last)) pick = i
    }
    if (n === index) break
    const used = builtMainBlock(mainType, bySlot.get(n)?.blocks)
    const u = used ? blocks.findIndex((b) => sameRef(b, used)) : pick
    uses[u]++
    last = u
  }
  return blocks[pick]
}

// The warm-up of workout `index`. Constraints and 1 on 1 off alternate
// (odd, even). Fear management plans swap the constraints for the route
// exploration (coach 2026-11-05), once a week and never on a Monday — the
// day the new routes are set: the next workout gets it when allowed today,
// otherwise 1 on 1 off. Slots further ahead keep the plain alternation.
function warmupFor(plan: PlanShape, index: number, built: BuiltPlanWorkout[], today: string): WarmupKind {
  const alternate: WarmupKind = index % 2 === 1 ? "constraints" : "one_on_one_off"
  if (plan.focus !== "fear_management") return alternate
  if (index > nextPlanIndex(built)) return alternate === "constraints" ? "exploration" : alternate
  const others = built
    .filter((w) => w.planIndex !== index) // a slot being rebuilt doesn't count against itself
    .map((w) => ({ day: localDateStr(new Date(w.createdAt)), hasExploration: hasExplorationBlock(w.blocks) }))
  return explorationAllowed(today, others) ? "exploration" : "one_on_one_off"
}

export function workoutSpec(plan: PlanShape, index: number, built: BuiltPlanWorkout[], today: string): WorkoutSpec {
  const mainType = mainTypeFor(index, plan.startType)
  // No climbing: S&C only, on the same focus cycle (no Density test either,
  // it's a climbing test).
  if (isConditioningOnly(plan)) {
    return {
      index,
      mainType,
      mainBlock: null,
      warmup: "none",
      scFocus: effectiveFocus(SC_FOCUS_FOR[mainType], plan.scFocuses),
      exerciseSlot: ((index - 1) % WORKOUTS_PER_WEEK) as 0 | 1,
      withTest: false,
    }
  }

  // Density test: the first workout, and the first one built in the plan's
  // last week — workout 12 may never happen, since the plan ends at its date.
  const final = lastWeek(plan)
  const weekOf = (date: string) => planWeek(plan.windowStart, date, plan.pauses)
  const finalWeekTaken = built.some((w) => weekOf(localDateStr(new Date(w.createdAt))) >= final)
  const withTest = index === 1 || (weekOf(today) >= final && !finalWeekTaken)

  return {
    index,
    mainType,
    mainBlock: mainBlockFor(index, built, plan.startType),
    warmup: warmupFor(plan, index, built, today),
    scFocus: plan.hasSc ? effectiveFocus(SC_FOCUS_FOR[mainType], plan.scFocuses) : null,
    exerciseSlot: ((index - 1) % WORKOUTS_PER_WEEK) as 0 | 1,
    withTest,
  }
}
