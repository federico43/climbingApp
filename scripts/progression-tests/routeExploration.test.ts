// Tests for the route exploration (utils/routeExploration.ts) and where the
// training plan puts it (utils/planRotation.ts, utils/planWorkout.ts). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/routeExploration.test.ts

import assert from "node:assert/strict"
import {
  explorationNotes, explorationAllowed, explorationGoes, explorationStartColour, hasExplorationBlock, isMonday, mondayOf,
  nextExplorationColour, summarizeExploration,
} from "@/utils/routeExploration"
import { planEndFor, workoutSpec, type BuiltPlanWorkout, type PlanShape } from "@/utils/planRotation"
import { buildPlanWorkout } from "@/utils/planWorkout"
import { summarizeSpec } from "@/utils/workoutSummary"

// ── start colour: flash, blue at least ──
assert.equal(explorationStartColour(null), "blue")
assert.equal(explorationStartColour("orange"), "blue")
assert.equal(explorationStartColour("yellow"), "yellow")

// ── part 1: up a colour only when all sent ──
const r = (colour: string, sent: boolean, tries = sent ? 1 : 3) => ({ colour, wall: "slab", sent, tries })
assert.equal(nextExplorationColour("blue", [r("blue", true), r("blue", true, 2)]), "green")
assert.equal(nextExplorationColour("blue", [r("blue", true), r("blue", false)]), null)
assert.equal(nextExplorationColour("blue", []), null)
assert.equal(nextExplorationColour("black", [r("black", true)]), null)
assert.equal(explorationGoes([r("blue", true), r("blue", true, 2), r("green", false)]), 6)

// ── summary from the logged attempts ──
const sum = summarizeExploration([
  { success: true, level: "blue", wall: "placa1", tries: 1, part: 1 },
  { success: true, level: "blue", wall: "desplome", tries: 3, part: 1 },
  { success: false, level: "green", wall: "slab", tries: 3, part: 1 },
  { success: true, part: 2, fallReasons: ["beta"], notes: "hips in" },
])
assert.equal(sum.goes, 7)
assert.deepEqual(sum.byColour, [{ colour: "blue", sent: 2, tried: 2 }, { colour: "green", sent: 0, tried: 1 }])
assert.equal(sum.topSent, "blue")
assert.equal(sum.answered, true)
assert.deepEqual(sum.reasons, ["beta"])
assert.equal(summarizeExploration([{ success: false, level: "blue", part: 1 }]).answered, false)

assert.equal(explorationNotes("at *{colour}*. Every {colour}?", "Green"), "at *Green*. Every Green?")

// ── dates ──
assert.equal(isMonday("2026-11-02"), true)
assert.equal(isMonday("2026-11-05"), false)
assert.equal(mondayOf("2026-11-05"), "2026-11-02")
assert.equal(mondayOf("2026-11-08"), "2026-11-02") // Sunday belongs to the week before
assert.equal(mondayOf("2026-11-02"), "2026-11-02")

// ── allowed: not Monday, once a week ──
assert.equal(explorationAllowed("2026-11-02", []), false)
assert.equal(explorationAllowed("2026-11-03", []), true)
assert.equal(explorationAllowed("2026-11-05", [{ day: "2026-11-03", hasExploration: true }]), false)
assert.equal(explorationAllowed("2026-11-05", [{ day: "2026-11-03", hasExploration: false }]), true)
assert.equal(explorationAllowed("2026-11-10", [{ day: "2026-11-05", hasExploration: true }]), true) // last week's
assert.equal(hasExplorationBlock(JSON.stringify([{ type: "route_exploration" }])), true)
assert.equal(hasExplorationBlock(JSON.stringify([{ type: "exploration_session" }])), false)

// ── plan: Fear management only, replaces the constraints ──
const start = "2026-11-02" // a Monday
const fear: PlanShape = {
  windowStart: start, windowEnd: planEndFor(start), focus: "fear_management",
  hasSc: true, hasMobility: false, scPatterns: [{ movementType: "push", exerciseIds: ["p1"] }],
}
const built = (planIndex: number, createdAt: string, blocks: unknown[] = []): BuiltPlanWorkout =>
  ({ planIndex, createdAt, blocks: JSON.stringify(blocks) })
const exploration = [{ type: "route_exploration", blockName: "Route exploration" }]

assert.equal(workoutSpec(fear, 1, [], "2026-11-03").warmup, "exploration")   // Tuesday
assert.equal(workoutSpec(fear, 1, [], "2026-11-02").warmup, "one_on_one_off") // Monday: no new routes yet
// Second of the week, exploration already done Tuesday → 1 on 1 off.
assert.equal(workoutSpec(fear, 2, [built(1, "2026-11-03T15:00:00Z", exploration)], "2026-11-05").warmup, "one_on_one_off")
// Monday then Wednesday: Wednesday gets it.
assert.equal(workoutSpec(fear, 2, [built(1, "2026-11-02T15:00:00Z")], "2026-11-04").warmup, "exploration")
// Rebuilding the same slot doesn't block itself.
assert.equal(workoutSpec(fear, 1, [built(1, "2026-11-03T15:00:00Z", exploration)], "2026-11-03").warmup, "exploration")
// Other focuses keep the constraints.
assert.equal(workoutSpec({ ...fear, focus: "technique" }, 1, [], "2026-11-03").warmup, "constraints")
// Slots further ahead: plain alternation, exploration in the constraints' place.
assert.deepEqual([3, 4].map((i) => workoutSpec(fear, i, [], "2026-11-03").warmup), ["exploration", "one_on_one_off"])

// ── built workout: exploration first, before S&C, no constraints ──
const spec = workoutSpec(fear, 1, [], "2026-11-03")
const w = buildPlanWorkout(fear, spec, [], [{ $id: "p1", name: "Push-ups", movementType: "push" } as any], [], "orange")
assert.equal(w.blocks[0].type, "route_exploration")
assert.equal((w.blocks[0] as any).startColour, "blue")
assert.equal((w.blocks[0] as any).timeLimit, 25)
assert.equal((w.blocks[0] as any).projectTime, 25)
assert.ok(!w.blocks.some((b) => b.type === "constraint_warmup"))
assert.equal(w.blocks.filter((b) => b.type === "route_exploration").length, 1)
// Coach's library copy wins (its notes), colour still from flash.
const lib = [{ $id: "x", name: "Route exploration", type: "route_exploration", data: JSON.stringify({ type: "route_exploration", description: "Coach notes", timeLimit: 20 }) } as any]
const w2 = buildPlanWorkout(fear, spec, lib, [], [], "yellow")
assert.equal((w2.blocks[0] as any).description, "Coach notes")
assert.equal((w2.blocks[0] as any).timeLimit, 20)
assert.equal((w2.blocks[0] as any).startColour, "yellow")

// ── Plan tab summary: exploration phase first ──
const phases = summarizeSpec(spec, fear, [], new Map()).phases
assert.equal(phases[0].title, "Route exploration")
assert.equal(phases[0].minutes, 50)

console.log("routeExploration tests passed")
