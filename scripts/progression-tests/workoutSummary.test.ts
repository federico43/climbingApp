// Tests for workout summaries by phase (utils/workoutSummary.ts —
// docs/redesign.md phase 5). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/workoutSummary.test.ts

import assert from "node:assert/strict"
import { buildDurationHistory, estimateBlockSeconds, summarizeBlocks, summarizeSpec } from "@/utils/workoutSummary"

const empty = new Map<string, number[]>()

// ── estimates from settings ──
assert.equal(estimateBlockSeconds({ type: "project_bouldering", targetAttempts: 5, restTime: 240 }, empty), 5 * 300)
assert.equal(estimateBlockSeconds({ type: "four_by_four", sets: 4, bouldersPerSet: 4, restTime: 240 }, empty), 4 * (240 + 240))
assert.equal(estimateBlockSeconds({ type: "intervals", series: 4, workTime: 60, restTime: 60 }, empty), 480)
assert.equal(estimateBlockSeconds({ type: "free_session", timeLimit: 25 }, empty), 1500)
assert.equal(estimateBlockSeconds({ type: "exploration_session" }, empty), 1200) // no limit → 20 min

// ── history wins: median by name; by type only for S&C / constraints ──
const history = buildDurationHistory([
  { protocol: JSON.stringify([{ type: "project_bouldering", blockName: "Project Bouldering" }, { type: "strength_conditioning", blockName: "S&C 1" }]),
    blockDurations: JSON.stringify({ 0: 2000, 1: 900 }) },
  { protocol: JSON.stringify([{ type: "project_bouldering", blockName: "project bouldering " }, { type: "strength_conditioning", blockName: "S&C 1" }]),
    blockDurations: JSON.stringify({ 0: 2400, 1: 30 }) }, // 30 s = skipped → ignored
  { protocol: JSON.stringify([{ type: "project_bouldering", blockName: "Other" }]), blockDurations: JSON.stringify({ 0: 600 }) },
])
assert.equal(estimateBlockSeconds({ type: "project_bouldering", blockName: "Project Bouldering" }, history), 2200)
assert.equal(estimateBlockSeconds({ type: "strength_conditioning", blockName: "Mobility", rounds: 3, exercises: [] }, history), 900)
// A different project block isn't timed from other project blocks
assert.equal(estimateBlockSeconds({ type: "project_bouldering", blockName: "New one", targetAttempts: 2, restTime: 60 }, history), 240)

// ── phases ──
const sc = (name: string, n: number) => ({ type: "strength_conditioning", blockName: name, rounds: 3, restBetweenRounds: 60,
  exercises: Array.from({ length: n }, () => ({ focus: "max_force" })) })
const s = summarizeBlocks([
  sc("S&C 1", 3), sc("S&C 2", 3),
  { type: "constraint_warmup", blockName: "Silent feet", targetAttempts: 3 },
  { type: "constraint_warmup", blockName: "Sloth", targetAttempts: 2, adaptation: "strength" },
  { type: "project_bouldering", blockName: "Project Bouldering", targetAttempts: 5, restTime: 240 },
  { type: "project_bouldering", blockName: "Project Bouldering", targetAttempts: 5, restTime: 240 },
], empty)
assert.deepEqual(s.phases.map((p) => p.key), ["sc", "warmup", "main"])
assert.equal(s.phases[0].title, "Max force")
assert.equal(s.phases[0].detail, "6 exercises · 3 rounds")
assert.equal(s.phases[1].title, "2 constraints")
assert.equal(s.phases[1].detail, "Silent feet · Sloth")
assert.equal(s.phases[2].title, "Project Bouldering ×2")
assert.equal(s.phases[2].detail, "5 attempts each")
assert.equal(s.phases[2].adaptation, "strength")
assert.equal(s.minutes, s.phases.reduce((t, p) => t + p.minutes, 0))
assert.ok(s.phases.every((p) => p.minutes % 5 === 0 && p.minutes >= 5))

// Density test + untagged 1 on 1 off warm-up
const t = summarizeBlocks([
  { type: "exploration_session", blockName: "Density test", timeLimit: 20 },
  { type: "intervals", blockName: "1 on 1 off", kind: "warmup", series: 4, workTime: 60, restTime: 60 },
], empty)
assert.deepEqual(t.phases.map((p) => [p.key, p.adaptation]), [["test", "test"], ["warmup", "general"]])

// ── upcoming, from the rotation ──
const library: any[] = [
  { $id: "1", $createdAt: "", name: "Power boulders", type: "free_session", data: JSON.stringify({ timeLimit: 25 }) },
  { $id: "2", $createdAt: "", name: "1 on 1 off", type: "intervals", data: JSON.stringify({ series: 4, workTime: 60, restTime: 60 }) },
]
const spec: any = { index: 3, mainType: "power", mainBlock: { name: "Power boulders", type: "free_session" },
  warmup: "one_on_one_off", scFocus: "explosiveness", exerciseSlot: 0, withTest: false }
const u = summarizeSpec(spec, { focus: "technique", hasMobility: true, scPatterns: [1, 2, 3, 4] }, library, empty)
assert.deepEqual(u.phases.map((p) => p.key), ["sc", "warmup", "main"])
assert.equal(u.phases[0].title, "Explosiveness")
assert.equal(u.phases[0].detail, "4 exercises + mobility · 3 rounds")
assert.equal(u.phases[1].title, "1 on 1 off")
assert.equal(u.phases[2].title, "Power boulders ×2")
assert.equal(u.phases[2].minutes, 50)
assert.equal(u.phases[2].adaptation, "power")

// Constraint warm-up takes the plan's focus colour; no S&C when the plan has none
const c = summarizeSpec({ ...spec, warmup: "constraints", scFocus: null }, { focus: "technique", hasMobility: false, scPatterns: [] }, library, empty)
assert.deepEqual(c.phases.map((p) => [p.key, p.adaptation, p.title]), [["warmup", "technique", "3 constraints"], ["main", "power", "Power boulders ×2"]])

console.log("workoutSummary: all tests passed")
