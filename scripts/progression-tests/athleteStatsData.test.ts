// Tests for reading the coach Stats card out of an athlete's history
// (utils/athleteStatsData.ts — docs/athlete-stats.md). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/athleteStatsData.test.ts

import assert from "node:assert/strict"
import { blockReview } from "@/utils/athleteStats"
import {
  blockWeeks, buildAllBlocksStats, buildBlockStats, edgeLiftSeries, parseSessions, projectSessions,
  scPatternStats, warmupSessions,
} from "@/utils/athleteStatsData"

const ts = (date: string, hour = 12, min = 0) => new Date(`${date}T${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}:00`).getTime()
let n = 0
const session = (date: string, protocol: any[], attempts: any[]) => ({
  $id: `s${++n}`,
  $createdAt: new Date(ts(date)).toISOString(),
  protocol: JSON.stringify(protocol),
  attempts: JSON.stringify(attempts.length ? attempts : [{ blockIndex: -1, timestamp: ts(date) }]),
})

const plan = { $id: "p1", windowStart: "2026-10-05", windowEnd: "2026-11-15", pauses: [] }

// ─── weeks ───
const w = blockWeeks(plan, "2026-10-21")
assert.deepEqual(w.map((x) => x.label), ["W1", "W2", "W3"])
assert.equal(w[0].end, "2026-10-11")
assert.equal(w[2].end, "2026-10-25")
assert.equal(blockWeeks(plan, "2026-12-01").length, 6)
// A one-week pause: the week stands still, so its days fold into W2
const paused = { ...plan, windowEnd: "2026-11-22", pauses: [{ start: "2026-10-19", end: "2026-10-25" }] }
const pw = blockWeeks(paused, "2026-10-28")
assert.deepEqual(pw.map((x) => x.label), ["W1", "W2", "W3"])
assert.equal(pw[1].end, "2026-10-25")

// ─── edge lift: the max standing at the end of each week ───
const log = JSON.stringify([{ kg: 42, date: "2026-10-20", source: "test" }, { kg: 38, date: "2026-09-30", source: "test" }])
assert.deepEqual(edgeLiftSeries(log, w), [{ label: "W1", value: 38 }, { label: "W2", value: 38 }, { label: "W3", value: 42 }])
assert.deepEqual(edgeLiftSeries(null, w), [])

// ─── blocks ───
const fourByFour = { type: "four_by_four", bouldersPerSet: 4 }
const pe = { type: "intervals", kind: "power_endurance", blockName: "PE intervals" }
const warm = { type: "intervals", kind: "warmup", blockName: "1 on 1 off" }
const project = { type: "project_bouldering", grade: "yellow", timeLimit: 20 }
const sc = {
  type: "strength_conditioning",
  exercises: [
    { name: "Weighted pull-up", exerciseId: "pu", movementType: "pull_vertical", focus: "max_force" },
    { name: "Pancake", exerciseId: "pk", movementType: "mobility" },
    { name: "Push-up ladder", exerciseId: "pl", focus: "hypertrophy", levels: [{ exerciseId: "l1" }, { exerciseId: "l2" }, { exerciseId: "l3" }] },
  ],
}
const library = [{ $id: "pl", movementType: "push", loadMode: "level" as const }, { $id: "pu", movementType: "pull_vertical" }]
const scRound = (date: string, exerciseId: string, name: string, round: number, extra: any) =>
  ({ blockIndex: 4, type: "strength_conditioning", timestamp: ts(date, 12, round), scData: { exerciseId, exerciseName: name, round, ...extra } })

const sessions = [
  session("2026-10-06", [fourByFour, pe, warm, project, sc], [
    { blockIndex: 0, type: "four_by_four", timestamp: ts("2026-10-06", 12), scData: { grades: ["green", "green", "green", "green"], tops: 4 } },
    { blockIndex: 1, type: "intervals", timestamp: ts("2026-10-06", 12, 10), scData: { series: 6, workTime: 45, restTime: 60 } },
    { blockIndex: 2, type: "intervals", timestamp: ts("2026-10-06", 12, 5), scData: { series: 8, workTime: 60, restTime: 60 } },
    { blockIndex: 3, type: "project_bouldering", level: "yellow", success: false, timestamp: ts("2026-10-06", 13, 0) },
    { blockIndex: 3, type: "project_bouldering", level: "yellow", success: false, timestamp: ts("2026-10-06", 13, 25) },
    scRound("2026-10-06", "pu", "Weighted pull-up", 1, { weight: 10, repsCompleted: 5, focus: "max_force" }),
    scRound("2026-10-06", "pu", "Weighted pull-up", 2, { weight: 10, repsCompleted: 5, focus: "max_force" }),
    scRound("2026-10-06", "pk", "Pancake", 1, { repsCompleted: 30 }),
    scRound("2026-10-06", "l1", "Knee push-up", 1, { repsCompleted: 12, focus: "hypertrophy" }),
  ]),
  session("2026-10-20", [fourByFour, pe, warm, project, sc], [
    { blockIndex: 0, type: "four_by_four", timestamp: ts("2026-10-20", 12), scData: { grades: ["yellow", "yellow", "green", "green"], tops: 4 } },
    { blockIndex: 1, type: "intervals", timestamp: ts("2026-10-20", 12, 10), scData: { series: 6, workTime: 55, restTime: 60 } },
    { blockIndex: 2, type: "intervals", timestamp: ts("2026-10-20", 12, 5), scData: { series: 8, workTime: 75, restTime: 60 } },
    { blockIndex: 3, type: "project_bouldering", level: "yellow", success: true, timestamp: ts("2026-10-20", 13, 0) },
    scRound("2026-10-20", "pu", "Weighted pull-up", 1, { weight: 10, repsCompleted: 5, focus: "max_force" }),
    scRound("2026-10-20", "pu", "Weighted pull-up", 2, { weight: 12.5, repsCompleted: 4, focus: "max_force" }),
    scRound("2026-10-20", "l2", "Push-up", 1, { repsCompleted: 10, focus: "hypertrophy" }),
  ]),
  // Before the plan: left out of This block
  session("2026-09-20", [fourByFour], [
    { blockIndex: 0, type: "four_by_four", timestamp: ts("2026-09-20"), scData: { grades: ["red", "red", "red", "red"] } },
  ]),
]

const parsed = parseSessions(sessions as any)
assert.deepEqual(projectSessions(parsed, "2026-10-01", "2026-10-31"), [
  { label: "Oct 6", minutes: 25, grade: "yellow", sent: false },
  { label: "Oct 20", minutes: 20, grade: "yellow", sent: true },   // one attempt → time limit
])
assert.deepEqual(warmupSessions(parsed, "2026-10-01", "2026-10-31"), [{ label: "Oct 6", minutes: 8 }, { label: "Oct 20", minutes: 10 }])

const pats = scPatternStats(parsed, library, "2026-10-01", "2026-10-31")
assert.deepEqual(pats.map((p) => p.pattern), ["pull_vertical", "push"])   // mobility left out
assert.deepEqual(pats[0].exercises[0].byFocus.max_force, [{ label: "Oct 6", value: 10 }, { label: "Oct 20", value: 12.5 }])
assert.equal(pats[1].exercises[0].unit, "level")
assert.deepEqual(pats[1].exercises[0].byFocus.hypertrophy, [{ label: "Oct 6", value: 1 }, { label: "Oct 20", value: 2 }])

const workouts = [{ $id: "w1", $createdAt: new Date(ts("2026-10-04")).toISOString(), blocks: "[]", planIndex: 1 }]
const linked = sessions.map((s, i) => (i === 0 ? { ...s, protocolId: "w1" } : s))
const input = { athlete: { edgeLiftMaxLog: log }, sessions: linked as any, library, today: "2026-10-21" }
const block = buildBlockStats({ ...input, plan, planWorkouts: workouts })
const metric = (id: string) => block.metrics.find((m) => m.id === id)!
assert.deepEqual(metric("four_by_four").points, [{ label: "W1", value: 2 }, { label: "W3", value: 2.5 }])
assert.deepEqual(metric("intervals").points, [{ label: "W1", value: 45 }, { label: "W3", value: 55 }])
assert.deepEqual(metric("workouts").points.map((p) => p.value), [1, 0, 0])
assert.equal(metric("workouts").planned, 6)

// ─── review ───
const review = blockReview(block)
assert.equal(review.worse, 0)
assert.ok(review.better >= 5)   // edge lift, 4×4, intervals, pull-up, push-up ladder, 1 on 1 off
assert.equal(review.rows.find((r) => r.id === "warmup")?.change.delta, "▲ 2 min")
assert.equal(review.rows.find((r) => r.name === "Push-up ladder")?.change.delta, "▲ 1 level")
assert.equal(review.workouts?.value, "1 / 6")
assert.equal(review.projectsSent, 1)

// ─── all blocks ───
const old = { $id: "p0", windowStart: "2026-08-17", windowEnd: "2026-09-27", pauses: [] }
const all = buildAllBlocksStats({ ...input, plans: [plan, old], workoutsByPlan: { p1: workouts } })
assert.deepEqual(all.metrics.find((m) => m.id === "four_by_four")!.points, [{ label: "B1", value: 4 }, { label: "B2", value: 2.5 }])
assert.deepEqual(all.metrics.find((m) => m.id === "edge_lift_max")!.points, [{ label: "B2", value: 42 }])   // first max logged after B1 ended
assert.equal(all.metrics.find((m) => m.id === "workouts")!.planned, 12 + 6)

// ─── S&C a hand-built workout logs: no focus, no weight, no library id ───
const handBuilt = { type: "strength_conditioning", exercises: [{ name: "Pull-up" }, { name: "Row", exerciseId: "row" }] }
const bw = (date: string, round: number, reps: number) =>
  ({ blockIndex: 0, type: "strength_conditioning", timestamp: ts(date, 12, round), scData: { exerciseName: "Pull-up", round, repsCompleted: reps } })
const rowSet = (date: string, weight: number) =>
  ({ blockIndex: 0, type: "strength_conditioning", timestamp: ts(date, 14), scData: { exerciseId: "row", exerciseName: "Row", round: 1, weight, repsCompleted: 8 } })
const loose = parseSessions([
  session("2026-07-01", [handBuilt], [bw("2026-07-01", 1, 6), bw("2026-07-01", 2, 5), rowSet("2026-07-01", 30)]),
  session("2026-07-08", [handBuilt], [bw("2026-07-08", 1, 8), rowSet("2026-07-08", 32.5)]),
] as any)
const lib2 = [{ $id: "pu2", name: "Pull-up", movementType: "pull_vertical" }, { $id: "row", name: "Row", movementType: "pull_horizontal" }]
const hb = scPatternStats(loose, lib2, "2026-01-01", "2026-12-31")
assert.deepEqual(hb.map((p) => p.pattern), ["pull_vertical", "pull_horizontal"])
assert.equal(hb[0].exercises[0].name, "Pull-up (bodyweight)")
assert.equal(hb[0].exercises[0].unit, "reps")
assert.deepEqual(hb[0].exercises[0].byFocus.none, [{ label: "Jul 1", value: 6 }, { label: "Jul 8", value: 8 }])
assert.deepEqual(hb[1].exercises[0].byFocus.none, [{ label: "Jul 1", value: 30 }, { label: "Jul 8", value: 32.5 }])
// All blocks: S&C from outside any plan counts too
const allLoose = buildAllBlocksStats({ athlete: {}, sessions: [
  session("2026-07-01", [handBuilt], [rowSet("2026-07-01", 30)]),
] as any, library: lib2, today: "2026-10-21", plans: [], workoutsByPlan: {} })
assert.equal(allLoose.sc[0]?.pattern, "pull_horizontal")

console.log("athleteStatsData: all tests passed")
