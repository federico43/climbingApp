// Tests for S&C level chains resolved at workout time (utils/levelChain.ts)
// and stepping along them (stepLevel in utils/scProgression.ts). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/levelChain.test.ts

import assert from "node:assert/strict"
import { chainIds, chainIndexOf, ladderHasFork, mergeIntoLadder, resolveExerciseChain, resolveFullChain } from "@/utils/levelChain"
import { stepLevel } from "@/utils/scProgression"
import { findLastScLog } from "@/utils/scHistory"

// Library: Knee push-up → Push-up → Elevated push-up, stored the way
// ExerciseForm syncs it — each row holds only its "harder than me" tail.
const knee = { $id: "knee", name: "Knee push-up", loadMode: "level" as const, levels: [{ exerciseId: "push", name: "Push-up" }, { exerciseId: "elev", name: "Elevated push-up" }] }
const push = { $id: "push", name: "Push-up", loadMode: "level" as const, levels: [{ exerciseId: "elev", name: "Elevated push-up" }] }
const elev = { $id: "elev", name: "Elevated push-up", loadMode: "level" as const, levels: [] }
const squat = { $id: "squat", name: "KB squat", loadMode: "weight" as const, levels: [] }
const library = [knee, push, elev, squat]
const names = (c: { chain: { name: string }[] } | null) => c?.chain.map((l) => l.name)

// The full chain resolves the same from any member
for (const id of ["knee", "push", "elev"]) {
  assert.deepEqual(resolveFullChain(id, library).map((l) => l.exerciseId), ["knee", "push", "elev"])
}

// A block prescribing Push-up with the old copy (harder tail only) still
// gets the easier Knee push-up from the library
const pushBlock = { exerciseId: "push", name: "Push-up", loadMode: "level" as const, levels: [{ exerciseId: "elev", name: "Elevated push-up" }] }
const r = resolveExerciseChain(pushBlock, library)!
assert.deepEqual(names(r), ["Knee push-up", "Push-up", "Elevated push-up"])
assert.equal(r.prescribedIdx, 1)

// Stale copy: the block says weight (added before the chain existed) → the library wins
assert.equal(resolveExerciseChain({ exerciseId: "push", name: "Push-up", loadMode: "weight" }, library)?.prescribedIdx, 1)

// No id (AI-made block) → matched by name, case-insensitive
assert.equal(resolveExerciseChain({ name: "elevated PUSH-UP" }, library)?.prescribedIdx, 2)

// The library says it's not (or no longer) in a chain → weight mode, even if the copy says level
assert.equal(resolveExerciseChain({ exerciseId: "squat", name: "KB squat", loadMode: "level", levels: [{ exerciseId: "x", name: "X" }] }, library), null)
assert.equal(resolveExerciseChain({ exerciseId: "squat", name: "KB squat" }, library), null)

// Offline (no library) → fall back to the block's copy
const offline = resolveExerciseChain(pushBlock, null)!
assert.deepEqual(names(offline), ["Push-up", "Elevated push-up"])
assert.equal(offline.prescribedIdx, 0)
assert.equal(resolveExerciseChain({ exerciseId: "squat", name: "KB squat" }, null), null)
// Offline + id-less copy → "" id for the prescribed step
assert.equal(resolveExerciseChain({ name: "Push-up", loadMode: "level", levels: push.levels }, null)!.chain[0].exerciseId, "")

// Not in the library at all (deleted row) → the copy
assert.deepEqual(names(resolveExerciseChain({ exerciseId: "gone", name: "Gone", loadMode: "level", levels: [{ exerciseId: "elev", name: "Elevated push-up" }] }, library)), ["Gone", "Elevated push-up"])

// Family ids + positions
assert.deepEqual(chainIds(r, "push"), ["push", "knee", "elev"])
assert.equal(chainIndexOf(r, "knee"), 0)
assert.equal(chainIndexOf(r, "nope"), -1)
assert.equal(chainIndexOf(r, undefined), -1)

// stepLevel: moves one step, clamps at both ends and says so
const c = r.chain
assert.deepEqual(stepLevel(c, 1, "decrease"), { index: 0, step: c[0], atTop: false, atBottom: true })
assert.deepEqual(stepLevel(c, 1, "increase"), { index: 2, step: c[2], atTop: true, atBottom: false })
assert.equal(stepLevel(c, 1, "hold")!.index, 1)
assert.equal(stepLevel(c, 2, "increase")!.index, 2)   // already at the top
assert.equal(stepLevel(c, 0, "decrease")!.index, 0)   // already at the bottom
assert.equal(stepLevel([], 0, "increase"), null)

// History: a round logged on the easier Knee push-up is found once the
// family is the full chain — the old harder-tail family missed it
const session = {
  $id: "s1", $createdAt: "", userId: "a", protocol: "[]",
  attempts: JSON.stringify([{ type: "strength_conditioning", blockIndex: 0, scData: { exerciseId: "knee", exerciseName: "Knee push-up", round: 1, repsCompleted: "4" } }]),
}
assert.equal(findLastScLog([session] as any, ["push", "elev"], "Push-up"), null)
assert.equal(findLastScLog([session] as any, chainIds(r, "push"), "Push-up")?.exerciseId, "knee")

// ─── Forks: two exercises saved on the same step ────────────────────────────
// The real pull-up library on 2026-10-05: chin-up isometric and Band Assisted
// both stored as "right below Negative pull-ups".
const pullLib = [
  { $id: "band", name: "Band Assisted Pull-Ups", loadMode: "level" as const, levels: [{ exerciseId: "neg", name: "Negative pull-ups" }, { exerciseId: "pull", name: "Pull Ups" }] },
  { $id: "pull", name: "Pull Ups", loadMode: "level" as const, levels: [] },
  { $id: "chin", name: "chin-up isometric", loadMode: "level" as const, levels: [{ exerciseId: "neg", name: "Negative pull-ups" }, { exerciseId: "pull", name: "Pull Ups" }] },
  { $id: "neg", name: "Negative pull-ups", loadMode: "level" as const, levels: [{ exerciseId: "pull", name: "Pull Ups" }] },
]
// Every member sees the same single line, all four included
for (const id of ["band", "pull", "chin", "neg"]) {
  assert.deepEqual(resolveFullChain(id, pullLib).map((l) => l.exerciseId), ["band", "chin", "neg", "pull"])
}
assert.equal(ladderHasFork("neg", pullLib), true)
assert.equal(ladderHasFork("chin", pullLib), true)
// A healthy ladder isn't flagged
assert.equal(ladderHasFork("push", library), false)
assert.equal(ladderHasFork("squat", library), false)
// Fixed data (what saving the ladder writes) → no fork
const fixed = [
  { ...pullLib[0], levels: [{ exerciseId: "chin", name: "chin-up isometric" }, { exerciseId: "neg", name: "Negative pull-ups" }, { exerciseId: "pull", name: "Pull Ups" }] },
  pullLib[1], pullLib[2], pullLib[3],
]
assert.equal(ladderHasFork("neg", fixed), false)
assert.deepEqual(resolveFullChain("pull", fixed).map((l) => l.exerciseId), ["band", "chin", "neg", "pull"])
// A loop doesn't hang or drop anyone
const loop = [
  { $id: "a", name: "A", loadMode: "level" as const, levels: [{ exerciseId: "b", name: "B" }] },
  { $id: "b", name: "B", loadMode: "level" as const, levels: [{ exerciseId: "a", name: "A" }] },
]
assert.equal(resolveFullChain("a", loop).length, 2)
assert.equal(ladderHasFork("a", loop), true)

// ─── Merging when linking an exercise that already has a ladder ──────────────
const step = (id: string) => ({ exerciseId: id, name: id })
const self = step("__self__")
// New "Band" exercise (alone), adding Negative as harder: Negative's ladder
// (chin → neg → pull) comes along — no fork
assert.deepEqual(
  mergeIntoLadder([self], "__self__", step("neg"), ["chin", "neg", "pull"].map(step), "harder").map((l) => l.exerciseId),
  ["chin", "__self__", "neg", "pull"],
)
// Adding as easier: picked right below self, its harder steps above self
assert.deepEqual(
  mergeIntoLadder([self, step("x")], "__self__", step("neg"), ["chin", "neg", "pull"].map(step), "easier").map((l) => l.exerciseId),
  ["chin", "neg", "__self__", "pull", "x"],
)
// Picked exercise with no ladder: plain insert next to self
assert.deepEqual(
  mergeIntoLadder([step("e"), self, step("h")], "__self__", step("n"), [], "harder").map((l) => l.exerciseId),
  ["e", "__self__", "n", "h"],
)
// Never duplicates a step already in the ladder
const merged = mergeIntoLadder([step("chin"), self], "__self__", step("neg"), ["chin", "neg", "pull"].map(step), "harder")
assert.equal(new Set(merged.map((l) => l.exerciseId)).size, merged.length)

// "Used for" tags come along with the resolved chain, and drive usableAt
import("@/utils/levelChain").then(({ usableAt }) => {
  const lib = [
    { $id: "a", name: "A", loadMode: "level" as const, levels: [{ exerciseId: "b", name: "B" }], focuses: ["max_force" as const] },
    { $id: "b", name: "B", loadMode: "level" as const, levels: [], focuses: [] },
  ]
  const r = resolveExerciseChain({ exerciseId: "b", name: "B" }, lib)!
  assert.deepEqual(r.focuses, { a: ["max_force"] })
  assert.equal(usableAt(r, "explosiveness")({ exerciseId: "a", name: "A" }), false)
  assert.equal(usableAt(r, "max_force")({ exerciseId: "a", name: "A" }), true)
  assert.equal(usableAt(r, "explosiveness")({ exerciseId: "b", name: "B" }), true)   // empty = all
  assert.equal(usableAt(r, undefined)({ exerciseId: "a", name: "A" }), true)
  // stepLevel skips unusable steps, and stays put when none are left
  const c = r.chain
  assert.equal(stepLevel(c, 1, "decrease", usableAt(r, "explosiveness"))!.index, 1)
  assert.equal(stepLevel(c, 1, "decrease", usableAt(r, "max_force"))!.index, 0)
  console.log("levelChain tests passed")
})
