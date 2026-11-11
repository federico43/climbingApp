// Tests for utils/maxHangs.ts. Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/maxHangs.test.ts

import assert from "node:assert/strict"
import {
  DEFAULT_HANG_EDGE, HANG_LOG_LIMIT, hangEdgeOf, hangLoadLabel, hangMaxes, hangMaxFor, hangWarmupRamp,
  isMaxHang, needsHangWarmup, normalizeEdge, parseHangLog, withHangMax, type HangMaxEntry,
} from "@/utils/maxHangs"
import { exerciseDraftFromLibrary } from "@/utils/scPlanBuilder"

// Which exercise
assert.equal(isMaxHang({ name: "Max Hangs" }), true)
assert.equal(isMaxHang({ name: " max hang " }), true)
assert.equal(isMaxHang({ name: "Edge Lifts" }), false)
assert.equal(needsHangWarmup({ name: "Max Hangs", focus: "max_force" }), true)
assert.equal(needsHangWarmup({ name: "Max Hangs" }), true)
assert.equal(needsHangWarmup({ name: "Max Hangs", focus: "hypertrophy" }), false)

// Edges
assert.equal(normalizeEdge("20 mm"), "20mm")
assert.equal(normalizeEdge("15MM"), "15mm")
assert.equal(normalizeEdge(12), "12mm")
assert.equal(normalizeEdge("7,5mm"), "7.5mm")
assert.equal(normalizeEdge("pocket"), "")
assert.equal(hangEdgeOf({}), DEFAULT_HANG_EDGE)
assert.equal(hangEdgeOf({ edge: "10 mm" }), "10mm")

// The log
const raw = JSON.stringify([
  { edge: "15mm", kg: 5, date: "2026-11-10", source: "test" },
  { edge: "20 mm", kg: 12.5, date: "2026-11-09", source: "coach" },
  { edge: "15mm", kg: 2, date: "2026-11-01", source: "test" },
  { edge: "10mm", kg: 0, date: "2026-11-01", source: "test" },   // bodyweight is a max
  { edge: "x", kg: 3, date: "2026-11-01", source: "test" },      // no edge → dropped
  { edge: "20mm", kg: -2, date: "2026-11-01", source: "test" },  // negative → dropped
])
const log = parseHangLog(raw)
assert.equal(log.length, 4)
assert.equal(hangMaxFor(log, "15mm"), 5)           // newest wins
assert.equal(hangMaxFor(log, "20mm"), 12.5)
assert.equal(hangMaxFor(log, "10 mm"), 0)
assert.equal(hangMaxFor(log, "8mm"), null)
assert.deepEqual(hangMaxes(log), [{ edge: "20mm", kg: 12.5 }, { edge: "15mm", kg: 5 }, { edge: "10mm", kg: 0 }])
assert.deepEqual(parseHangLog(""), [])
assert.deepEqual(parseHangLog("nope"), [])
assert.deepEqual(parseHangLog(null), [])

const entry: HangMaxEntry = { edge: "8 mm", kg: 1, date: "2026-11-11", source: "test" }
const next = withHangMax(log, entry)
assert.equal(next[0].edge, "8mm")
assert.equal(hangMaxFor(next, "8mm"), 1)
const full = Array.from({ length: HANG_LOG_LIMIT }, () => entry)
assert.equal(withHangMax(full, entry).length, HANG_LOG_LIMIT)

// Warm-up: 15 / 10 / 5 kg under the max, 10 / 7 / 5 s, never below bodyweight
assert.deepEqual(hangWarmupRamp(20, "kg"), [{ weight: 5, secs: 10 }, { weight: 10, secs: 7 }, { weight: 15, secs: 5 }])
assert.deepEqual(hangWarmupRamp(8, "kg").map((s) => s.weight), [0, 0, 3])
assert.deepEqual(hangWarmupRamp(0, "kg").map((s) => s.weight), [0, 0, 0])   // bodyweight max: shorter hangs
assert.deepEqual(hangWarmupRamp(20, "kg", 2.5).map((s) => s.weight), [5, 10, 15])
assert.deepEqual(hangWarmupRamp(20, "lb").map((s) => s.weight), [11, 22, 33])
assert.deepEqual(hangWarmupRamp(null, "kg"), [])
assert.deepEqual(hangWarmupRamp(NaN, "kg"), [])

assert.equal(hangLoadLabel(0, "kg"), "Bodyweight")
assert.equal(hangLoadLabel(7.5, "kg"), "+7.5 kg")

// From the library: a 10 s hang on the library's grip (or 20mm)
const row = { $id: "mh", $createdAt: "", name: "Max Hangs", type: "reps", unit: "seconds", defaultReps: "10", defaultEdge: "15 mm" } as any
assert.equal(exerciseDraftFromLibrary(row).edge, "15mm")
assert.equal(exerciseDraftFromLibrary(row).reps, "10")
assert.equal(exerciseDraftFromLibrary({ ...row, defaultEdge: undefined, defaultReps: undefined }).edge, DEFAULT_HANG_EDGE)
assert.equal(exerciseDraftFromLibrary({ ...row, defaultReps: undefined }).reps, "10")

console.log("all maxHangs tests passed")
