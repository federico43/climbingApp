// Tests for utils/pushLog.ts (Settings › Notifications sent). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/pushLogScreen.test.ts

import assert from "node:assert/strict"
import { groupByDay, humanize, timeLabel } from "@/utils/pushLog"

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 5).toISOString()
const now = new Date(2026, 10, 3, 18, 0)

{
  const groups = groupByDay([{ at: at(2026, 11, 3, 9) }, { at: at(2026, 11, 3, 8) }, { at: at(2026, 11, 2) }, { at: at(2026, 10, 27) }, { at: "nope" }], now)
  assert.deepEqual(groups.map((g) => [g.label, g.entries.length]), [
    ["Today", 2], ["Yesterday", 1], [new Date(2026, 9, 27).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }), 1], ["Unknown date", 1],
  ])
  assert.deepEqual(groupByDay([], now), [])
}

assert.equal(timeLabel(at(2026, 11, 3, 7)), "07:05")
assert.equal(timeLabel("nope"), "")
assert.equal(humanize("class_tomorrow"), "Class tomorrow")
assert.equal(humanize("notifyCoach"), "Notify coach")
assert.equal(humanize("classCron"), "Hourly reminders")
assert.equal(humanize(null), "")

console.log("pushLogScreen tests passed")
