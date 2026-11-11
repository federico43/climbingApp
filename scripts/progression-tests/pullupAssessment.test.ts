// Tests for the strength-based pull-up assessment (utils/pullupAssessment.ts). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/pullupAssessment.test.ts

import assert from "node:assert/strict"
import { ladderIndexOf } from "@/utils/bands"
import { bandStartFor, easierThanBands, isPullupLadder, parsePullupTest, planFromTest, retestDue, stepForVariation } from "@/utils/pullupAssessment"

const idx = ladderIndexOf

// No pull-up, no controlled negatives → band everywhere
assert.deepEqual(planFromTest({ maxReps: 0, negatives: 1 }), { max_force: "band", hypertrophy: "band", explosiveness: "band" })
// No pull-up but 4 negatives → negatives for max force, band for the rest
assert.deepEqual(planFromTest({ maxReps: 0, negatives: 4 }), { max_force: "negative", hypertrophy: "band", explosiveness: "band" })
// 2 pull-ups + negatives → still negatives for max force (3–6 not reachable)
assert.deepEqual(planFromTest({ maxReps: 2, negatives: 5 }), { max_force: "negative", hypertrophy: "band", explosiveness: "band" })
// 5 pull-ups: max force on bodyweight, hypertrophy and explosive with a band
assert.deepEqual(planFromTest({ maxReps: 5 }), { max_force: "bodyweight", hypertrophy: "band", explosiveness: "band" })
// 9: weighted max force, bodyweight hypertrophy, still a band for speed
assert.deepEqual(planFromTest({ maxReps: 9 }), { max_force: "weighted", hypertrophy: "bodyweight", explosiveness: "band" })
// 12: explosive on bodyweight once 6 fast reps are half the max
assert.deepEqual(planFromTest({ maxReps: 12 }), { max_force: "weighted", hypertrophy: "bodyweight", explosiveness: "bodyweight" })
// 15: weighted for both strength focuses
assert.deepEqual(planFromTest({ maxReps: 15 }), { max_force: "weighted", hypertrophy: "weighted", explosiveness: "bodyweight" })

// Band finder start: the bigger the gap, the more help
assert.equal(bandStartFor("hypertrophy", { maxReps: 0 }), idx("green"))
assert.equal(bandStartFor("hypertrophy", { maxReps: 4 }), idx("purple"))
assert.equal(bandStartFor("hypertrophy", { maxReps: 6 }), idx("black"))
assert.equal(bandStartFor("max_force", { maxReps: 2 }), idx("red"))
assert.equal(bandStartFor("explosiveness", { maxReps: 0 }), idx("green"))
assert.equal(bandStartFor("explosiveness", { maxReps: 6 }), idx("red"))

// Retest every 6 weeks
assert.equal(retestDue(undefined, "2026-11-11"), true)
assert.equal(retestDue("2026-10-01", "2026-11-11"), false)
assert.equal(retestDue("2026-09-30", "2026-11-11"), true)

// Stored JSON
assert.equal(parsePullupTest(null), null)
assert.equal(parsePullupTest("{}"), null)
assert.deepEqual(parsePullupTest('{"date":"2026-11-11","maxReps":3,"negatives":4}'), { date: "2026-11-11", maxReps: 3, negatives: 4 })
assert.deepEqual(parsePullupTest('{"date":"2026-11-11","maxReps":7}'), { date: "2026-11-11", maxReps: 7 })

// ── on the ladder ──
const full = ["Chin-up isometric", "Band Assisted Pull-Ups", "Negative pull-ups", "Pull Ups", "Weighted pull-ups"].map((name, i) => ({ exerciseId: `l${i}`, name }))
assert.ok(isPullupLadder(full))
assert.ok(!isPullupLadder([{ exerciseId: "a", name: "Push-ups" }, { exerciseId: "b", name: "Elevated push-ups" }]))
assert.equal(stepForVariation(full, "band"), 1)
assert.equal(stepForVariation(full, "negative"), 2)
assert.equal(stepForVariation(full, "bodyweight"), 3)
assert.equal(stepForVariation(full, "weighted"), 4)
// Missing steps fall back: no weighted → pull-ups, no negatives → band
const short = full.filter((l) => !/weighted|negative/i.test(l.name))
assert.equal(short[stepForVariation(short, "weighted")].name, "Pull Ups")
assert.equal(short[stepForVariation(short, "negative")].name, "Band Assisted Pull-Ups")
// Nothing helps enough: the step below the bands, if any
assert.equal(full[easierThanBands(full)].name, "Chin-up isometric")
assert.equal(easierThanBands(full.slice(1)), -1)

console.log("pull-up assessment tests passed")
