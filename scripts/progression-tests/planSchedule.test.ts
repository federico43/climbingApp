// Tests for the weekly scheduler (utils/planSchedule.ts —
// docs/training-plan.md §11). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/planSchedule.test.ts

import assert from "node:assert/strict"
import {
  canMoveSlot, daysToMove, defaultTrainingDays, firstOpenDay, homeworkBusyDays, parseTrainingTime, planReminders,
  scheduleFor, schedulePlan,
  type ScheduleInput,
} from "@/utils/planSchedule"

// A plan starting Monday 19 Oct 2026, training Tuesday and Thursday.
const base = (extra: Partial<ScheduleInput> = {}): ScheduleInput => ({
  windowStart: "2026-10-19",
  windowEnd: "2026-11-29",
  trainingDays: [2, 4],
  trainingTime: null,
  done: new Map(),
  overrides: {},
  busyDays: new Set(),
  today: "2026-10-19",
  ...extra,
})
const dates = (input: ScheduleInput) => schedulePlan(input).map((s) => s.date)
const states = (input: ScheduleInput) => schedulePlan(input).map((s) => s.state)

// default days: days 1 and 4 of each plan week
assert.deepEqual(defaultTrainingDays("2026-10-19"), [1, 4]) // Mon → Mon, Thu
assert.deepEqual(defaultTrainingDays("2026-10-21"), [3, 6]) // Wed → Wed, Sat
assert.deepEqual(defaultTrainingDays("2026-10-24"), [2, 6]) // Sat → Sat, Tue
assert.deepEqual(parseTrainingTime("18:30"), [18, 30])
assert.equal(parseTrainingTime("25:00"), null)
assert.equal(parseTrainingTime(null), null)

// a plan not started yet is scheduled from its first day: Tue/Thu, 2 a week, all 12 fit
assert.deepEqual(dates(base({ today: "2026-10-10" })), [
  "2026-10-20", "2026-10-22", "2026-10-27", "2026-10-29", "2026-11-03", "2026-11-05",
  "2026-11-10", "2026-11-12", "2026-11-17", "2026-11-19", "2026-11-24", "2026-11-26",
])
assert.ok(states(base()).every((s) => s === "scheduled"))

// no training days → the defaults (Mon, Thu for a Monday start)
assert.deepEqual(dates(base({ trainingDays: null })).slice(0, 3), ["2026-10-19", "2026-10-22", "2026-10-26"])

// a missed Tuesday moves everything along; the week cap pushes slot 2 to week 2,
// and the last slot no longer fits before the plan's end
{
  const s = schedulePlan(base({ today: "2026-10-21" }))
  assert.deepEqual(s.slice(0, 4).map((x) => x.date), ["2026-10-22", "2026-10-27", "2026-10-29", "2026-11-03"])
  assert.equal(s[10].date, "2026-11-26")
  assert.deepEqual(s[11], { index: 12, date: null, state: "unfit" })
}

// done slots stay on the day they were done (even off a training day) and count for the week
{
  const s = schedulePlan(base({ today: "2026-10-22", done: new Map([[1, "2026-10-21"]]) }))
  assert.deepEqual(s[0], { index: 1, date: "2026-10-21", state: "done" })
  // Thu 22 is right after Wed 21 → no rest day; week 1 has room for one more but no day left
  assert.equal(s[1].date, "2026-10-27")
}

// consecutive training days: never two plan workouts on back-to-back days
assert.deepEqual(dates(base({ trainingDays: [2, 3] })).slice(0, 4),
  ["2026-10-20", "2026-10-27", "2026-11-03", "2026-11-10"])
assert.deepEqual(dates(base({ trainingDays: [1, 2, 4] })).slice(0, 4),
  ["2026-10-19", "2026-10-22", "2026-10-26", "2026-10-29"])

// a homework day takes no plan workout
assert.deepEqual(dates(base({ busyDays: new Set(["2026-10-20"]) })).slice(0, 3),
  ["2026-10-22", "2026-10-27", "2026-10-29"])

// a day picked by hand wins, and the slots after it go after it
{
  const s = schedulePlan(base({ overrides: { 2: "2026-10-24" } }))
  assert.deepEqual(s[1], { index: 2, date: "2026-10-24", state: "moved" })
  assert.deepEqual(s.slice(2, 4).map((x) => x.date), ["2026-10-27", "2026-10-29"])
}
// a later slot's picked day is held while slot 1 is placed: slot 1 skips Tue 20,
// lands on Thu 22, and slot 2's pick (now before slot 1) falls back to the rule
{
  const s = schedulePlan(base({ overrides: { 2: "2026-10-20" } }))
  assert.equal(s[0].date, "2026-10-22")
  assert.deepEqual(s[1], { index: 2, date: "2026-10-27", state: "scheduled" })
}
// a picked day that has passed is dropped
assert.equal(schedulePlan(base({ today: "2026-10-25", overrides: { 1: "2026-10-24" } }))[0].state, "scheduled")

// today's training time passed → today is gone
{
  const now = new Date(2026, 9, 20, 19, 0)
  assert.equal(firstOpenDay(base({ today: "2026-10-20", trainingTime: "18:00", now })), "2026-10-21")
  assert.equal(firstOpenDay(base({ today: "2026-10-20", trainingTime: "20:00", now })), "2026-10-20")
  assert.equal(firstOpenDay(base({ today: "2026-10-20", now })), "2026-10-20")
}

// a plan starting on a Wednesday: its weeks run Wed → Tue
assert.deepEqual(
  dates(base({ windowStart: "2026-10-21", windowEnd: "2026-12-01", trainingDays: null, today: "2026-10-21" })).slice(0, 4),
  ["2026-10-21", "2026-10-24", "2026-10-28", "2026-10-31"],
)

// moving a slot
{
  const input = base()
  assert.equal(canMoveSlot(input, 2, "2026-10-24"), true)
  assert.equal(canMoveSlot(input, 2, "2026-10-21"), "rest")       // the day after slot 1
  assert.equal(canMoveSlot(input, 2, "2026-10-20"), "order")      // slot 1's day
  assert.equal(canMoveSlot(input, 2, "2026-10-18"), "outside")
  assert.equal(canMoveSlot(base({ today: "2026-10-23" }), 2, "2026-10-22"), "past")
  assert.equal(canMoveSlot(base({ busyDays: new Set(["2026-10-24"]) }), 2, "2026-10-24"), "busy")
  assert.equal(canMoveSlot(base({ done: new Map([[1, "2026-10-20"]]) }), 1, "2026-10-24"), "done")
  // week 1 already has slots 1 and 2 done → slot 3 can't join them
  assert.equal(canMoveSlot(base({ today: "2026-10-23", done: new Map([[1, "2026-10-20"], [2, "2026-10-22"]]) }), 3, "2026-10-25"), "week_full")
  // its own planned day is fine
  assert.equal(canMoveSlot(input, 1, "2026-10-20"), true)
  const open = daysToMove(input, 2)
  assert.ok(open.includes("2026-10-22") && open.includes("2026-10-24") && !open.includes("2026-10-21"))
}

console.log("all plan schedule tests passed")

// ─── Reminders ───────────────────────────────────────────────────────────────
{
  const slots = schedulePlan(base({ today: "2026-10-19" }))
  const now = new Date(2026, 9, 19, 12, 0)
  // only the next 7 days: Tue 20 and Thu 22 (Tue 27 is 8 days out)
  const r = planReminders(slots, null, now, { 1: "Strength" })
  assert.deepEqual(r.map((x) => x.index), [1, 2])
  assert.equal(r[0].at.getTime(), new Date(2026, 9, 20, 9, 0).getTime())
  assert.equal(r[0].body, "Strength")
  assert.equal(r[1].body, "Workout 2")
  // with a training time: 1 hour before
  const t = planReminders(slots, "18:00", now)
  assert.equal(t[0].at.getTime(), new Date(2026, 9, 20, 17, 0).getTime())
  assert.equal(t[0].title, "Training in 1 hour")
  // past reminders and done / unfit slots are skipped
  assert.deepEqual(planReminders(slots, "18:00", new Date(2026, 9, 20, 17, 30)).map((x) => x.index), [2])
  assert.deepEqual(planReminders([{ index: 1, date: "2026-10-20", state: "done" }, { index: 2, date: null, state: "unfit" }], null, now), [])
}

console.log("all plan schedule reminder tests passed")

// ─── From the rows ───────────────────────────────────────────────────────────
{
  const homework = [
    { $id: "a", scheduledFor: new Date(2026, 9, 20, 18).toISOString() },
    { $id: "b", scheduledFor: new Date(2026, 9, 22, 18).toISOString(), homeworkStatus: "cant_attend" as const },
    { $id: "c", scheduledFor: new Date(2026, 9, 27, 18).toISOString() },
    { $id: "d", scheduledFor: null },
  ]
  const busy = homeworkBusyDays(homework, [{ protocolId: "c" }])
  assert.deepEqual([...busy], ["2026-10-20"])
  const plan = { windowStart: "2026-10-19", windowEnd: "2026-11-29", trainingDays: [2, 4], trainingTime: null, scheduleOverrides: {} }
  const s = scheduleFor(plan, new Map(), homework, [{ protocolId: "c" }], new Date(2026, 9, 19, 8))
  assert.deepEqual(s.slice(0, 2).map((x) => x.date), ["2026-10-22", "2026-10-27"])
}

console.log("all plan schedule row tests passed")
