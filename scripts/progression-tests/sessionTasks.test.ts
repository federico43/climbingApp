// Tests for next-session tasks (utils/sessionTasks.ts — docs/session-tasks.md). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/sessionTasks.test.ts

import assert from "node:assert/strict"
import {
  addTask, amountLabel, canAdd, closedTaskIds, EMPTY_TASKS, isTaskBlock, MAX_TEXT, newerList, parseSessionTasks,
  removeTasks, serializeSessionTasks, taskBlock, taskInsertIndex, tasksAllowedFor, triesLeft, withTaskBlocks,
  type SessionTaskList,
} from "@/utils/sessionTasks"

const day = "2026-11-22"
const one = addTask(EMPTY_TASKS, { text: "  Blue crux  ", mode: "tries", amount: 5 }, "a", day, 1)
const two = addTask(one, { text: "Drop knee", mode: "time", amount: 10 }, "b", day, 2)

// add: trimmed, two at most, empty text refused
assert.equal(one.tasks[0].text, "Blue crux")
assert.equal(two.tasks.length, 2)
assert.equal(canAdd(two), false)
assert.equal(addTask(two, { text: "Third", mode: "tries", amount: 3 }, "c", day, 3), two)
assert.equal(addTask(one, { text: "   ", mode: "tries", amount: 3 }, "c", day, 3), one)
assert.equal(addTask(EMPTY_TASKS, { text: "x".repeat(200), mode: "tries", amount: 3 }, "c", day, 3).tasks[0].text.length, MAX_TEXT)
// amounts clamped to the mode's range
assert.equal(addTask(EMPTY_TASKS, { text: "t", mode: "tries", amount: 99 }, "c", day, 3).tasks[0].amount, 20)
assert.equal(addTask(EMPTY_TASKS, { text: "t", mode: "time", amount: 1 }, "c", day, 3).tasks[0].amount, 5)

// remove
assert.deepEqual(removeTasks(two, ["a"], 9).tasks.map((t) => t.id), ["b"])
assert.equal(removeTasks(two, ["zzz"], 9), two)

// labels
assert.equal(amountLabel({ mode: "tries", amount: 1 }), "1 try")
assert.equal(amountLabel({ mode: "tries", amount: 5 }), "5 tries")
assert.equal(amountLabel({ mode: "time", amount: 10 }), "10 min")

// parse: round trip, junk, newer wins
assert.deepEqual(parseSessionTasks(serializeSessionTasks(two)), two)
assert.deepEqual(parseSessionTasks("nope"), EMPTY_TASKS)
assert.deepEqual(parseSessionTasks(null), EMPTY_TASKS)
assert.deepEqual(parseSessionTasks({ tasks: [{ id: 1, text: "x" }] }).tasks, [])
assert.equal(newerList(one, two), two)
assert.equal(newerList(two, one), two)
// PR #101 lists: minutes → time, no amount → tries, ticked dropped, only two kept
const old = parseSessionTasks({
  updatedAt: 5,
  tasks: [
    { id: "1", text: "Done one", doneOn: "2026-11-20" },
    { id: "2", text: "Hangs", unit: "min", amount: 3 },
    { id: "3", text: "Crux" },
    { id: "4", text: "Extra" },
  ],
})
assert.deepEqual(old.tasks.map((t) => [t.id, t.mode, t.amount]), [["2", "time", 5], ["3", "tries", 5]])

// task block
const tb = taskBlock(two.tasks[1])
assert.equal(tb.type, "project_bouldering")
assert.equal(tb.timeLimit, 10)
assert.equal(tb.reviewPrompts, false)
assert.equal(isTaskBlock(tb), true)
assert.equal("timeLimit" in taskBlock(two.tasks[0]), false)
assert.equal(isTaskBlock({ type: "project_bouldering" }), false)

// which workouts
const rows = (blocks: any[], planPart?: string) => ({ blocks: JSON.stringify(blocks), planPart })
const warm = { type: "constraint_warmup", blockName: "Warm" }
const proj = { type: "project_bouldering", blockName: "Project" }
const sc = { type: "strength_conditioning", blockName: "S&C" }
assert.equal(tasksAllowedFor(rows([sc, warm, proj])), true)
assert.equal(tasksAllowedFor(rows([sc])), false)                                   // no climbing
assert.equal(tasksAllowedFor(rows([warm], "sc")), false)
assert.equal(tasksAllowedFor(rows([proj], "homework")), false)                     // coach's homework
assert.equal(tasksAllowedFor(rows([{ ...proj, extraSession: { to: "sat" } }], "homework")), true)
assert.equal(tasksAllowedFor(rows([{ ...sc, extraSession: { to: "sat" } }], "homework")), false)
assert.equal(tasksAllowedFor(rows([{ ...proj, leftAsHomework: { on: true } }])), false)
assert.equal(tasksAllowedFor({ blocks: "{bad" }), false)

// where: after the warm-up run, else before the first climbing block, else the end
assert.equal(taskInsertIndex([sc, warm, warm, proj, proj]), 3)
assert.equal(taskInsertIndex([sc, proj, warm]), 1)
assert.equal(taskInsertIndex([sc, warm]), 2)
assert.equal(taskInsertIndex([sc]), 1)
const run = withTaskBlocks([sc, warm, proj], two)
assert.deepEqual(run.map((b) => b.blockName), ["S&C", "Warm", "Blue crux", "Drop knee", "Project"])
// never twice, nothing with no tasks
assert.equal(withTaskBlocks(run, two), run)
const plain = [warm, proj]
assert.equal(withTaskBlocks(plain, EMPTY_TASKS), plain)

// closed: marked closed and not skipped
const done = run.map((b, i) => (i === 2 || i === 3 ? { ...b, focusTask: { ...b.focusTask, closed: true } } : b))
assert.deepEqual(closedTaskIds(done, new Set()), ["a", "b"])
assert.deepEqual(closedTaskIds(done, new Set([3])), ["a"])
assert.deepEqual(closedTaskIds(run, new Set()), [])

// tries left
assert.equal(triesLeft(tb.focusTask, 0), null)                                     // time mode
assert.equal(triesLeft(taskBlock(two.tasks[0]).focusTask, 3), 2)
assert.equal(triesLeft(taskBlock(two.tasks[0]).focusTask, 7), 0)

const _typed: SessionTaskList = two
void _typed
console.log("sessionTasks: all tests passed")
