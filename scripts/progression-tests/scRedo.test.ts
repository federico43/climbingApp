// Tests for redone S&C rounds (utils/scRedo.ts) and the coach's Progression
// card "Did" line (utils/scCoach.ts), on the shape of Nalguete's TRX Biceps
// Curl sessions (11 and 17 Nov 2026). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/scRedo.test.ts

import assert from "node:assert/strict"
import { scRoundKey, withoutRedoneRounds } from "@/utils/scRedo"
import { findScSessions } from "@/utils/scHistory"
import { coachExerciseView } from "@/utils/scCoach"

// Effort as logged on a hypertrophy round: Solid = RPE 8, Max = RPE 9.
const RPE: Record<string, string> = { solid: "8", max: "9" }
const sc = (blockIndex: number, round: number, reps: number, extra: any = {}, t = 0) => ({
  type: "strength_conditioning", blockIndex, timestamp: t,
  scData: { exerciseId: "curl", exerciseName: "TRX Biceps Curl", round, repsCompleted: String(reps), focus: "hypertrophy", ...(extra.effort ? { rpe: RPE[extra.effort] } : {}), ...extra },
})

// ─── Keys ───
assert.equal(scRoundKey(sc(2, 1, 10)), "2|1|curl")
assert.equal(scRoundKey(sc(2, 1, 10, { slot: 1 })), "2|1|#1")
assert.equal(scRoundKey(sc(2, 1, 10, { swappedFrom: { exerciseId: "orig" } })), "2|1|from:orig")
assert.equal(scRoundKey({ type: "sequence", blockIndex: 0, scData: { round: 1 } } as any), null)
assert.equal(scRoundKey({ type: "strength_conditioning", blockIndex: 0, scReview: { exerciseId: "curl" } } as any), "0|review|curl")

// ─── Latest log of a round wins, order kept, other attempts untouched ───
const other = { type: "strength_conditioning", blockIndex: 2, scData: { exerciseId: "ham", exerciseName: "TRX Hamstring Curl", round: 1, repsCompleted: "13" } }
const climb = { type: "sequence", blockIndex: 0, success: true }
const once = [climb, sc(2, 1, 10, { effort: "solid" }), other, sc(2, 2, 10, { effort: "max" }), sc(2, 3, 10, { effort: "max" })]
assert.equal(withoutRedoneRounds(once), once)   // nothing redone → same array
const redone = [...once, sc(2, 1, 10, { effort: "solid" }), sc(2, 2, 10, { effort: "solid" }), sc(2, 3, 10, { effort: "solid" })]
const kept = withoutRedoneRounds(redone)
assert.equal(kept.length, 5)
assert.deepEqual(kept.slice(0, 2), [climb, other])
assert.deepEqual(kept.slice(2).map((a: any) => a.scData.effort), ["solid", "solid", "solid"])
// Same round in another block is a different round
assert.equal(withoutRedoneRounds([sc(1, 1, 8), sc(2, 1, 8)]).length, 2)
// A redone review replaces the block's earlier review
const review = (v: string) => ({ type: "strength_conditioning", blockIndex: 2, scReview: { exerciseId: "curl", exerciseName: "TRX Biceps Curl", verdict: v } })
assert.deepEqual(withoutRedoneRounds([review("same"), review("improved")]).map((a: any) => a.scReview.verdict), ["improved"])

// ─── History reads old duplicated sessions once ───
const protocol = (blockIndex: number) => JSON.stringify(Array.from({ length: blockIndex + 1 }, (_, i) => i === blockIndex
  ? { type: "strength_conditioning", rounds: 3, exercises: [{ name: "TRX Biceps Curl", exerciseId: "curl", focus: "hypertrophy", reps: "8-12" }] }
  : { type: "free_session" }))
const nov17: any = { $id: "s17", $createdAt: "2026-11-17T15:39:16Z", userId: "a", protocol: protocol(2), attempts: JSON.stringify(redone) }
const e17 = findScSessions([nov17], ["curl"], "TRX Biceps Curl")[0]
assert.deepEqual(e17.summary.sets.map((s) => s.amount), [10, 10, 10])

// ─── The card shows every round, by load, and the effort of each ───
const nov11: any = {
  $id: "s11", $createdAt: "2026-11-11T15:34:10Z", userId: "a", protocol: protocol(1),
  attempts: JSON.stringify([
    sc(1, 1, 8, { effort: "max", atHardestSetting: false }),
    sc(1, 2, 7, { effort: "max", atHardestSetting: false }),
    sc(1, 3, 6, { effort: "max", atHardestSetting: true }),
  ]),
}
const library = [{ $id: "curl", name: "TRX Biceps Curl", loadMode: "weight" as const, levels: [], settingHarder: "Walk your feet closer to the anchor", settingEasier: "Step back so you're more upright" }]
const nov17Real: any = { ...nov17, attempts: JSON.stringify(once) }
const view = coachExerciseView([nov17Real, nov11], "TRX Biceps Curl", library, "kg")
assert.equal(view.rows[1].did, "Bodyweight · 8, 7 reps → Bodyweight · hardest setup · 6 reps · Max")
assert.equal(view.rows[1].result, "Make it easier: step back so you're more upright — under 8 reps that day")
assert.equal(view.rows[0].did, "Bodyweight · 10, 10, 10 reps · 1 Solid · 2 Max")
// Max on 2 of 3 hypertrophy rounds: too hard, step back
assert.ok(view.rows[0].result.startsWith("Make it easier"), view.rows[0].result)
// The redone 17 Nov (all Solid the second time) reads as three rounds
const viewRedone = coachExerciseView([nov17, nov11], "TRX Biceps Curl", library, "kg")
assert.equal(viewRedone.rows[0].did, "Bodyweight · 10, 10, 10 reps · Solid")
assert.equal(viewRedone.rows[0].result, "Aim for one more rep")

console.log("scRedo tests passed")
