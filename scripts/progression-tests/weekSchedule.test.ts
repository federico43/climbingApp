// Tests for utils/weekSchedule.ts (the default-week calendar). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/weekSchedule.test.ts

import assert from "node:assert/strict"
import {
  EXAMPLE_WEEK, GRID_END, GRID_START, clampHours, formatHours, formatTime,
  startFromOffset, stepStart, weekSummary,
} from "@/utils/weekSchedule"

assert.equal(formatTime(18.5), "18:30")
assert.equal(formatTime(7), "7:00")
assert.equal(formatHours(1.5), "1h 30m")
assert.equal(formatHours(2), "2h")
assert.equal(formatHours(2.5), "2h 30m")
assert.equal(formatHours(0.5), "30m")

// 44 px per hour: a tap 50 px down lands in the 3rd half hour → 7:00
assert.equal(startFromOffset(50, 44), GRID_START + 1)
assert.equal(startFromOffset(-5, 44), GRID_START)
assert.equal(startFromOffset(10_000, 44), GRID_END - 0.5)

assert.equal(stepStart(9, 1), 9.5)
assert.equal(stepStart(GRID_START, -1), GRID_START)
assert.equal(stepStart(GRID_END - 0.5, 1), GRID_END - 0.5)

assert.equal(clampHours(17, 2), 1)
assert.equal(clampHours(9, 2.5), 2.5)

assert.deepEqual(weekSummary(EXAMPLE_WEEK), { days: 4, hours: 10 })
assert.deepEqual(weekSummary([]), { days: 0, hours: 0 })

console.log("all weekSchedule tests passed")
