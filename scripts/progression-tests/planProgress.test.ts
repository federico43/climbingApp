// Tests for athlete plan progress (utils/planProgress.ts — docs/redesign.md
// §4). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/planProgress.test.ts

import assert from "node:assert/strict"
import {
  daysLeft, donePlanWorkouts, doneThisWeek, planDays, sessionLocalDate, trainedDaysIn,
} from "@/utils/planProgress"

const at = (date: string, hour = 12) => new Date(`${date}T${String(hour).padStart(2, "0")}:00:00`).toISOString()
const blocks = (...ids: string[]) => JSON.stringify(ids.map((id) => ({ id, type: "free_session" })))
const session = (date: string, extra: Record<string, any> = {}) => ({
  $createdAt: at(date),
  attempts: JSON.stringify([{ timestamp: new Date(at(date)).getTime() }]),
  protocol: "[]",
  ...extra,
})

const workouts = [
  { $id: "w1", $createdAt: at("2026-10-05", 8), blocks: blocks("a1", "a2"), planIndex: 1 },
  { $id: "w1sc", $createdAt: at("2026-10-05", 8), blocks: blocks("s1"), planIndex: 1, planPart: "sc" as const },
  { $id: "w2", $createdAt: at("2026-10-07", 8), blocks: blocks("b1", "b2"), planIndex: 2 },
  { $id: "w3", $createdAt: at("2026-10-12", 8), blocks: blocks("c1"), planIndex: 3 },
]

// ── linked sessions ──
{
  const done = donePlanWorkouts("p1", workouts, [
    session("2026-10-06", { protocolId: "w1", planId: "p1", planIndex: 1 }),
    session("2026-10-06", { protocolId: "w1sc", planId: "p1", planIndex: 1 }), // S&C part: no extra count
    session("2026-10-09", { protocolId: "w2", planId: "p1", planIndex: 2 }),
  ])
  assert.deepEqual([...done.entries()].sort(), [[1, "2026-10-06"], [2, "2026-10-09"]])
}

// S&C part alone doesn't make the workout done
assert.equal(donePlanWorkouts("p1", workouts, [session("2026-10-06", { protocolId: "w1sc" })]).size, 0)

// Homework (same slot) never makes the plan workout done
assert.equal(donePlanWorkouts("p1", [...workouts,
  { $id: "w1hw", $createdAt: at("2026-10-05", 8), blocks: blocks("a1"), planIndex: 1, planPart: "homework" as const },
], [session("2026-10-06", { protocolId: "w1hw" })]).size, 0)

// Workout deleted since — trust the session's own plan slot (same plan only)
{
  const done = donePlanWorkouts("p1", workouts, [
    session("2026-10-14", { protocolId: "gone", planId: "p1", planIndex: 4 }),
    session("2026-10-14", { protocolId: "gone2", planId: "other", planIndex: 5 }),
  ])
  assert.deepEqual([...done.keys()], [4])
}

// ── unlinked (older) sessions: matched on block ids ──
{
  const done = donePlanWorkouts("p1", workouts, [
    session("2026-10-06", { protocol: blocks("a2") }),        // skipped a1 → still w1
    session("2026-10-10", { protocol: blocks("zz") }),        // a sequence etc. → nothing
    session("2026-10-10", { protocol: blocks("s1") }),        // S&C part → nothing
    session("2026-10-11", { protocol: blocks("c1") }),        // before w3 was built → nothing
  ])
  assert.deepEqual([...done.keys()], [1])
}

// ── unlinked sessions of saved workouts: no block ids (stripLocalIds) → matched on content ──
{
  const b = (type: string, blockName: string, exercises?: string[]) =>
    ({ type, blockName, ...(exercises ? { exercises: exercises.map((name) => ({ name })) } : {}) })
  const warmup = b("constraint_warmup", "Warm-up")
  const saved = [
    { $id: "x1", $createdAt: at("2026-10-05", 8), planIndex: 1,
      blocks: JSON.stringify([warmup, b("four_by_four", "4x4"), b("strength_conditioning", "S&C", ["Pull-up", "Row"])]) },
    { $id: "x2", $createdAt: at("2026-10-07", 8), planIndex: 2,
      blocks: JSON.stringify([warmup, b("intervals", "Intervals"), b("strength_conditioning", "S&C", ["Squat"])]) },
  ]
  const done = donePlanWorkouts("p1", saved, [
    // x1 as built, coached flag and all
    session("2026-10-06", { protocol: JSON.stringify([{ ...warmup, coached: true }, b("four_by_four", "4x4"), b("strength_conditioning", "S&C", ["Pull-up", "Row"])]) }),
    // x2 with its S&C skipped
    session("2026-10-08", { protocol: JSON.stringify([warmup, b("intervals", "Intervals")]) }),
  ])
  assert.deepEqual([...done.entries()].sort(), [[1, "2026-10-06"], [2, "2026-10-08"]])

  // Only the shared warm-up → under half of any workout → nothing
  assert.equal(donePlanWorkouts("p1", saved, [session("2026-10-08", { protocol: JSON.stringify([warmup]) })]).size, 0)
  // A tie goes to the latest built on or before the session
  const twins = [
    { $id: "t1", $createdAt: at("2026-10-05", 8), planIndex: 1, blocks: JSON.stringify([warmup, b("free_session", "Free")]) },
    { $id: "t2", $createdAt: at("2026-10-07", 8), planIndex: 2, blocks: JSON.stringify([warmup, b("free_session", "Free")]) },
  ]
  assert.deepEqual([...donePlanWorkouts("p1", twins, [session("2026-10-08", { protocol: twins[0].blocks })]).keys()], [2])
  assert.deepEqual([...donePlanWorkouts("p1", twins, [session("2026-10-06", { protocol: twins[0].blocks })]).keys()], [1])
}

// Done twice → earliest day counts
assert.equal(
  donePlanWorkouts("p1", workouts, [
    session("2026-10-08", { protocolId: "w1" }),
    session("2026-10-06", { protocol: blocks("a1") }),
  ]).get(1),
  "2026-10-06",
)

// ── days ──
const start = "2026-10-05"
const end = "2026-11-15"
assert.equal(planDays(start, end).length, 42)
assert.equal(planDays(start, end)[0], start)
assert.equal(planDays(start, end)[41], end)

assert.equal(daysLeft(start, end, start), 42)
assert.equal(daysLeft(start, end, "2026-10-01"), 42) // not started yet
assert.equal(daysLeft(start, end, end), 1)
assert.equal(daysLeft(start, end, "2026-11-16"), 0)

assert.deepEqual(
  [...trainedDaysIn(start, end, [session("2026-10-04"), session("2026-10-06"), session("2026-10-06"), session("2026-11-16")])],
  ["2026-10-06"],
)

const done = new Map([[1, "2026-10-06"], [2, "2026-10-09"], [3, "2026-10-13"]])
assert.equal(doneThisWeek(start, done, "2026-10-11"), 2)
assert.equal(doneThisWeek(start, done, "2026-10-12"), 1)

// Local day, not UTC: a late-evening first attempt stays on its day
assert.equal(
  sessionLocalDate({ $createdAt: at("2026-10-07"), attempts: JSON.stringify([{ timestamp: new Date(2026, 9, 6, 23, 30).getTime() }]) }),
  "2026-10-06",
)

console.log("planProgress: all tests passed")
