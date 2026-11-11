// Tests for utils/blockNotes.ts (readable coach notes on block intros). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/blockNotes.test.ts

import assert from "node:assert/strict"
import { CONSTRAINT_WORDS, noteParts, noteSteps, slideAt } from "@/utils/blockNotes"

const keys = (s: string) => noteParts(s).filter((p) => p.key).map((p) => p.text)

// Lines become steps; bullets and numbering are dropped; blank lines ignored.
assert.deepEqual(noteSteps("- Warm up 10 min\n\n• Then 3 x 8 reps\n2) Rest 2 min"), ["Warm up 10 min", "Then 3 x 8 reps", "Rest 2 min"])
// One paragraph splits by sentence, without breaking decimals or "e.g.".
assert.deepEqual(noteSteps("Climb slow. Rest 2.5 min between sets, e.g. sit down. Have fun!"), ["Climb slow.", "Rest 2.5 min between sets, e.g. sit down.", "Have fun!"])
assert.deepEqual(noteSteps("Just one instruction"), ["Just one instruction"])
assert.deepEqual(noteSteps(""), [])
assert.deepEqual(noteSteps(undefined), [])
// Lowercase after a period stays in the same step.
assert.deepEqual(noteSteps("Use the 20 mm edge. then hang"), ["Use the 20 mm edge. then hang"])

// Key numbers, with their units.
assert.deepEqual(keys("Do 3 x 10 at 80% with 90 s rest"), ["3 x 10", "80%", "90 s"])
assert.deepEqual(keys("Hang 7-10 s, 4x4, rest 1:30"), ["7-10 s", "4x4", "1:30"])
assert.deepEqual(keys("8 reps, 5 kg, 2 min"), ["8 reps", "5 kg", "2 min"])
// Grades and names are not highlighted.
assert.deepEqual(keys("Pick a V5 or a 6a+ on wall B2"), [])
// "5 slow moves" keeps the number only (unit must follow directly).
assert.deepEqual(keys("5 slow moves"), ["5"])
// Parts rebuild the original text.
const s = "Rest 3 min, then 2 x 5 reps."
assert.equal(noteParts(s).map((p) => p.text).join(""), s)

// *Stars* mark highlights (markers removed), in any block.
assert.deepEqual(noteParts("Keep *hips close* and **breathe**"), [
  { text: "Keep ", key: false }, { text: "hips close", key: true }, { text: " and ", key: false }, { text: "breathe", key: true },
])
assert.deepEqual(noteSteps("Climb easy. *Only* one hand."), ["Climb easy.", "*Only* one hand."])
// Constraint rule words: whole words, any case, longest first.
const cw = (s: string) => noteParts(s, CONSTRAINT_WORDS).filter((p) => p.key).map((p) => p.text)
assert.deepEqual(cw("Use only one hand on each hold"), ["only", "one hand"])
assert.deepEqual(cw("Place your feet silently, no re-adjusting"), ["feet", "silently", "no"])
assert.deepEqual(cw("Nothing known here; another notion"), [])
assert.deepEqual(cw("Don't match, 3 moves"), ["Don't", "3 moves"])
// Without words, nothing but numbers.
assert.deepEqual(keys("Use only one hand"), [])

console.log("blockNotes: ok")

// Slides: page from the scroll offset, clamped.

assert.equal(slideAt(0, 300, 4), 0)
assert.equal(slideAt(310, 300, 4), 1)
assert.equal(slideAt(440, 300, 4), 1)
assert.equal(slideAt(460, 300, 4), 2)
assert.equal(slideAt(5000, 300, 4), 3)
assert.equal(slideAt(-40, 300, 4), 0)
assert.equal(slideAt(300, 0, 4), 0)
