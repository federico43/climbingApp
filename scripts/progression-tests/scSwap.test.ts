// Tests for swapping an S&C exercise mid-workout (utils/scSwap.ts). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/scSwap.test.ts

import assert from "node:assert/strict"
import { isPlanPick, planPickFor, replacePlanPick, swapCandidates, swappedExercise, swapReasonOf } from "@/utils/scSwap"

const row = (over: any) => ({ $createdAt: "", type: "reps", ...over })
const kbSquat = row({ $id: "kb", name: "KB squat", movementType: "squat", loadMode: "weight", loadStep: 2 })
const split = row({ $id: "split", name: "Split squat", type: "both_sides", movementType: "squat", photoUri: "p.jpg" })
const plank = row({ $id: "plank", name: "Plank", unit: "seconds", defaultReps: "30-45", movementType: "core" })
const hipFlexor = row({ $id: "hf", name: "Hip flexor stretch", unit: "seconds", defaultReps: "30", movementType: "mobility" })
const catCow = row({ $id: "cc", name: "Cat cow", defaultReps: "10", movementType: "mobility" })
const hangs = row({ $id: "h", name: "7/3s", type: "7/3s", movementType: "carry_grip" })
const pullUp = row({ $id: "pu", name: "Pull-up", movementType: "pull_vertical", loadMode: "level", levels: [{ exerciseId: "x", name: "X" }] })
const library: any[] = [kbSquat, split, plank, hipFlexor, catCow, hangs, pullUp]

// ── what the swapped exercise looks like ──
const block = { type: "reps" as const, name: "KB squat", exerciseId: "kb", reps: "3-6", unit: "reps" as const, focus: "max_force" as const, movementType: "squat" }
// Same measure: the block's target and focus stay, identity / type / photo come from the pick
let ex: any = swappedExercise(block, split as any)
assert.equal(ex.name, "Split squat")
assert.equal(ex.exerciseId, "split")
assert.equal(ex.type, "both_sides")
assert.equal(ex.reps, "3-6")
assert.equal(ex.focus, "max_force")
assert.equal(ex.photoUri, "p.jpg")
// The pick brings its own ladder
ex = swappedExercise(block, pullUp as any)
assert.equal(ex.loadMode, "level")
assert.equal(ex.levels.length, 1)
// Rep-counted → timed: the pick's own default, focus kept
ex = swappedExercise(block, plank as any)
assert.equal(ex.unit, "seconds")
assert.equal(ex.reps, "30-45")
assert.equal(ex.focus, "max_force")
// Timed → rep-counted: the focus's rep range
ex = swappedExercise({ ...block, reps: "30", unit: "seconds" as const, focus: "hypertrophy" as const }, kbSquat as any)
assert.equal(ex.unit, "reps")
assert.equal(ex.reps, "8-12")
// Mobility ↔ mobility keeps the block's target; strength → mobility uses its default, no focus
const mob = { type: "reps" as const, name: "Cat cow", exerciseId: "cc", reps: "12", unit: "reps" as const, movementType: "mobility" }
ex = swappedExercise(mob, row({ $id: "wd", name: "World's greatest", defaultReps: "6", movementType: "mobility" }) as any)
assert.equal(ex.reps, "12")
ex = swappedExercise(block, hipFlexor as any)
assert.equal(ex.movementType, "mobility")
assert.equal(ex.focus, undefined)
assert.equal(ex.reps, "30")
// Mobility → strength with no focus: the original's target is kept when it's measured the same
ex = swappedExercise(mob, kbSquat as any)
assert.equal(ex.reps, "12")
assert.equal(ex.movementType, "squat")

// ── candidates ──
const ids = (rows: any[]) => rows.map((r) => r.$id)
// never itself, never 7/3s; own pattern first, then by name
assert.deepEqual(ids(swapCandidates(library, ["kb"], "squat")), ["split", "cc", "hf", "plank", "pu"])
// the easier picker leaves out mobility
assert.deepEqual(ids(swapCandidates(library, ["kb"], "squat", {}, true)), ["split", "plank", "pu"])
// search + pattern filter
assert.deepEqual(ids(swapCandidates(library, ["kb"], "squat", { query: "PLAN" })), ["plank"])
assert.deepEqual(ids(swapCandidates(library, ["kb"], "squat", { movementType: "mobility" })), ["cc", "hf"])
assert.deepEqual(ids(swapCandidates(library, ["kb", "split"], "squat", { movementType: "squat" })), [])

// ── reason ──
assert.equal(swapReasonOf({}), null)
assert.equal(swapReasonOf({ swappedFrom: { exerciseName: "KB squat" } }), "easier") // older logs
assert.equal(swapReasonOf({ swappedFrom: { exerciseName: "KB squat" }, swapReason: "choice" }), "choice")

console.log("all scSwap tests passed")

// ── for the rest of the plan ──
const patterns = [
  { movementType: "squat", exerciseIds: ["kb", "split"] },
  { movementType: "push", exerciseIds: ["pu1"] },
  { movementType: "carry_grip", exerciseIds: [] },
]
assert.equal(isPlanPick(patterns, "kb"), true)
assert.equal(isPlanPick(patterns, "mob"), false)
assert.equal(isPlanPick(patterns, undefined), false)
// same slot, other patterns untouched
assert.deepEqual(replacePlanPick(patterns, "kb", "goblet")![0].exerciseIds, ["goblet", "split"])
assert.deepEqual(replacePlanPick(patterns, "split", "goblet")![0].exerciseIds, ["kb", "goblet"])
assert.equal(replacePlanPick(patterns, "kb", "goblet")![1], patterns[1])
// picking the pattern's other exercise leaves just that one
assert.deepEqual(replacePlanPick(patterns, "kb", "split")![0].exerciseIds, ["split"])
// not a pick / no change → null
assert.equal(replacePlanPick(patterns, "mob", "x"), null)
assert.equal(replacePlanPick(patterns, "kb", "kb"), null)

// a ladder step the plan prescribed stands for the pick on its ladder
assert.equal(planPickFor(patterns, "kb"), "kb")
assert.equal(planPickFor(patterns, "step", ["easier", "kb", "step"]), "kb")
assert.equal(planPickFor(patterns, "step", ["easier", "step"]), undefined)
assert.equal(planPickFor(patterns, undefined), undefined)

console.log("all scSwap plan tests passed")
