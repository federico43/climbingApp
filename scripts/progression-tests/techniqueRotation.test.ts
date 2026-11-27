// Tests for technique modules in the plan rotation (utils/planRotation.ts,
// utils/planWorkout.ts, utils/workoutSummary.ts, utils/sessionTasks.ts —
// docs/technique-modules.md). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/techniqueRotation.test.ts

import assert from "node:assert/strict"
import { planEndFor, planTechniqueModule, swappedWarmup, workoutSpec, type PlanShape } from "@/utils/planRotation"
import { buildPlanWorkout, techniqueModuleDraft } from "@/utils/planWorkout"
import { summarizeBlocks, summarizeSpec } from "@/utils/workoutSummary"
import { taskInsertIndex } from "@/utils/sessionTasks"
import { FOOTWORK, moduleStandIn } from "@/utils/techniqueModules"

const start = "2026-12-07"
const base: PlanShape = {
  windowStart: start, windowEnd: planEndFor(start), focus: "technique",
  hasSc: false, hasMobility: false, scPatterns: [],
}
const withModule: PlanShape = { ...base, techniqueModuleId: "footwork" }
const warmups = (plan: PlanShape) => Array.from({ length: 6 }, (_, i) => workoutSpec(plan, i + 1, [], start).warmup)

// ── which plans get the module ──
assert.equal(planTechniqueModule(withModule), FOOTWORK)
assert.equal(planTechniqueModule(base), null)
assert.equal(planTechniqueModule({ ...withModule, techniqueModuleId: "nope" }), null)
assert.equal(planTechniqueModule({ ...withModule, focus: "power" }), null) // module left on a plan that's no longer Technique

// ── rotation: the module takes the constraints' place on odd workouts ──
assert.deepEqual(warmups(withModule), ["module", "one_on_one_off", "module", "one_on_one_off", "module", "one_on_one_off"])
assert.deepEqual(warmups(base), ["constraints", "one_on_one_off", "constraints", "one_on_one_off", "constraints", "one_on_one_off"])
assert.deepEqual(warmups({ ...withModule, focus: "power" }), ["constraints", "one_on_one_off", "constraints", "one_on_one_off", "constraints", "one_on_one_off"])

// ── the coach's ⇄ ──
assert.equal(swappedWarmup(withModule, "module"), "one_on_one_off")
assert.equal(swappedWarmup(withModule, "one_on_one_off"), "module")
assert.equal(swappedWarmup(base, "one_on_one_off"), "constraints")
assert.equal(swappedWarmup(base, "constraints"), "one_on_one_off")
assert.equal(swappedWarmup({ ...base, focus: "fear_management" }, "one_on_one_off"), "exploration")
assert.equal(swappedWarmup({ ...base, focus: "fear_management" }, "exploration"), "one_on_one_off")

// ── the built workout ──
const row = (id: string, type: string, name: string, data: any = {}) => ({ $id: id, $createdAt: "", type, name, data: JSON.stringify({ type, blockName: name, ...data }) })
const library: any[] = [
  row("pb", "project_bouldering", "Project Bouldering"),
  row("44", "four_by_four", "Power endurance - 4x4"),
  row("dt", "exploration_session", "Density test"),
  row("io", "intervals", "1 on 1 off", { series: 8, workTime: 30, restTime: 60 }),
  row("sf", "constraint_warmup", "Silent Feet"), row("fm", "constraint_warmup", "foot moves"), row("of", "constraint_warmup", "One foot only"),
]
const types = (w: { blocks: any[] }) => w.blocks.map((b) => b.type)

let w = buildPlanWorkout(withModule, workoutSpec(withModule, 1, [], start), library, [], [], "green")
assert.deepEqual(w.warnings, [])
assert.deepEqual(types(w), ["technique_module", "project_bouldering", "project_bouldering"])
assert.deepEqual(w.blocks[0], {
  type: "technique_module", blockName: "Footwork module", description: FOOTWORK.goal,
  moduleId: "footwork", timeLimit: 20, adaptation: "technique",
})
// workout 2 keeps 1 on 1 off
w = buildPlanWorkout(withModule, workoutSpec(withModule, 2, [], start), library, [], [], "green")
assert.deepEqual(types(w), ["intervals", "four_by_four", "four_by_four"])
// no module → the 3 constraints, as before
w = buildPlanWorkout(base, workoutSpec(base, 1, [], start), library, [], [], "green")
assert.deepEqual(types(w), ["constraint_warmup", "constraint_warmup", "constraint_warmup", "project_bouldering", "project_bouldering"])
// a "module" warm-up on a plan without one falls back to the constraints, with a warning
w = buildPlanWorkout(base, { ...workoutSpec(base, 1, [], start), warmup: "module" }, library, [], [], "green")
assert.equal(types(w).filter((t) => t === "constraint_warmup").length, 3)
assert.equal(w.warnings.length, 1)

// ── summaries ──
const empty = new Map<string, number[]>()
const spec1 = workoutSpec(withModule, 1, [], start)
const up = summarizeSpec(spec1, withModule, library, empty)
assert.deepEqual(up.phases.map((p) => [p.key, p.title, p.minutes]), [["warmup", "Footwork module", 20], ["main", "Project Bouldering ×2", 40]])
assert.equal(up.phases[0].adaptation, "technique")
const built = summarizeBlocks([techniqueModuleDraft(FOOTWORK), { type: "project_bouldering", blockName: "Project Bouldering", timeLimit: 20 }], empty)
assert.deepEqual(built.phases.map((p) => [p.key, p.title]), [["warmup", "Footwork module"], ["main", "Project Bouldering"]])

// ── next-session tasks go after the module, like after the constraints ──
assert.equal(taskInsertIndex([{ type: "strength_conditioning" }, techniqueModuleDraft(FOOTWORK), { type: "project_bouldering" }]), 2)

// ── stand-in runner until the module screen exists ──
const stand = moduleStandIn(FOOTWORK)
assert.equal(stand.type, "free_session")
assert.equal(stand.blockName, "Footwork module")
assert.equal(stand.timeLimit, 20)
assert.equal(stand.notePrompt, FOOTWORK.reflection.question)
assert.ok(stand.description.includes(FOOTWORK.levels[0].rule))

console.log("techniqueRotation: all tests passed")
