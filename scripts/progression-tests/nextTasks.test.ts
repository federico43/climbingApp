// Tests for "For next time" tasks (utils/nextTasks.ts). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/nextTasks.test.ts

import assert from "node:assert/strict"
import {
  addTask, amountLabel, doneCount, dropDone, dropStaleDone, EMPTY_TASKS, MAX_TASKS, newerList, parseNextTasks,
  removeTask, serializeNextTasks, shouldAutoOpen, toggleTask,
} from "@/utils/nextTasks"

const D = "2026-11-13"

// add: trims, keeps an amount only with a unit, rounds and caps it
let l = addTask(EMPTY_TASKS, { text: "  Crux of the blue project  ", unit: "tries", amount: 5 }, "a", D, 10)
l = addTask(l, { text: "Dead hangs", unit: "min", amount: 3.4 }, "b", D, 11)
l = addTask(l, { text: "Just a note", unit: null, amount: 7 }, "c", D, 12)
assert.equal(l.tasks.length, 3)
assert.equal(l.tasks[0].text, "Crux of the blue project")
assert.equal(l.tasks[1].amount, 3)
assert.equal(l.tasks[2].amount, null)
assert.equal(l.updatedAt, 12)
assert.equal(addTask(l, { text: "   " }, "x", D, 13), l, "empty text is ignored")

// labels
assert.equal(amountLabel(l.tasks[0]), "5 tries")
assert.equal(amountLabel({ amount: 1, unit: "tries" }), "1 try")
assert.equal(amountLabel(l.tasks[1]), "3 min")
assert.equal(amountLabel(l.tasks[2]), null)

// round trip
assert.deepEqual(parseNextTasks(serializeNextTasks(l)), l)
assert.deepEqual(parseNextTasks("not json"), EMPTY_TASKS)
assert.deepEqual(parseNextTasks(null), EMPTY_TASKS)
assert.deepEqual(parseNextTasks({ tasks: [{ id: "z", text: "" }, { id: 3, text: "x" }], updatedAt: 5 }), { tasks: [], updatedAt: 5 })
assert.equal(parseNextTasks({ tasks: [{ id: "q", text: "x", unit: "kg", amount: 4 }] }).tasks[0].amount, null)

// cap
let many = EMPTY_TASKS
for (let i = 0; i < MAX_TASKS + 3; i++) many = addTask(many, { text: `t${i}` }, `id${i}`, D, i)
assert.equal(many.tasks.length, MAX_TASKS)

// tick / untick, then the workout ends: ticked go, the rest carry over
let t = toggleTask(l, "a", D, 20)
assert.equal(t.tasks[0].doneOn, D)
assert.equal(doneCount(t), 1)
assert.equal(toggleTask(t, "a", D, 21).tasks[0].doneOn, null)
const after = dropDone(t, 30)
assert.deepEqual(after.tasks.map((x) => x.id), ["b", "c"])
assert.equal(after.updatedAt, 30)
assert.equal(dropDone(l, 40), l, "nothing ticked → same list")

// remove
assert.deepEqual(removeTask(l, "b", 50).tasks.map((x) => x.id), ["a", "c"])

// ticked on an earlier day in a cancelled workout → gone on load; today's stay
const stale = toggleTask(l, "a", "2026-11-10", 60)
assert.deepEqual(dropStaleDone(stale, D).tasks.map((x) => x.id), ["b", "c"])
assert.equal(dropStaleDone(t, D), t)

// newer copy wins, ties keep the first
assert.equal(newerList(l, t), t)
assert.equal(newerList(t, l), t)
assert.equal(newerList(l, { ...l }), l)

// auto-open: just started, something to do; not on a resume
assert.equal(shouldAutoOpen(l, 1000, 5000), true)
assert.equal(shouldAutoOpen(l, 1000, 1000 + 61_000), false)
assert.equal(shouldAutoOpen(l, null, 5000), false)
assert.equal(shouldAutoOpen(EMPTY_TASKS, 1000, 5000), false)
let allDone = toggleTask(toggleTask(toggleTask(l, "a", D, 1), "b", D, 1), "c", D, 1)
assert.equal(shouldAutoOpen(allDone, 1000, 5000), false)

console.log("nextTasks: all tests passed")
