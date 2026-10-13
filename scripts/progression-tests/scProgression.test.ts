// Tests for the S&C rule engine (utils/scProgression.ts) and the per-set
// history it reads (utils/scHistory.ts). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/scProgression.test.ts

import assert from "node:assert/strict"
import { planRoundRaise, convertWeight, decideNext, describeLevel, describeWeight, effortToRpe, nextWeight, planRoundDrop, repChoices, stepLevel, targetFor } from "@/utils/scProgression"
import { findLastScSets, readRound, setsAtFinalLoad } from "@/utils/scHistory"

// ─── targetFor ───────────────────────────────────────────────────────────────
assert.deepEqual(targetFor("max_force", "3-6"), { low: 3, high: 6, unit: "reps" })
assert.deepEqual(targetFor("hypertrophy", "whatever"), { low: 8, high: 12, unit: "reps" })   // focus wins for reps
assert.deepEqual(targetFor(undefined, "8-10"), { low: 8, high: 10, unit: "reps" })
assert.deepEqual(targetFor(undefined, "10"), { low: 10, high: 10, unit: "reps" })
assert.equal(targetFor(undefined, ""), null)
// Timed holds: the prescribed seconds, never the focus's rep range
assert.deepEqual(targetFor("max_force", "20-30", "seconds"), { low: 20, high: 30, unit: "seconds" })

// ─── decideNext: double progression ──────────────────────────────────────────
const mf = targetFor("max_force", "")!   // 3–6 reps, RPE band 8–9.5
const d = (sets: { amount: number; rpe?: number }[]) => decideNext(mf, sets, "max_force")

assert.equal(d([]).reason, "no_data")
// Every set at the top → up
assert.equal(d([{ amount: 6 }, { amount: 6 }, { amount: 7 }]).direction, "increase")
// Reps inside the range (5 of 3–6) are NOT a miss — the old bug lowered the weight here
assert.deepEqual([d([{ amount: 5 }, { amount: 6 }]).direction, d([{ amount: 5 }]).reason], ["hold", "in_range"])
// Any set under the floor → down
assert.deepEqual([d([{ amount: 6 }, { amount: 6 }, { amount: 2 }]).direction, d([{ amount: 2 }]).reason], ["decrease", "under_floor"])
// RPE is optional: no RPE still judged
assert.equal(d([{ amount: 6 }, { amount: 6 }]).direction, "increase")
// Most rated sets above the band → down, even in range
assert.equal(d([{ amount: 5, rpe: 10 }, { amount: 5, rpe: 10 }, { amount: 5, rpe: 8 }]).reason, "effort_too_high")
// Top of the range but one set above the band → hold
assert.equal(d([{ amount: 6, rpe: 10 }, { amount: 6, rpe: 9 }, { amount: 6, rpe: 9 }]).reason, "max_effort")
// RPE below the band no longer pushes up on its own (reps drive it)
assert.equal(d([{ amount: 4, rpe: 5 }]).direction, "hold")
// No focus → no RPE band; prescribed range still judges
assert.equal(decideNext(targetFor(undefined, "8-10")!, [{ amount: 10, rpe: 10 }]).direction, "increase")
// Timed hold: 20 s of a 20–30 s target is in range, not "add weight"
const hold = targetFor("max_force", "20-30", "seconds")!
assert.equal(decideNext(hold, [{ amount: 20 }], "max_force").direction, "hold")
assert.equal(decideNext(hold, [{ amount: 30 }, { amount: 31 }], "max_force").direction, "increase")
assert.equal(decideNext(hold, [{ amount: 15 }], "max_force").direction, "decrease")

// ─── nextWeight: between 0.5 kg and 2.5 kg per change (coach 2026-10-06) ──
assert.equal(nextWeight(4, "increase"), 4.5)        // 5 % = 0.2 → at least 0.5 kg
assert.equal(nextWeight(4, "decrease"), 3.5)
assert.equal(nextWeight(20, "increase"), 21)        // 5 % = 1 kg
assert.equal(nextWeight(40, "increase"), 42)        // 5 % = 2 kg
assert.equal(nextWeight(80, "increase"), 82.5)      // 5 % = 4 kg → capped at 2.5
assert.equal(nextWeight(100, "decrease", undefined, "kg", 0.10), 97.5)  // a 10 % drop is capped too
assert.equal(nextWeight(16, "increase", 2), 18)     // kettlebell jump, whole jumps
assert.equal(nextWeight(16, "decrease", 2), 14)
assert.equal(nextWeight(16, "increase", 4), 20)     // a coach jump above the cap wins
assert.equal(nextWeight(60, "increase", 2.5), 62.5) // barbell
assert.equal(nextWeight(100, "increase", 2.5), 102.5)
assert.equal(nextWeight(30, "increase", 1), 31)     // 1.5 kg wanted, whole 1 kg jumps → rounds down to 1
assert.equal(nextWeight(10, "increase", undefined, "lb"), 11)   // lb: 1 lb minimum
assert.equal(nextWeight(200, "increase", undefined, "lb"), 205) // lb: 5 lb cap
assert.equal(nextWeight(20, "hold"), 20)
assert.equal(nextWeight(0, "increase"), 0)          // bodyweight: no number to move
assert.equal(nextWeight(0.5, "decrease"), 0)        // never negative

// ─── Wording ─────────────────────────────────────────────────────────────────
const up = d([{ amount: 6 }, { amount: 6 }])
assert.equal(describeWeight(up, 20, 21, "kg"), "▲ 20 → 21 kg — 6 reps on every set")
assert.equal(describeWeight(d([{ amount: 2 }]), 20, 19, "kg", "today"), "▼ 20 → 19 kg — under 3 reps today")
assert.equal(describeWeight(d([{ amount: 5 }]), 20, 20, "kg"), "Same weight — aim for one more rep")
// Bodyweight never says "add weight"
assert.ok(!/weight/i.test(describeWeight(up, 0, 0, "kg")))
assert.equal(describeWeight(d([]), 20, 20, "kg"), "")

const chain = [{ exerciseId: "k", name: "Knee push-up" }, { exerciseId: "p", name: "Push-up" }]
assert.equal(describeLevel(up, chain[0], stepLevel(chain, 0, "increase")!), "▲ Knee push-up → Push-up — 6 reps on every set")
// At the hardest level: a note, nothing moves, never "add weight"
assert.equal(describeLevel(up, chain[1], stepLevel(chain, 1, "increase")!), "Top level reached — stay on this level")
assert.equal(describeLevel(d([{ amount: 1 }]), chain[0], stepLevel(chain, 0, "decrease")!), "Easiest level — stay on this level")
assert.equal(describeLevel(d([{ amount: 1 }]), chain[1], stepLevel(chain, 1, "decrease")!), "▼ Push-up → Knee push-up — under 3 reps last time")

// ─── History: per set, weaker side, final load only ──────────────────────────
// Both sides: weaker side's reps, harder side's RPE
assert.deepEqual(readRound({ exerciseId: "x", repsLeft: "6", repsRight: "4", rpeLeft: "7", rpeRight: "9", weightRight: "10" }),
  { exerciseId: "x", weight: 10, amount: 4, rpe: 9 })
// Only rounds at the final load count
assert.deepEqual(setsAtFinalLoad([
  { exerciseId: "x", weight: 20, amount: 2 },
  { exerciseId: "x", weight: 17.5, amount: 5 },
  { exerciseId: "x", weight: 17.5, amount: 6, rpe: 8 },
]), { exerciseId: "x", weight: 17.5, sets: [{ amount: 5 }, { amount: 6, rpe: 8 }] })
// …and the final level: a stepped-off level doesn't count
assert.deepEqual(setsAtFinalLoad([{ exerciseId: "p", amount: 2 }, { exerciseId: "k", amount: 6 }])!.sets, [{ amount: 6 }])
assert.equal(setsAtFinalLoad([]), null)

// findLastScSets reads every round of the newest session, oldest first
const session = {
  $id: "s1", $createdAt: "", userId: "a", protocol: "[]",
  attempts: JSON.stringify([3, 1, 2].map((round) => ({
    type: "strength_conditioning", blockIndex: 0,
    scData: { exerciseId: "kb", exerciseName: "KB squat", round, weight: "20", repsCompleted: String(round + 3) },
  }))),
}
assert.deepEqual(findLastScSets([session] as any, ["kb"], "KB squat"), { exerciseId: "kb", weight: 20, sets: [{ amount: 4 }, { amount: 5 }, { amount: 6 }] })

// ─── In-session: a round under the floor → next round one step easier ───────
const hyp = targetFor("hypertrophy", "")!   // 8–12
// 6 pull-ups on 8–12, bodyweight, no ladder: nothing to lower → pick an easier exercise
const bw = planRoundDrop(hyp, 6, { kind: "weight", weight: 0, unit: "kg" })!
assert.equal(bw.note, "You got 6 of 8–12 reps — pick an easier exercise for this round")
assert.equal(bw.pickEasier, true)
assert.equal(bw.weight, undefined)
assert.equal(bw.undo, undefined)
// Weighted: a suggestion only (coach 2026-10-06) — ~10 %, at least one
// loadStep; the weight itself isn't changed
assert.deepEqual(planRoundDrop(hyp, 6, { kind: "weight", weight: 20, unit: "kg" }),
  { note: "Lower the weight a little: try 18 kg — you got 6 of 8–12 reps", bannerOnly: true })
assert.ok(planRoundDrop(hyp, 6, { kind: "weight", weight: 16, loadStep: 4, unit: "kg" })!.note.includes("try 12 kg"))
assert.ok(planRoundDrop(hyp, 6, { kind: "weight", weight: 4, unit: "kg" })!.note.includes("try 3.5 kg"))   // 0.5 kg minimum
// Always one step, however far short
assert.ok(planRoundDrop(hyp, 1, { kind: "weight", weight: 20, unit: "kg" })!.note.includes("try 18 kg"))
// Level: one level down, with Undo
const pull = [{ exerciseId: "band", name: "Band pull-up" }, { exerciseId: "pull", name: "Pull-up" }]
assert.deepEqual(planRoundDrop(hyp, 6, { kind: "level", chain: pull, idx: 1 }),
  { note: "Easier this round: Pull-up → Band pull-up — you got 6 of 8–12 reps", level: pull[0], undo: { level: pull[1] } })
// Already the easiest level → pick an easier exercise
const easiest = planRoundDrop(hyp, 6, { kind: "level", chain: pull, idx: 0 })!
assert.equal(easiest.level, undefined)
assert.equal(easiest.pickEasier, true)
assert.ok(!/fewer reps/.test(easiest.note))
// At or above the floor, or nothing to judge → no change
assert.equal(planRoundDrop(hyp, 8, { kind: "weight", weight: 20, unit: "kg" }), null)
assert.equal(planRoundDrop(hyp, 14, { kind: "weight", weight: 20, unit: "kg" }), null)   // ceiling: next session's call
assert.equal(planRoundDrop(null, 2, { kind: "weight", weight: 20, unit: "kg" }), null)
assert.equal(planRoundDrop(hyp, undefined, { kind: "weight", weight: 20, unit: "kg" }), null)
// Timed hold
assert.equal(planRoundDrop(hold, 15, { kind: "weight", weight: 10, unit: "kg" })!.note, "Lower the weight a little: try 9 kg — you got 15 of 20–30 s")

// A session with an automatic drop doesn't step straight back up next time
assert.equal(decideNext(hyp, [{ amount: 12 }, { amount: 12 }], "hypertrophy", { droppedInSession: true }).reason, "dropped_in_session")
assert.equal(decideNext(hyp, [{ amount: 6 }], "hypertrophy", { droppedInSession: true }).direction, "decrease")
assert.equal(readRound({ repsCompleted: "8", adjustedFrom: { weight: "20" } }).adjusted, true)
assert.equal(setsAtFinalLoad([{ weight: 20, amount: 6 }, { weight: 18, amount: 12, adjusted: true }])!.droppedInSession, true)
assert.equal(setsAtFinalLoad([{ weight: 20, amount: 8 }])!.droppedInSession, undefined)

// ─── Logging helpers (Phase 4) ───────────────────────────────────────────────
// Effort → RPE: Easy below the band, Solid mid-band, Max above it
assert.deepEqual(["easy", "solid", "max"].map((e) => effortToRpe(e as any, "max_force")), [7, 9, 10])
assert.deepEqual(["easy", "solid", "max"].map((e) => effortToRpe(e as any, "hypertrophy")), [6, 8, 9])
assert.deepEqual(["easy", "solid", "max"].map((e) => effortToRpe(e as any, "explosiveness")), [3, 5, 6.5])
assert.deepEqual(["easy", "solid", "max"].map((e) => effortToRpe(e as any)), [6, 8, 9.5])
// …and the engine reads them as intended: Max on every set = effort too high
assert.equal(d([{ amount: 5, rpe: effortToRpe("max", "max_force") }]).reason, "effort_too_high")
assert.equal(d([{ amount: 6, rpe: effortToRpe("solid", "max_force") }]).direction, "increase")
assert.equal(d([{ amount: 6, rpe: effortToRpe("easy", "max_force") }]).direction, "increase")
// Rep buttons: one under the floor to one over the top
assert.deepEqual(repChoices(hyp), [7, 8, 9, 10, 11, 12, 13])
assert.deepEqual(repChoices(mf), [2, 3, 4, 5, 6, 7])
assert.deepEqual(repChoices(targetFor(undefined, "1-3")!), [1, 2, 3, 4])
// kg ↔ lb, rounded to 0.5
assert.equal(convertWeight(20, "kg", "lb"), 44)
assert.equal(convertWeight(45, "lb", "kg"), 20.5)
assert.equal(convertWeight(20, "kg", "kg"), 20)
// History read in the athlete's current unit
assert.equal(readRound({ weight: "20", weightUnit: "kg" }, "lb").weight, 44)
assert.equal(readRound({ weight: "44", weightUnit: "lb" }, "kg").weight, 20)
assert.equal(readRound({ weight: "20" }, "lb").weight, 44)   // older logs without a unit were kg
assert.equal(readRound({ weight: "20", weightUnit: "lb" }).weight, 20)   // no unit asked → as logged

// In-session drop skips levels not tagged for the focus
const tagChain = [{ exerciseId: "band", name: "Band" }, { exerciseId: "neg", name: "Negative" }, { exerciseId: "pull", name: "Pull" }]
const noNeg = (st: { exerciseId: string }) => st.exerciseId !== "neg"
assert.equal(planRoundDrop(hyp, 2, { kind: "level", chain: tagChain, idx: 2, usable: noNeg })!.level?.name, "Band")
assert.equal(planRoundDrop(hyp, 2, { kind: "level", chain: tagChain, idx: 1, usable: (st) => st.exerciseId === "neg" })!.pickEasier, true)

// Exercise with a setting: the in-session miss is a banner only (Q5)
const benchDrop = planRoundDrop(hyp, 6, { kind: "weight", weight: 20, unit: "kg" }, "Raise the bench")!
assert.deepEqual(benchDrop, { note: "Make it easier this round: raise the bench — you got 6 of 8–12 reps", bannerOnly: true })
assert.equal(planRoundDrop(hyp, 9, { kind: "weight", weight: 20, unit: "kg" }, "Raise the bench"), null)
// History: the setting is part of the load
assert.equal(readRound({ repsCompleted: "8", atHardestSetting: true }).hardest, true)
assert.deepEqual(setsAtFinalLoad([{ exerciseId: "x", amount: 12 }, { exerciseId: "x", amount: 7, hardest: true }]),
  { exerciseId: "x", weight: undefined, sets: [{ amount: 7 }], atHardest: true })

// Above the range → make it harder now, as a suggestion
const raise = (amount: number, load: any, focus: any = "hypertrophy", t = hyp) => planRoundRaise(t, amount, focus, { unit: "kg", ...load })
// Setup not at its hardest → the coach's hint
assert.deepEqual(raise(14, { settingHarder: "Lower the box height" }),
  { note: "Make it harder this round: lower the box height — you got 14 of 8–12 reps", bannerOnly: true, raise: true })
assert.equal(raise(13, { settingHarder: "Lower the box height" })!.raise, true)
assert.equal(raise(12, { settingHarder: "Lower the box height" }), null)                       // the top itself: next session
assert.equal(raise(14, { settingHarder: "Lower the box height", atHardest: true }), null)      // hardest setup, no weight: level waits
assert.equal(raise(9, { settingHarder: "Lower the box height" }, "explosiveness", targetFor("explosiveness", "")!), null)
assert.equal(raise(35, { settingHarder: "Lean back less" }, "max_force", hold)!.note, "Make it harder this round: lean back less — you got 35 of 20–30 s")
// Weight (no setup) → add a little weight (~5 %, at least one jump)
assert.deepEqual(raise(14, { weight: 20 }), { note: "Add a little weight: try 21 kg — you got 14 of 8–12 reps", bannerOnly: true, raise: true })
assert.ok(raise(13, { weight: 16, loadStep: 4 })!.note.includes("try 20 kg"))
// Weight with its setup at the hardest → weight is next
assert.ok(raise(13, { weight: 20, settingHarder: "Lower the bench", atHardest: true })!.note.includes("try 21 kg"))
// Ladder / bodyweight without a setup → wait for next session
assert.equal(raise(14, { level: true }), null)
assert.equal(raise(14, { weight: 0 }), null)
assert.equal(raise(9, { weight: 20 }, "explosiveness", targetFor("explosiveness", "")!), null)

console.log("all scProgression tests passed")
