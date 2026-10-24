// Tests for utils/classSchedule.ts (weekly classes). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/classSchedule.test.ts

import assert from "node:assert/strict"
import {
  EXAMPLE_CLASSES, GRID_END, GRID_START, addClassProblem, adjacentDays, athleteWeek, busyDays, formatTime,
  headcount, isBlocked, mondayOf, restDayOk, startFromOffset, weekDates, weekdayOf,
} from "@/utils/classSchedule"

assert.equal(formatTime(9.5), "9:30")
assert.equal(formatTime(7), "7:00")

// 46 px per hour: 50 px down → third half hour → 7:00; the class must end by 18:00
assert.equal(startFromOffset(50, 46), GRID_START + 1)
assert.equal(startFromOffset(-5, 46), GRID_START)
assert.equal(startFromOffset(10_000, 46), GRID_END - 2.5)

// Sunday and Monday count as days in a row
assert.ok(adjacentDays(6, 0))
assert.ok(adjacentDays(2, 3))
assert.ok(!adjacentDays(0, 2))
assert.ok(restDayOk([0, 3], 5))
assert.ok(!restDayOk([0, 3], 4))
assert.ok(!restDayOk([0, 3], 6))
assert.ok(!restDayOk([0, 3], 3))

const mine = ["c1", "c8"] // Mon 9:30, Thu 9:30
const plain = athleteWeek(EXAMPLE_CLASSES, mine, {}, null)
assert.deepEqual(plain.map((e) => [e.cls.id, e.state]), [["c1", "on"], ["c8", "on"]])

// Moving Thu to Sat: the Sat class shows as pending and replaces Thu
const moved = athleteWeek(EXAMPLE_CLASSES, mine, { c8: { status: "move", to: "c13" } }, null)
assert.deepEqual(moved.map((e) => [e.cls.id, e.state, e.from]), [["c1", "on", undefined], ["c13", "pending", "c8"]])
// While moving Thu, Thu itself doesn't count as busy
assert.deepEqual(busyDays(plain, "c8"), [0])

// A proposal is a class with no id yet
const proposed = athleteWeek(EXAMPLE_CLASSES, mine, { c8: { status: "propose", day: 5, start: 12.5 } }, null)
assert.equal(proposed[1].proposal, true)
assert.equal(proposed[1].cls.day, 5)

// Skipping keeps the class, marked skip, and frees the day
const skipped = athleteWeek(EXAMPLE_CLASSES, mine, { c8: { status: "skip" } }, null)
assert.equal(skipped[1].state, "skip")
assert.deepEqual(busyDays(skipped), [0])

// The extra class sits with the others, pending until the coach says yes
const extra = athleteWeek(EXAMPLE_CLASSES, mine, {}, { to: "c13", approved: false })
assert.deepEqual(extra.map((e) => [e.cls.id, e.state, !!e.extra]), [["c1", "on", false], ["c8", "on", false], ["c13", "pending", true]])

// Headcount includes the athlete in their own class, not in a skipped one
const c8 = EXAMPLE_CLASSES.find((c) => c.id === "c8")!
assert.equal(headcount(c8, plain), c8.roster.length + 1)
assert.equal(headcount(c8, skipped), c8.roster.length)

// Coach: max 2 a day, no overlaps, nothing in blocked time, nothing past 18:00
const blocks = [{ day: 4, start: 12.5, end: GRID_END }]
assert.equal(addClassProblem(EXAMPLE_CLASSES, blocks, 0, 12.5), "max")       // Mon has 9:30 and 15:30
assert.equal(addClassProblem(EXAMPLE_CLASSES, blocks, 5, 10), "overlap")     // Sat 9:30 runs to 12:00
assert.equal(addClassProblem(EXAMPLE_CLASSES, blocks, 5, 12), null)
assert.equal(addClassProblem(EXAMPLE_CLASSES, blocks, 6, 16), "late")
assert.equal(addClassProblem([], blocks, 4, 13), "blocked")
assert.ok(isBlocked([{ day: 2, start: 6, end: 18, all: true }], 2, 9))
assert.ok(!isBlocked(blocks, 4, 9.5))                                         // 9:30–12:00 ends before 12:30

// Weeks start on Monday
const sat = new Date(2026, 9, 31, 15, 0)
assert.equal(weekdayOf(sat), 5)
assert.equal(mondayOf(sat).getDate(), 26)
assert.deepEqual(weekDates(mondayOf(sat)).map((d) => d.getDate()), [26, 27, 28, 29, 30, 31, 1])

console.log("classSchedule tests passed")
