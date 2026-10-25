// Tests for utils/planPauses.ts and the paused-plan dates in planRotation /
// planProgress. Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/planPauses.test.ts

import assert from "node:assert/strict"
import {
  currentOrNextPause, endPauseEarly, parsePauses, pauseFor, pauseOn, pauseProblem, pausedDayCount, planClockDate,
} from "@/utils/planPauses"
import { planEndFor, planWeek } from "@/utils/planRotation"
import { daysLeft } from "@/utils/planProgress"

const start = "2026-10-05" // a Monday
const pause = pauseFor("2026-10-19", 2, " Holidays ") // weeks 3–4 on the calendar
assert.deepEqual(pause, { start: "2026-10-19", end: "2026-11-01", reason: "Holidays" })
const pauses = [pause]

// The end date moves back by the paused days.
assert.equal(planEndFor(start), "2026-11-15")
assert.equal(planEndFor(start, pauses), "2026-11-29")
assert.equal(pausedDayCount(pauses), 14)

// The week count stops during the pause, then carries on.
assert.equal(planWeek(start, "2026-10-18", pauses), 2)
assert.equal(planWeek(start, "2026-10-19", pauses), 2)
assert.equal(planWeek(start, "2026-11-01", pauses), 2)
assert.equal(planWeek(start, "2026-11-02", pauses), 3)
assert.equal(planWeek(start, "2026-11-29", pauses), 6)
assert.equal(planWeek(start, "2026-11-30", pauses), 7)
assert.equal(planClockDate(pauses, "2026-11-02"), "2026-10-19")
assert.equal(planClockDate([], "2026-11-02"), "2026-11-02")

// A pause that starts mid-week freezes that week where it was.
const mid = [pauseFor("2026-10-22", 1)]
assert.equal(planWeek(start, "2026-10-25", mid), 3)
assert.equal(planWeek(start, "2026-10-29", mid), 3) // Thu after the pause: day 18 of the plan
assert.equal(planWeek(start, "2026-11-02", mid), 4)

// Days left skip paused days.
assert.equal(daysLeft(start, planEndFor(start, pauses), "2026-10-19", pauses), 28)
assert.equal(daysLeft(start, planEndFor(start), "2026-10-19"), 28)

assert.equal(pauseOn(pauses, "2026-10-25")?.start, "2026-10-19")
assert.equal(pauseOn(pauses, "2026-11-02"), null)
assert.equal(currentOrNextPause(pauses, "2026-10-10")?.start, "2026-10-19")
assert.equal(currentOrNextPause(pauses, "2026-11-02"), null)

// Rules for a new pause.
const plan = { windowStart: start, windowEnd: planEndFor(start, pauses) }
assert.equal(pauseProblem(pauseFor("2026-10-26", 1), pauses, plan), "It overlaps another pause.")
assert.equal(pauseProblem(pauseFor("2026-11-02", 5), pauses, plan), "A pause can be 4 weeks at most.")
assert.equal(pauseProblem(pauseFor("2026-10-01", 1), pauses, plan), "The pause has to start during the plan.")
assert.equal(pauseProblem(pauseFor("2026-11-02", 1), pauses, plan), null)

// Ending early: the last day becomes yesterday; not started yet → removed.
assert.deepEqual(endPauseEarly(pause, "2026-10-24"), { ...pause, end: "2026-10-23" })
assert.equal(endPauseEarly(pause, "2026-10-19"), null)
assert.deepEqual(endPauseEarly(pause, "2026-11-10"), pause)

// The column is JSON; junk is dropped.
assert.deepEqual(parsePauses(JSON.stringify([{ start: "2026-11-02", end: "2026-11-08" }, { start: "x", end: "y" }, pause])),
  [pause, { start: "2026-11-02", end: "2026-11-08" }])
assert.deepEqual(parsePauses(null), [])
assert.deepEqual(parsePauses("nope"), [])

console.log("planPauses: all good")
