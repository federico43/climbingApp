// Tests for S&C history matching by focus (utils/scHistory.ts). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/scHistory.test.ts

import assert from "node:assert/strict"
import { findLastScLog, findLastScSession, loggedFocus } from "@/utils/scHistory"

// A session with one S&C block holding a KB squat at `focus`; its rounds
// either log the focus themselves (new) or not (older logs, read from the
// protocol).
const session = (id: string, focus: string | undefined, weight: string, reps: string, logFocus: boolean) => ({
  $id: id, $createdAt: "", userId: "a",
  protocol: JSON.stringify([
    { type: "constraint_warmup" },
    { type: "strength_conditioning", exercises: [{ name: "KB squat", exerciseId: "kb", focus }] },
  ]),
  attempts: JSON.stringify([1, 2].map((round) => ({
    type: "strength_conditioning", blockIndex: 1,
    scData: { exerciseId: "kb", exerciseName: "KB squat", round, weight, rpe: "7", repsCompleted: reps, ...(logFocus ? { focus } : {}) },
  }))),
})

// newest first: hypertrophy last time, max force the time before
const sessions: any[] = [
  session("s3", "hypertrophy", "20", "10", true),
  session("s2", "explosiveness", "12", "5", false),
  session("s1", "max_force", "40", "4", false),
]

// no focus → the most recent session, whatever its focus (as before)
assert.equal(findLastScLog(sessions, ["kb"], "KB squat")!.weight, 20)
// with a focus → the last session at that focus
assert.equal(findLastScLog(sessions, ["kb"], "KB squat", "max_force")!.weight, 40)
assert.equal(findLastScLog(sessions, ["kb"], "KB squat", "hypertrophy")!.weight, 20)
assert.equal(findLastScLog(sessions, ["kb"], "KB squat", "explosiveness")!.repsCompleted, 5)
// never done at this focus → nothing to suggest from
assert.equal(findLastScLog(sessions.slice(0, 1), ["kb"], "KB squat", "max_force"), null)
// exercise with no focus in old sessions → doesn't count for a focused lookup
assert.equal(findLastScLog([session("s0", undefined, "30", "8", false)] as any, ["kb"], "KB squat", "max_force"), null)

// focus read from the round itself, else from the protocol (by id, level id or name)
const protocol = [{ type: "strength_conditioning", exercises: [
  { name: "Push-up", exerciseId: "pu", focus: "hypertrophy", levels: [{ exerciseId: "archer", name: "Archer push-up" }] },
] }]
assert.equal(loggedFocus({ blockIndex: 0, scData: { exerciseId: "pu", focus: "max_force" } }, protocol), "max_force")
assert.equal(loggedFocus({ blockIndex: 0, scData: { exerciseId: "pu" } }, protocol), "hypertrophy")
assert.equal(loggedFocus({ blockIndex: 0, scData: { exerciseId: "archer" } }, protocol), "hypertrophy")
assert.equal(loggedFocus({ blockIndex: 0, scData: { exerciseName: "Push-up" } }, protocol), "hypertrophy")
assert.equal(loggedFocus({ blockIndex: 3, scData: { exerciseId: "pu" } }, protocol), undefined)

// the coach's "already progressed to level X" flag still looks at any focus
assert.equal(findLastScSession(sessions, ["kb"], "KB squat")!.finalExerciseId, "kb")

console.log("all sc-history tests passed")
