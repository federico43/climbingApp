// Tests for utils/restNotification.ts (what the rest notifications say). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/restNotification.test.ts

import assert from "node:assert/strict"
import { blockTimerNotificationPlan, formatRestLeft, restNotificationPlan, shouldPlayTimerEnd } from "@/utils/restNotification"

const clock = (ms: number) => `T${ms}`
const NOW = 1_000_000

// formatRestLeft: m:ss, rounding partial seconds up like the in-app timer
assert.equal(formatRestLeft(90), "1:30")
assert.equal(formatRestLeft(59.2), "1:00")
assert.equal(formatRestLeft(5), "0:05")
assert.equal(formatRestLeft(-3), "0:00")
assert.equal(formatRestLeft(600), "10:00")

// no rest running, or one that's over / about to be → nothing to show
assert.equal(restNotificationPlan(null, NOW, clock), null)
assert.equal(restNotificationPlan(NOW - 1000, NOW, clock), null)
assert.equal(restNotificationPlan(NOW, NOW, clock), null)
assert.equal(restNotificationPlan(NOW + 2500, NOW, clock), null)

// a rest with time left → countdown with the end time, done at the end
const plan = restNotificationPlan(NOW + 90_000, NOW, clock)!
assert.equal(plan.fireAt, NOW + 90_000)
assert.equal(plan.countdown.title, `Resting · ends at T${NOW + 90_000}`)
assert.equal(plan.countdown.body, "1:30 left. We'll let you know when it's over.")
assert.equal(plan.done.title, "Rest's over")

// right at the threshold it still notifies
assert.notEqual(restNotificationPlan(NOW + 3000, NOW, clock), null)

// block time limit: same thresholds, named after the block
assert.equal(blockTimerNotificationPlan(null, NOW, "Sequence", clock), null)
assert.equal(blockTimerNotificationPlan(NOW + 2500, NOW, "Sequence", clock), null)
const block = blockTimerNotificationPlan(NOW + 600_000, NOW, "Sequence", clock)!
assert.equal(block.fireAt, NOW + 600_000)
assert.equal(block.countdown.title, `Sequence · ends at T${NOW + 600_000}`)
assert.equal(block.countdown.body, "10:00 left. We'll let you know when time's up.")
assert.equal(block.done.title, "Time's up · Sequence")
assert.equal(blockTimerNotificationPlan(NOW + 60_000, NOW, "  ", clock)!.done.title, "Time's up · Block")

// the in-app beep: only in front, and only right at the end (not on return)
assert.equal(shouldPlayTimerEnd(NOW, NOW, true), true)
assert.equal(shouldPlayTimerEnd(NOW + 150, NOW, true), true)      // fired a hair early
assert.equal(shouldPlayTimerEnd(NOW + 5000, NOW, true), false)    // stopped well before the end
assert.equal(shouldPlayTimerEnd(NOW - 1000, NOW, true), true)     // noticed a poll late
assert.equal(shouldPlayTimerEnd(NOW - 60_000, NOW, true), false)  // back from the background
assert.equal(shouldPlayTimerEnd(NOW, NOW, false), false)          // app not in front

console.log("all rest notification tests passed")
