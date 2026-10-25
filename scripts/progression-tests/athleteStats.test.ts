// Tests for the coach Stats card's change rules (utils/athleteStats.ts —
// docs/athlete-stats.md). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/athleteStats.test.ts

import assert from "node:assert/strict"
import { statChange, type StatMetric } from "@/utils/athleteStats"

const m = (unit: StatMetric["unit"], values: number[], planned?: number): StatMetric => ({
  id: "x", label: "X", unit, planned,
  points: values.map((value, i) => ({ label: `W${i + 1}`, value })),
})

// kg: percentage change
assert.deepEqual(statChange(m("kg", [38, 40, 42])), { trend: "up", value: "42 kg", from: "was 38 kg", delta: "▲ 11%" })
assert.equal(statChange(m("kg", [30, 26]))?.delta, "▼ 13%")
// added kg: absolute change, signed values
assert.deepEqual(statChange(m("added_kg", [12, 12])), { trend: "same", value: "+12 kg", from: "was +12 kg", delta: "= same" })
assert.equal(statChange(m("added_kg", [-5, 0]))?.from, "was −5 kg")
// seconds
assert.equal(statChange(m("s", [45, 60]))?.delta, "▲ 15 s")
// colours
assert.deepEqual(statChange(m("colour", [2, 3])), { trend: "up", value: "Yellow", from: "was Green", delta: "▲ 1 colour" })
assert.equal(statChange(m("colour", [4, 2]))?.delta, "▼ 2 colours")
// workouts: done vs planned
assert.deepEqual(statChange(m("workouts", [2, 2, 1, 2], 8)), { trend: "down", value: "7 / 8", from: "done so far", delta: "1 missed" })
assert.equal(statChange(m("workouts", [2, 2], 4))?.delta, "All done")
// edge cases
assert.equal(statChange(m("kg", [])), null)
assert.equal(statChange(m("kg", [40]))?.from, "first record")

console.log("athleteStats: all tests passed")
