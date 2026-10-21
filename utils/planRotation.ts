import type { BlockType } from "@/components/workoutBlocks"
import type { MovementType } from "@/utils/movementTypes"
import type { Focus } from "@/utils/scProgression"

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
  fear_management: "Fear management",
}

// S&C patterns per plan: exactly this many (coach 2026-10-03).
export const SC_PATTERN_COUNT = 4
export const EXERCISES_PER_PATTERN = 2

export interface ScPattern {
  movementType: MovementType
  exerciseIds: string[] // 1–2 library exercise ids; empty for fingers (fixed exercises)
}

// The parts of a training plan the rotation reads (TrainingPlanRow has them all).
export interface PlanShape {
  windowStart: string // "YYYY-MM-DD"
  windowEnd: string   // "YYYY-MM-DD"
  focus: PlanFocus
  hasSc: boolean
  hasMobility: boolean
  scPatterns: ScPattern[]
  // Main type of workout 1; the cycle carries on from it. Missing / null =
  // strength, so plans made before it existed keep their rotation.
  startType?: MainType | null
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
  mainType: MainType
  mainBlock: LibraryBlockRef
  warmup: "constraints" | "one_on_one_off"
  scFocus: Focus | null       // null when the plan has no S&C
  exerciseSlot: 0 | 1         // which of each pattern's two exercises
  withTest: boolean
}

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

export const WARMUP_INTERVALS_BLOCK: LibraryBlockRef = { name: "1 on 1 off", type: "intervals" }
export const TEST_BLOCK: LibraryBlockRef = { name: "Density test", type: "exploration_session" }

// S&C focus is tied to the day's main type (coach 2026-10-03).
export const SC_FOCUS_FOR: Record<MainType, Focus> = {
  strength: "max_force",
  power_endurance: "hypertrophy",
  power: "explosiveness",
}

// Core never trains explosiveness (coach 2026-10-21): it has its own cycle,
// max force ↔ hypertrophy, whatever the day's S&C focus. It flips every
// week, so each of the pattern's two exercises (one per workout of the week)
// alternates max force → hypertrophy → max force … on its own.
export const CORE_FOCUS_CYCLE: Focus[] = ["max_force", "hypertrophy"]

export function coreFocusFor(index: number): Focus {
  return CORE_FOCUS_CYCLE[Math.floor((index - 1) / WORKOUTS_PER_WEEK) % CORE_FOCUS_CYCLE.length]
}

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

// A plan's end date: PLAN_WEEKS full weeks from its start, inclusive.
export function planEndFor(windowStart: string): string {
  return addDays(windowStart, PLAN_WEEKS * 7 - 1)
}

// 1-based week of the plan a date falls in (can be < 1 or > PLAN_WEEKS).
export function planWeek(windowStart: string, dateStr: string): number {
  return Math.floor((dayNumber(dateStr) - dayNumber(windowStart)) / 7) + 1
}

// The plan's last week (week 6 for a standard plan).
function lastWeek(plan: PlanShape): number {
  return planWeek(plan.windowStart, plan.windowEnd)
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
// uses, else the default cycle (plans that start with strength).
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

export function workoutSpec(plan: PlanShape, index: number, built: BuiltPlanWorkout[], today: string): WorkoutSpec {
  const mainType = mainTypeFor(index, plan.startType)

  // Density test: the first workout, and the first one built in the plan's
  // last week — workout 12 may never happen, since the plan ends at its date.
  const final = lastWeek(plan)
  const finalWeekTaken = built.some((w) => planWeek(plan.windowStart, localDateStr(new Date(w.createdAt))) >= final)
  const withTest = index === 1 || (planWeek(plan.windowStart, today) >= final && !finalWeekTaken)

  return {
    index,
    mainType,
    mainBlock: mainBlockFor(index, built, plan.startType),
    warmup: index % 2 === 1 ? "constraints" : "one_on_one_off",
    scFocus: plan.hasSc ? SC_FOCUS_FOR[mainType] : null,
    exerciseSlot: ((index - 1) % WORKOUTS_PER_WEEK) as 0 | 1,
    withTest,
  }
}
