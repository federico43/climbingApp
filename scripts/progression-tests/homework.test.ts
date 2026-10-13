// Tests for homework status (utils/homework.ts —
// docs/training-plan-implementation.md §8). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/homework.test.ts

import assert from "node:assert/strict"
import { defaultDueBy, dueByOf, homeworkName, homeworkStatus, shortDay, type HomeworkRow } from "@/utils/homework"

const at = (date: string, hour = 12) => new Date(`${date}T${String(hour).padStart(2, "0")}:00:00`).toISOString()
const session = (date: string, protocolId: string) => ({
  $createdAt: at(date),
  attempts: JSON.stringify([{ timestamp: new Date(at(date)).getTime() }]),
  protocol: "[]",
  protocolId,
})
const hw = (extra: Partial<HomeworkRow> = {}): HomeworkRow =>
  ({ $id: "hw1", $createdAt: at("2026-10-07", 9), name: "Density test", dueBy: "2026-10-12", ...extra })
const state = (h: HomeworkRow, today: string, sessions: any[] = []) => homeworkStatus(h, sessions, today)

// deadline: 5 days by default; rows without one get it from the day they were made
assert.equal(defaultDueBy("2026-10-07"), "2026-10-12")
assert.equal(dueByOf(hw({ dueBy: null })), "2026-10-12")
assert.equal(dueByOf(hw({ dueBy: "2026-10-20" })), "2026-10-20")

assert.deepEqual(state(hw(), "2026-10-07"), { state: "not_scheduled" })
assert.deepEqual(state(hw({ scheduledFor: at("2026-10-09", 18) }), "2026-10-07"), { state: "scheduled", date: "2026-10-09" })
assert.deepEqual(state(hw({ scheduledFor: at("2026-10-09", 18) }), "2026-10-09"), { state: "scheduled", date: "2026-10-09" })
// the day passed, deadline not yet → missed (can still be moved)
assert.deepEqual(state(hw({ scheduledFor: at("2026-10-09", 18) }), "2026-10-10"), { state: "missed", date: "2026-10-09" })
// deadline passed → overdue, scheduled or not
assert.deepEqual(state(hw(), "2026-10-13"), { state: "overdue" })
assert.deepEqual(state(hw({ scheduledFor: at("2026-10-09", 18) }), "2026-10-13"), { state: "overdue" })
assert.deepEqual(state(hw({ homeworkStatus: "cant_attend" }), "2026-10-08"), { state: "cant_attend" })
// done wins over everything, on the first session started from it
const done = [session("2026-10-11", "hw1"), session("2026-10-10", "hw1"), session("2026-10-09", "other")]
assert.deepEqual(state(hw({ homeworkStatus: "cant_attend" }), "2026-10-20", done), { state: "done", date: "2026-10-10" })

assert.equal(shortDay("2026-10-12"), "Mon 12 Oct")
assert.equal(homeworkName("Workout 1 · Strength", [{ blockName: "Density test" }]), "Density test")
assert.equal(homeworkName("Workout 1 · Strength", [{ blockName: "A" }, { blockName: "B" }]), "Workout 1 · Strength · Homework")
assert.equal(homeworkName("W", [{ blockName: " " }]), "W · Homework")

console.log("all homework tests passed")

// ── reminders ──
{
  const { homeworkReminders, daysToPick, timeLabel } = await import("@/utils/homework")
  const kinds = (h: HomeworkRow, now: Date, sessions: any[] = []) =>
    homeworkReminders(h, sessions, now).map((r) => [r.kind, r.at.getTime()])
  const local = (date: string, h: number, m = 0) => { const [y, mo, d] = date.split("-").map(Number); return new Date(y, mo - 1, d, h, m) }
  const sched = hw({ scheduledFor: local("2026-10-10", 18).toISOString() })
  // scheduled Sat 18:00, now Thu → day before (Fri 18:00), 1 h before, next-morning nudge
  assert.deepEqual(kinds(sched, local("2026-10-08", 12)), [
    ["day_before", local("2026-10-09", 18).getTime()],
    ["hour_before", local("2026-10-10", 17).getTime()],
    ["missed", local("2026-10-11", 9).getTime()],
  ])
  // past ones are dropped
  assert.deepEqual(kinds(sched, local("2026-10-10", 17, 30)).map((k) => k[0]), ["missed"])
  // the nudge has buttons while there are days left; after the deadline it doesn't
  assert.equal(homeworkReminders(sched, [], local("2026-10-08", 12))[2].withActions, true)
  const lastDay = hw({ scheduledFor: local("2026-10-12", 18).toISOString() })
  const nudge = homeworkReminders(lastDay, [], local("2026-10-08", 12)).find((r) => r.kind === "missed")!
  assert.equal(nudge.withActions, false); assert.match(nudge.body, /overdue/)
  // done / can't attend → nothing
  assert.deepEqual(kinds(sched, local("2026-10-08", 12), [session("2026-10-08", "hw1")]), [])
  assert.deepEqual(kinds(hw({ homeworkStatus: "cant_attend" }), local("2026-10-08", 12)), [])
  // not scheduled → "pick a day" 2 days after it was given, 10:00
  assert.deepEqual(kinds(hw(), local("2026-10-07", 12)), [["pick_day", local("2026-10-09", 10).getTime()]])
  assert.deepEqual(kinds(hw(), local("2026-10-09", 11)), [])
  assert.deepEqual(kinds(hw({ dueBy: "2026-10-08" }), local("2026-10-07", 12)), [])        // past the deadline by then
  assert.deepEqual(daysToPick("2026-10-10", "2026-10-12"), ["2026-10-10", "2026-10-11", "2026-10-12"])
  assert.deepEqual(daysToPick("2026-10-13", "2026-10-12"), [])
  assert.equal(timeLabel(local("2026-10-10", 7, 5)), "7:05 AM")
  assert.equal(timeLabel(local("2026-10-10", 18, 0)), "6:00 PM")
  assert.equal(timeLabel(local("2026-10-10", 0, 30)), "12:30 AM")
  assert.equal(timeLabel(local("2026-10-10", 12, 0)), "12:00 PM")
  console.log("all homework reminder tests passed")
}
