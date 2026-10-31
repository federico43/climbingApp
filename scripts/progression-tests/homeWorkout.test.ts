// Tests for which workout the athlete's Home shows (utils/homeWorkout.ts). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/homeWorkout.test.ts

import assert from "node:assert/strict"
import type { ProtocolRow } from "@/services/BoulderGraphService"
import { pickLatestWorkout } from "@/utils/homeWorkout"

const row = ($id: string, day: number, extra: Partial<ProtocolRow> = {}): ProtocolRow => ({
  $id, $createdAt: `2026-10-${String(day).padStart(2, "0")}T12:00:00.000Z`, name: $id, blocks: "[]", athleteId: "a", ...extra,
})

const old = row("old", 1, { planId: "p", planIndex: 1 })
const mid = row("mid", 5)
const newest = row("new", 9, { planId: "p", planIndex: 2 })
const sc = row("sc", 9, { planId: "p", planIndex: 2, planPart: "sc" })
const oldSc = row("oldSc", 1, { planId: "p", planIndex: 1, planPart: "sc" })
const saved = row("saved", 12, { source: "library" })
const hw = row("hw", 12, { planPart: "homework" })
const all = [old, oldSc, mid, newest, sc, saved, hw]

// No pick: the newest coach workout (not the athlete's saves or homework), with its S&C.
{
  const r = pickLatestWorkout(all)
  assert.equal(r.workout?.$id, "new")
  assert.equal(r.scPart?.$id, "sc")
  assert.equal(r.picked, false)
}

// The coach's pick wins, even if older, and brings its own S&C.
{
  const r = pickLatestWorkout(all, "old")
  assert.equal(r.workout?.$id, "old")
  assert.equal(r.scPart?.$id, "oldSc")
  assert.equal(r.picked, true)
  assert.equal(pickLatestWorkout(all, "mid").scPart, null)
}

// A pick that's gone (deleted) or isn't a coach workout falls back to the newest.
for (const id of ["deleted", "saved", "hw", "sc"]) {
  const r = pickLatestWorkout(all, id)
  assert.equal(r.workout?.$id, "new", id)
  assert.equal(r.picked, false, id)
}

// Nothing built yet.
assert.deepEqual(pickLatestWorkout([saved, hw], "saved"), { workout: null, scPart: null, picked: false })

console.log("homeWorkout: all tests passed")
