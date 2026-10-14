// Tests for utils/exerciseUnit.ts. Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/exerciseUnit.test.ts

import assert from "node:assert/strict"
import { amountLabel, isTimedExercise } from "@/utils/exerciseUnit"

assert.equal(amountLabel("30", "seconds"), "30s")
assert.equal(amountLabel("8-12"), "8-12 reps")

// unit decides for everything
assert.equal(isTimedExercise({ unit: "seconds", reps: "20-30" }), true)
assert.equal(isTimedExercise({ unit: "seconds", reps: "30", movementType: "mobility" }), true)
assert.equal(isTimedExercise({ unit: "reps", reps: "8-12" }), false)
assert.equal(isTimedExercise({ reps: "10", movementType: "mobility" }), false)
// mobility with a target written in seconds (stored as reps) is timed too
for (const reps of ["30s", "30 s", "20-30 sec", "45 seconds", "30 seg", "30 segundos", "30\"", "20–30s"]) {
  assert.equal(isTimedExercise({ unit: "reps", reps, movementType: "mobility" }), true, reps)
}
// …but not strength exercises, and not text that only mentions seconds
assert.equal(isTimedExercise({ unit: "reps", reps: "30s", movementType: "core" }), false)
assert.equal(isTimedExercise({ unit: "reps", reps: "10 each side", movementType: "mobility" }), false)
assert.equal(isTimedExercise({ unit: "reps", reps: "", movementType: "mobility" }), false)

console.log("all exerciseUnit tests passed")
