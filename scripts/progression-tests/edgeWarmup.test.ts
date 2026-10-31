// Tests for utils/edgeWarmup.ts. Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/edgeWarmup.test.ts

import assert from "node:assert/strict"
import { currentMax, isEdgeLift, MAX_LOG_LIMIT, needsWarmup, parseMaxLog, warmupRamp, withNewMax } from "@/utils/edgeWarmup"

// The ramp: 40 / 55 / 70 / 85 % for 10 / 8 / 6 / 4 s, rounded to 0.5 kg
assert.deepEqual(warmupRamp(30, "kg"), [
  { weight: 12, secs: 10 }, { weight: 16.5, secs: 8 }, { weight: 21, secs: 6 }, { weight: 25.5, secs: 4 },
])
assert.deepEqual(warmupRamp(32.5, "kg").map((s) => s.weight), [13, 18, 23, 27.5])
// the exercise's load step wins
assert.deepEqual(warmupRamp(30, "kg", 2.5).map((s) => s.weight), [12.5, 17.5, 20, 25])
// in lb: the max converted, then 1 lb steps (30 kg = 66 lb)
assert.deepEqual(warmupRamp(30, "lb").map((s) => s.weight), [26, 36, 46, 56])
// a tiny max never rounds to 0
assert.ok(warmupRamp(1, "kg").every((s) => s.weight >= 0.5))
// no max → no ramp
assert.deepEqual(warmupRamp(0, "kg"), [])
assert.deepEqual(warmupRamp(NaN, "kg"), [])

// Which exercise
assert.equal(isEdgeLift({ name: "Edge Lifts" }), true)
assert.equal(isEdgeLift({ name: " edge lifts " }), true)
assert.equal(isEdgeLift({ name: "Edge Lift" }), true)
assert.equal(isEdgeLift({ name: "repeaters" }), false)
assert.equal(needsWarmup({ name: "Edge Lifts", focus: "max_force" }), true)
assert.equal(needsWarmup({ name: "Edge Lifts", focus: "hypertrophy" }), false)
assert.equal(needsWarmup({ name: "Edge Lifts", focus: "explosiveness" }), false)
assert.equal(needsWarmup({ name: "Edge Lifts" }), true)   // hand-made block, no focus
assert.equal(needsWarmup({ name: "repeaters", focus: "max_force" }), false)

// Stored max
assert.equal(currentMax({ edgeLiftMax: 30 }), 30)
assert.equal(currentMax({ edgeLiftMax: null }), null)
assert.equal(currentMax({ edgeLiftMax: 0 }), null)
assert.equal(currentMax(null), null)

assert.deepEqual(parseMaxLog('[{"kg":30,"date":"2026-10-08","source":"test"}]'), [{ kg: 30, date: "2026-10-08", source: "test" }])
assert.deepEqual(parseMaxLog("not json"), [])
assert.deepEqual(parseMaxLog(null), [])
assert.deepEqual(parseMaxLog('[{"kg":0,"date":"x"},{"date":"y"}]'), [])
const log = withNewMax([{ kg: 30, date: "2026-10-08", source: "test" }], { kg: 32.5, date: "2026-10-22", source: "coach" })
assert.equal(log[0].kg, 32.5)
assert.equal(log.length, 2)
const long = Array.from({ length: MAX_LOG_LIMIT }, (_, i) => ({ kg: i + 1, date: "2026-01-01", source: "test" as const }))
assert.equal(withNewMax(long, { kg: 99, date: "2026-10-22", source: "test" }).length, MAX_LOG_LIMIT)

console.log("all edgeWarmup tests passed")
