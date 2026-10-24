// Tests for utils/restNotification.ts (what the rest notifications say). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/restNotification.test.ts

import assert from "node:assert/strict"
import { formatRestLeft, restNotificationPlan } from "@/utils/restNotification"

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

console.log("all rest notification tests passed")
