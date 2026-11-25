// Tests for utils/pauseClock.ts. Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/pauseClock.test.ts

import assert from "node:assert/strict"
import { clockNow, pauseAt, realTime, resumeAt, RUNNING } from "@/utils/pauseClock"

// Running: the clock is real time.
assert.equal(clockNow(RUNNING, 1000), 1000)
assert.equal(realTime(RUNNING, 5000), 5000)

// Paused at 2000: "now" stands still, nothing should fire.
const p = pauseAt(RUNNING, 2000)
assert.equal(clockNow(p, 2000), 2000)
assert.equal(clockNow(p, 9000), 2000)
assert.equal(realTime(p, 5000), null)
assert.equal(realTime(RUNNING, null), null)
// Pausing again keeps the first pause.
assert.deepEqual(pauseAt(p, 3000), p)

// Resumed at 7000: 5 s paused, the clock runs 5 s behind and an end at
// clock 5000 now fires at real 10000.
const r = resumeAt(p, 7000)
assert.deepEqual(r, { pausedAt: null, offset: 5000 })
assert.equal(clockNow(r, 7000), 2000)
assert.equal(clockNow(r, 8000), 3000)
assert.equal(realTime(r, 5000), 10000)
assert.deepEqual(resumeAt(r, 8000), r)

// A second pause adds up.
const r2 = resumeAt(pauseAt(r, 8000), 10000)
assert.equal(r2.offset, 7000)
assert.equal(clockNow(r2, 10000), 3000)

console.log("pauseClock tests passed")
