// Tests for utils/blockIntro.ts (the block intro's meta line). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/blockIntro.test.ts

import assert from "node:assert/strict"
import { introMeta, minutesLabel, shortNoteParts } from "@/utils/blockIntro"

// A short one-line note splits into parts.
assert.deepEqual(shortNoteParts("Nose in, mouth out"), ["Nose in", "mouth out"])
assert.deepEqual(shortNoteParts("6 rounds. Nose in · mouth out"), ["6 rounds", "Nose in", "mouth out"])
// Long or multi-line notes stay in the notes card.
assert.equal(shortNoteParts("Nose in, mouth out, six slow rounds before the first boulder of the day"), null)
assert.equal(shortNoteParts("Nose in\nmouth out"), null)
assert.equal(shortNoteParts(""), null)
assert.equal(shortNoteParts(undefined), null)

assert.equal(minutesLabel(4), "4 min")
assert.equal(minutesLabel(0), null)
assert.equal(minutesLabel(undefined), null)
assert.equal(minutesLabel(90), "1h 30 min")
assert.equal(minutesLabel(120), "2h")

assert.equal(introMeta(["4 min", null, false, "6 rounds"], "Nose in, mouth out"), "4 min · 6 rounds · Nose in · mouth out")
assert.equal(introMeta(["4 min"], "A much longer note that will not fit on the meta line at all"), "4 min")
assert.equal(introMeta([], null), "")

console.log("blockIntro: all tests passed")
