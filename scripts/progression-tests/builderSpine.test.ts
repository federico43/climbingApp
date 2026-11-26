// Tests for utils/builderSpine.ts (phone workout builder cards). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/builderSpine.test.ts

import assert from "node:assert/strict"
import { blockMinutes, blockMode, blockOrdinal, noteExcerpt, workoutMinutes } from "@/utils/builderSpine"

assert.equal(blockMode(false), "own")
assert.equal(blockMode(true), "homework")

assert.equal(blockMinutes({ type: "free_session", timeLimit: 4 }), 4)
assert.equal(blockMinutes({ type: "route_exploration", timeLimit: 25, projectTime: 25 }), 50)
assert.equal(blockMinutes({ type: "intervals", series: 6, workTime: 30, restTime: 30 }), 6)
assert.equal(workoutMinutes([{ type: "free_session", timeLimit: 4 }, { type: "route_exploration", timeLimit: 25, projectTime: 25 }]), 54)
assert.equal(workoutMinutes([]), 0)

assert.equal(noteExcerpt("Nose in, mouth out\nSecond line"), "Nose in, mouth out")
assert.equal(noteExcerpt(undefined), "")
assert.equal(noteExcerpt("a".repeat(80), 10), "aaaaaaaaa…")

assert.equal(blockOrdinal(1, 3), "Block 02 of 03")
assert.equal(blockOrdinal(0, 0), "Block 01 of 01")

console.log("builderSpine: all tests passed")
