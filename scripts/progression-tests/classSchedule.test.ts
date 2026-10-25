// Tests for utils/classSchedule.ts (weekly classes). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/classSchedule.test.ts

import assert from "node:assert/strict"
import {
  GRID_END, type GymClass, athleteView, currentPackage, packageLocked, proposeProblem, classDate, parseSlot, sessionsLeft, slotKey, GRID_START, addClassProblem, adjacentDays, athleteWeek, busyDays, formatTime,
  headcount, isBlocked, mondayOf, openDays, restDayOk, startFromOffset, weekDates, weekdayOf,
} from "@/utils/classSchedule"

// A week of classes to test against
const EXAMPLE_CLASSES: GymClass[] = [
  { id: "c1", day: 0, start: 9.5, roster: ["lu_crimps", "jp_slab", "sofi_k"] },
  { id: "c2", day: 0, start: 15.5, roster: ["mari_dyno", "vale_r", "diego_m", "cami_p"] },
  { id: "c3", day: 1, start: 9.5, roster: ["ana_v", "nico_h"] },
  { id: "c8", day: 3, start: 9.5, roster: ["lu_crimps", "sofi_k", "diego_m"] },
  { id: "c13", day: 5, start: 9.5, roster: ["tomas_b", "nico_h"] },
]

assert.equal(formatTime(9.5), "9:30")
assert.equal(formatTime(7), "7:00")

// 46 px per hour: 50 px down → third half hour → 7:00; the class must end by 20:00
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

// Days still free for a make-up class, from today on
assert.deepEqual(openDays([0], 0), [2, 3, 4, 5])
assert.deepEqual(openDays([0], 4), [4, 5])
assert.deepEqual(openDays([5], 4), []) // Sat taken, Fri/Sun next to it

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

// Coach: 2 a day (3 on up to 2 days), no overlaps, nothing in blocked time, nothing past 20:00
const blocks = [{ day: 4, start: 12.5, end: GRID_END }]
assert.equal(addClassProblem(EXAMPLE_CLASSES, blocks, 0, 12.5), null)        // Mon has 9:30 and 15:30: a 3rd fits
const big = (day: number) => [6, 9, 12].map((start, i) => ({ id: `b${day}${i}`, day, start, roster: [] }))
assert.equal(addClassProblem(big(0), [], 0, 15), "max")
const twoBig = [...big(0), ...big(2), { id: "t1", day: 3, start: 6, roster: [] }, { id: "t2", day: 3, start: 9, roster: [] }]
assert.equal(addClassProblem(twoBig, [], 3, 12), "bigDays")                  // Mon and Wed already have 3
assert.equal(addClassProblem(twoBig, [], 4, 12), null)                       // Fri has none
assert.equal(proposeProblem(EXAMPLE_CLASSES, blocks, 0, 12.5), "max")        // athletes can't add a 3rd
assert.equal(addClassProblem(EXAMPLE_CLASSES, blocks, 5, 10), "overlap")     // Sat 9:30 runs to 12:00
assert.equal(addClassProblem(EXAMPLE_CLASSES, blocks, 5, 12), null)
assert.equal(addClassProblem(EXAMPLE_CLASSES, blocks, 6, 18), "late")
assert.equal(addClassProblem([], blocks, 4, 13), "blocked")
assert.ok(isBlocked([{ day: 2, start: 6, end: 18, all: true }], 2, 9))
assert.ok(!isBlocked(blocks, 4, 9.5))                                         // 9:30–12:00 ends before 12:30

// Weeks start on Monday
const sat = new Date(2026, 9, 31, 15, 0)
assert.equal(weekdayOf(sat), 5)
assert.equal(mondayOf(sat).getDate(), 26)
assert.deepEqual(weekDates(mondayOf(sat)).map((d) => d.getDate()), [26, 27, 28, 29, 30, 31, 1])

// The server's week as the athlete sees it
const server: GymClass[] = [
  { id: "a", day: 0, start: 9.5, roster: ["me", "u1"] },
  { id: "b", day: 3, start: 9.5, roster: ["me"] },
  { id: "c", day: 5, start: 9.5, roster: ["u1"] },
]
const req = (r: Partial<Parameters<typeof athleteView>[1][number]>) => ({ $id: "r", athleteId: "me", weekStart: "w", kind: "move", status: "pending", ...r }) as any
const view = athleteView(server, [
  req({ kind: "move", fromClassId: "b", toClassId: "c" }),
  req({ kind: "move", status: "rejected", fromClassId: "a", toClassId: "c" }),
  req({ athleteId: "u1", kind: "skip", status: "accepted", fromClassId: "a" }),
], "me", { u1: "Lu" })
assert.deepEqual(view.mine, ["a", "b"])
assert.deepEqual(view.changes, { b: { status: "move", to: "c" } })
assert.deepEqual(view.classes[0].roster, ["Lu"])
// A skipped class isn't in the roster any more but stays one of theirs
const skippedView = athleteView([{ ...server[0], roster: ["u1"] }, server[1]], [req({ kind: "skip", status: "accepted", fromClassId: "a" })], "me", {})
assert.deepEqual(skippedView.mine, ["b", "a"])
assert.deepEqual(skippedView.changes, { a: { status: "skip" } })
assert.equal(athleteView(server, [req({ kind: "extra", toClassId: "c" })], "me", {}).extra?.to, "c")

assert.deepEqual(parseSlot(slotKey({ day: 3, start: 9.5 })), { day: 3, start: 9.5 })
assert.equal(parseSlot("9@1"), null)
assert.equal(classDate("2026-10-26", { day: 3, start: 9.5 }).getTime(), new Date(2026, 9, 29, 9, 30).getTime())
assert.equal(sessionsLeft(8, 2, 3), 5)

// Packages: the latest started one counts; used up or expired locks the app
const pkgs = [
  { startsOn: "2026-09-01", useBy: "2026-10-01", $createdAt: "2026-09-01T10:00:00Z" },
  { startsOn: "2026-10-20", useBy: "2026-11-20", $createdAt: "2026-10-20T10:00:00Z" },
  { startsOn: "2026-10-20", useBy: "2026-12-01", $createdAt: "2026-10-20T15:00:00Z" },
  { startsOn: "2026-11-01", useBy: "2026-12-01" },
]
assert.equal(currentPackage(pkgs, "2026-10-25")?.useBy, "2026-12-01")
assert.equal(currentPackage(pkgs, "2026-08-01"), null)
assert.equal(packageLocked(null, 0, "2026-10-25"), false)
assert.equal(packageLocked(pkgs[1], 0, "2026-10-25"), true)
assert.equal(packageLocked(pkgs[1], 3, "2026-10-25"), false)
assert.equal(packageLocked(pkgs[0], 3, "2026-10-25"), true)

console.log("classSchedule tests passed")
