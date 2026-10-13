// Tests for next-session planning with safety rails (utils/scNext.ts) and
// the multi-session history behind it (utils/scHistory.ts). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/scNext.test.ts

import assert from "node:assert/strict"
import { basisLine, planNext, planNextForFocus, type FocusEntry } from "@/utils/scNext"
import { findScSessions, findScSwaps, type ScSetsSummary } from "@/utils/scHistory"
import { coachExerciseView } from "@/utils/scCoach"

const hyp = { focus: "hypertrophy" as const, reps: "8-12" }   // 8–12 reps
const at = (weight: number, ...reps: number[]): ScSetsSummary => ({ exerciseId: "kb", weight, sets: reps.map((amount) => ({ amount })) })

// No history → nothing
assert.deepEqual(planNext(hyp, undefined, undefined, "kg", [], "last time"), { note: "", flags: {} })

// Normal step up / hold / down
assert.equal(planNext(hyp, undefined, undefined, "kg", [at(20, 12, 12, 12)], "last time").weight, 21)
assert.equal(planNext(hyp, undefined, undefined, "kg", [at(20, 10, 9)], "last time").weight, 20)
assert.equal(planNext(hyp, undefined, undefined, "kg", [at(20, 6)], "last time").weight, 19)

// Deload: down two sessions in a row → flagged for the coach only; the
// athlete gets the normal suggestion (coach, 2026-10-06)
const deload = planNext(hyp, undefined, undefined, "kg", [at(19, 6), at(20, 5)], "last time")
assert.equal(deload.flags.deload, true)
assert.equal(deload.weight, 18.5)   // the normal ▼ (5 % ≈ 0.95 → 0.5 kg jump)
assert.equal(deload.note, "▼ 19 → 18.5 kg — under 8 reps last time")
// One down after an up/hold isn't a deload
assert.equal(planNext(hyp, undefined, undefined, "kg", [at(20, 6), at(20, 10)], "last time").flags.deload, undefined)

// Stalled: the same load three sessions running without earning a step up
const stalled = planNext(hyp, undefined, undefined, "kg", [at(20, 10), at(20, 9), at(20, 10)], "last time")
assert.equal(stalled.flags.stalled, true)
assert.equal(stalled.weight, 20)
// …not when this one earns the step up
assert.equal(planNext(hyp, undefined, undefined, "kg", [at(20, 12, 12), at(20, 9), at(20, 10)], "last time").flags.stalled, undefined)
// …nor with only two sessions, or a load change in between
assert.equal(planNext(hyp, undefined, undefined, "kg", [at(20, 10), at(20, 9)], "last time").flags.stalled, undefined)
assert.equal(planNext(hyp, undefined, undefined, "kg", [at(20, 10), at(19, 12), at(20, 10)], "last time").flags.stalled, undefined)

// Level mode: flagged; the normal one-level step
const chain = { chain: [{ exerciseId: "k", name: "Knee push-up" }, { exerciseId: "p", name: "Push-up" }, { exerciseId: "e", name: "Elevated push-up" }], prescribedIdx: 1 }
const lvl = (id: string, ...reps: number[]): ScSetsSummary => ({ exerciseId: id, sets: reps.map((amount) => ({ amount })) })
const lvlDeload = planNext(hyp, chain, undefined, "kg", [lvl("e", 5), lvl("e", 6)], "last time")
assert.equal(lvlDeload.level?.name, "Push-up")
assert.equal(lvlDeload.flags.deload, true)
assert.equal(planNext(hyp, chain, undefined, "kg", [lvl("e", 12, 12)], "last time").note, "Top level reached — stay on this level")

// ─── History across sessions ─────────────────────────────────────────────────
const session = (id: string, weight: string, reps: string[], extra: any = {}) => ({
  $id: id, $createdAt: `2026-10-0${id.slice(1)}T10:00:00Z`, userId: "a",
  protocol: JSON.stringify([{ type: "strength_conditioning", exercises: [{ name: "KB squat", exerciseId: "kb", focus: "hypertrophy", reps: "8-12" }] }]),
  attempts: JSON.stringify(reps.map((r, i) => ({
    type: "strength_conditioning", blockIndex: 0,
    scData: { exerciseId: "kb", exerciseName: "KB squat", round: i + 1, weight, weightUnit: "kg", repsCompleted: r, ...extra },
  }))),
})
const sessions: any[] = [session("s3", "21", ["10", "9"], { effort: "solid" }), session("s2", "20", ["12", "12"]), session("s1", "20", ["10", "11"])]
const entries = findScSessions(sessions, ["kb"], "KB squat", { focus: "hypertrophy", unit: "kg" })
assert.deepEqual(entries.map((e) => e.sessionId), ["s3", "s2", "s1"])
assert.deepEqual(entries[0].summary, { exerciseId: "kb", weight: 21, sets: [{ amount: 10 }, { amount: 9 }] })
assert.equal(entries[0].prescribed, "8-12")
assert.equal(entries[0].focus, "hypertrophy")
assert.equal(entries[0].effort, "solid")
assert.equal(findScSessions(sessions, ["kb"], "KB squat", { limit: 2 }).length, 2)
assert.equal(findScSessions(sessions, ["kb"], "KB squat", { focus: "max_force" }).length, 0)
assert.equal(findScSessions(sessions, ["kb"], "KB squat", { unit: "lb" })[0].summary.weight, 46.5)

// Swaps: rounds where the athlete swapped this exercise for another
const swapped: any = {
  $id: "s4", $createdAt: "2026-10-04T10:00:00Z", userId: "a", protocol: "[]",
  attempts: JSON.stringify([{ type: "strength_conditioning", blockIndex: 0, scData: { exerciseId: "split", exerciseName: "Split Squat", round: 2, repsCompleted: "12", swappedFrom: { exerciseId: "kb", exerciseName: "KB squat" } } }]),
}
assert.deepEqual(findScSwaps([swapped, ...sessions], ["kb"], "KB squat"), [{ date: "2026-10-04T10:00:00Z", to: "Split Squat" }])
// The swapped round belongs to the picked exercise's history, not the original's
assert.equal(findScSessions([swapped], ["kb"], "KB squat").length, 0)

// ─── Coach view ──────────────────────────────────────────────────────────────
const library = [{ $id: "kb", name: "KB squat", loadMode: "weight" as const, levels: [] }]
const view = coachExerciseView([swapped, ...sessions], "KB squat", library, "kg")
assert.equal(view.rows.length, 3)
// s1: 10, 11 at 20 kg → hold; s2: 12, 12 at 20 kg → up to 21; s3 did 21 kg
assert.deepEqual(view.rows.map((r) => r.suggested), ["21 kg", "20 kg", undefined])
assert.equal(view.rows[0].did, "21 kg · 10, 9 reps · Solid")
assert.equal(view.rows[1].result, "▲ 20 → 21 kg — 12 reps on every set")
assert.equal(view.rows[2].result, "Same weight — aim for one more rep")
assert.equal(view.rows[0].focusLabel, "Hypertrophy")
assert.deepEqual(view.swaps.map((x) => x.to), ["Split Squat"])
assert.deepEqual(view.flags, {})
// Offline (no library): still matched by name
assert.equal(coachExerciseView(sessions, "KB squat", null).rows.length, 3)

// ─── Explosiveness (docs/sc-modifications-plan.md §2.4) ──────────────────────
const exp = { focus: "explosiveness" as const, reps: "3-6" }
const entry = (focus: any, date: string, summary: ScSetsSummary): FocusEntry => ({ focus, date, summary })

// Never steps up from reps — top of the range on every set holds
const expTop = planNext(exp, undefined, undefined, "kg", [at(10, 6, 6, 6)], "last time")
assert.equal(expTop.weight, 10)
assert.equal(expTop.note, "Same weight — keep every rep as fast as you can")
// …in range too
assert.equal(planNext(exp, undefined, undefined, "kg", [at(10, 4, 5)], "last time").weight, 10)
// …but missing the floor still steps down (too heavy to move fast)
assert.equal(planNext(exp, undefined, undefined, "kg", [at(10, 2)], "last time").weight, 9.5)
// …and holding the same load isn't "stuck" for explosiveness
assert.equal(planNext(exp, undefined, undefined, "kg", [at(10, 6), at(10, 6), at(10, 6)], "last time").flags.stalled, undefined)

// Starts from max force when that's newer: half the weight
const mf = entry("max_force", "2026-10-03T10:00:00Z", at(40, 5, 5))
const fromMf = planNextForFocus(exp, undefined, undefined, "kg", [mf], "last time")
assert.equal(fromMf.weight, 20)
assert.equal(fromMf.note, "For speed: 20 kg, about half your max force weight (40 kg)")
// Rounded to the exercise's weight jump (kettlebell 4 kg: 18 → 16 or 20; 22.5 → 24)
assert.equal(planNextForFocus(exp, undefined, 4, "kg", [entry("max_force", "2026-10-03", at(45, 5))], "last time").weight, 24)
assert.equal(planNextForFocus(exp, undefined, undefined, "kg", [entry("max_force", "2026-10-03", at(25, 5))], "last time").weight, 12.5)
// Older explosiveness session, newer max force → follows max force
const oldExp = entry("explosiveness", "2026-09-28T10:00:00Z", at(15, 6, 6))
assert.equal(planNextForFocus(exp, undefined, undefined, "kg", [mf, oldExp], "last time").weight, 20)
// Newer explosiveness session → its own history (holds, never steps up)
const newExp = entry("explosiveness", "2026-10-04T10:00:00Z", at(22, 6, 6))
assert.equal(planNextForFocus(exp, undefined, undefined, "kg", [newExp, mf], "last time").weight, 22)
// No max force history → own history
assert.equal(planNextForFocus(exp, undefined, undefined, "kg", [oldExp], "last time").weight, 15)
// No explosiveness or max force history → borrowed from hypertrophy (§2.4b):
// 30 × 12 → e1RM 42 → max-force-equivalent ~36.5 → half ≈ 18.3 → 18.5
const fromHyp = planNextForFocus(exp, undefined, undefined, "kg", [entry("hypertrophy", "2026-10-04", at(30, 12))], "last time")
assert.equal(fromHyp.weight, 18.5)
assert.equal(fromHyp.note, "For speed, from your hypertrophy (30 kg × 12): ~18.5 kg")

// Ladder: one level below max force's level
const pullChain = { chain: [{ exerciseId: "band", name: "Band pull-up" }, { exerciseId: "neg", name: "Negative pull-up" }, { exerciseId: "pull", name: "Pull-up" }], prescribedIdx: 2 }
const lvlMf = planNextForFocus(exp, pullChain, undefined, "kg", [entry("max_force", "2026-10-03", lvl("pull", 5))], "last time")
assert.equal(lvlMf.level?.name, "Negative pull-up")
assert.equal(lvlMf.note, "For speed: Negative pull-up, one level below your max force (Pull-up)")
// Already the easiest level → stays, with a note
const easiestMf = planNextForFocus(exp, pullChain, undefined, "kg", [entry("max_force", "2026-10-03", lvl("band", 5))], "last time")
assert.equal(easiestMf.level?.name, "Band pull-up")
assert.ok(easiestMf.note.includes("easiest level"))
// Bodyweight, no ladder → a note, no weight
assert.equal(planNextForFocus(exp, undefined, undefined, "kg", [entry("max_force", "2026-10-03", at(0, 5))], "last time").weight, undefined)

// Other focuses are unchanged: only their own focus counts
const hypFocus = { focus: "hypertrophy" as const, reps: "8-12" }
assert.equal(planNextForFocus(hypFocus, undefined, undefined, "kg", [mf, entry("hypertrophy", "2026-09-30", at(20, 12, 12))], "last time").weight, 21)

// ─── "Used for": levels that can't be done at a focus are skipped ─────────
// The real pull-up ladder; negatives and isometric holds can't be done fast.
const tagged = {
  chain: [
    { exerciseId: "band", name: "Band Assisted Pull-Ups" },
    { exerciseId: "iso", name: "chin-up isometric" },
    { exerciseId: "neg", name: "Negative pull-ups" },
    { exerciseId: "pull", name: "Pull Ups" },
  ],
  prescribedIdx: 3,
  focuses: { iso: ["max_force", "hypertrophy"], neg: ["max_force", "hypertrophy"] } as any,
}
// Explosiveness from max force on Pull Ups → skips the negative and the hold
const skip = planNextForFocus(exp, tagged, undefined, "kg", [entry("max_force", "2026-10-03", lvl("pull", 5))], "last time")
assert.equal(skip.level?.name, "Band Assisted Pull-Ups")
assert.equal(skip.note, "For speed: Band Assisted Pull-Ups, the first level below your max force (Pull Ups) that can be done fast")
// Max force (no tag issue) steps down normally onto the negative
assert.equal(planNextForFocus({ focus: "max_force", reps: "3-6" }, tagged, undefined, "kg", [entry("max_force", "2026-10-03", lvl("pull", 2))], "last time").level?.name, "Negative pull-ups")
// Nothing easier that fits → stays, says so
const noneFit = { ...tagged, focuses: { ...tagged.focuses, band: ["max_force"] } }
const stuckNote = planNextForFocus(exp, noneFit, undefined, "kg", [entry("max_force", "2026-10-03", lvl("neg", 5))], "last time")
assert.equal(stuckNote.level?.name, "Negative pull-ups")
assert.ok(stuckNote.note.includes("can be done fast"))
// An explosiveness miss steps down past untagged levels too
const expMiss = planNext(exp, { ...tagged, prescribedIdx: 3 }, undefined, "kg", [lvl("pull", 1)], "last time")
assert.equal(expMiss.level?.name, "Band Assisted Pull-Ups")

// ─── §2.4b First time at a focus: borrow from other focuses ──────────────────
const hypEx = { focus: "hypertrophy" as const, reps: "8-12" }
const mfEx = { focus: "max_force" as const, reps: "3-6" }
const fe = (focus: any, date: string, summary: ScSetsSummary, prescribed?: string): FocusEntry =>
  ({ focus, date, summary, prescribed: prescribed ?? (focus === "hypertrophy" ? "8-12" : "3-6"), unit: "reps" })

// Weight: 40 × 5 at max force → e1RM 46.7 → ~35 kg for 8–12 (r = 10)
const borrowedHyp = planNextForFocus(hypEx, undefined, undefined, "kg", [fe("max_force", "2026-10-03", at(40, 5, 4))], "last time")
assert.equal(borrowedHyp.weight, 35)
assert.equal(borrowedHyp.note, "From your max force (40 kg × 5): ~35 kg for 8–12")
// …and the other way: 30 × 10 at hypertrophy → e1RM 40 → ~35 kg for 3–6 (r = 4.5)
assert.equal(planNextForFocus(mfEx, undefined, undefined, "kg", [fe("hypertrophy", "2026-10-03", at(30, 10))], "last time").weight, 35)
// Rounded to the exercise's weight jump (kettlebell 4 kg: 35 → 36)
assert.equal(planNextForFocus(hypEx, undefined, 4, "kg", [fe("max_force", "2026-10-03", at(40, 5))], "last time").weight, 36)
// Explosiveness sessions never estimate a weight
assert.equal(planNextForFocus(hypEx, undefined, undefined, "kg", [fe("explosiveness", "2026-10-03", at(20, 6))], "last time").weight, undefined)
// Own focus history wins once it exists
assert.equal(planNextForFocus(hypEx, undefined, undefined, "kg", [fe("max_force", "2026-10-03", at(40, 5)), fe("hypertrophy", "2026-09-28", at(30, 10))], "last time").weight, 30)
// Bodyweight → nothing to estimate
assert.equal(planNextForFocus(hypEx, undefined, undefined, "kg", [fe("max_force", "2026-10-03", at(0, 5))], "last time").weight, undefined)

// Ladder: hypertrophy one level easier than max force, skipping untagged levels
const hypFromMf = planNextForFocus(hypEx, tagged, undefined, "kg", [fe("max_force", "2026-10-03", lvl("pull", 5))], "last time")
assert.equal(hypFromMf.level?.name, "Negative pull-ups")   // tagged for hypertrophy
assert.equal(hypFromMf.note, "From your max force level (Pull Ups): Negative pull-ups, one level easier")
// Max force one level harder than hypertrophy
assert.equal(planNextForFocus(mfEx, tagged, undefined, "kg", [fe("hypertrophy", "2026-10-03", lvl("neg", 10))], "last time").level?.name, "Pull Ups")
// The real rotation: 2nd exercise's first-ever day is hypertrophy, no history → coach's level
assert.deepEqual(planNextForFocus(hypEx, tagged, undefined, "kg", [], "last time"), { note: "", flags: {} })

// ─── §2.4b Safety rails across focuses ──────────────────────────────────────
// Deload across focuses: down at max force, then down at hypertrophy →
// flagged; the athlete's suggestion is the normal one
const crossDeload = planNextForFocus(hypEx, undefined, undefined, "kg",
  [fe("hypertrophy", "2026-10-03", at(30, 5)), fe("max_force", "2026-09-30", at(40, 2))], "last time")
assert.equal(crossDeload.flags.deload, true)
assert.equal(crossDeload.weight, 28.5)   // normal ▼: 5 % = 1.5
assert.ok(!crossDeload.note.includes("Deload"))
// Never mentioned to the athlete, even when the own session would hold
// (last two = explosiveness ▼ and max force ▼; the last hypertrophy held)
const holdButFlagged = planNextForFocus(hypEx, undefined, undefined, "kg",
  [fe("explosiveness", "2026-10-05", at(15, 1)), fe("max_force", "2026-10-03", at(40, 2)), fe("hypertrophy", "2026-09-30", at(30, 10))], "last time")
assert.equal(holdButFlagged.flags.deload, true)
assert.equal(holdButFlagged.weight, 30)
assert.equal(holdButFlagged.note, "Same weight — aim for one more rep")
// One down, one up → no deload
assert.equal(planNextForFocus(hypEx, undefined, undefined, "kg",
  [fe("hypertrophy", "2026-10-03", at(30, 5)), fe("max_force", "2026-09-30", at(40, 6, 6))], "last time").flags.deload, undefined)
// Deload on a ladder: flagged; the normal step (here one level down)
const lvlFlag = planNextForFocus(mfEx, tagged, undefined, "kg",
  [fe("max_force", "2026-10-03", lvl("pull", 2)), fe("hypertrophy", "2026-09-30", lvl("neg", 5))], "last time")
assert.equal(lvlFlag.flags.deload, true)
assert.equal(lvlFlag.level?.name, "Negative pull-ups")
// Stuck: no step up in the last 3 strength sessions, any mix of focuses —
// within one plan
const stuck = planNextForFocus(hypEx, undefined, undefined, "kg", [
  fe("hypertrophy", "2026-10-05", at(30, 10)),
  fe("explosiveness", "2026-10-03", at(15, 6)),   // left out of the count
  fe("max_force", "2026-10-01", at(40, 4)),
  fe("hypertrophy", "2026-09-28", at(30, 9)),
], "last time")
assert.equal(stuck.flags.stalled, true)
// A step up in there → not stuck
assert.equal(planNextForFocus(hypEx, undefined, undefined, "kg", [
  fe("hypertrophy", "2026-10-05", at(30, 10)),
  fe("max_force", "2026-10-01", at(40, 6, 6)),
  fe("hypertrophy", "2026-09-28", at(30, 9)),
], "last time").flags.stalled, undefined)
// Only 2 strength sessions → can't be stuck yet
assert.equal(planNextForFocus(hypEx, undefined, undefined, "kg", [
  fe("hypertrophy", "2026-10-05", at(30, 10)), fe("max_force", "2026-10-01", at(40, 4)),
], "last time").flags.stalled, undefined)

// ─── Settings (sc-modifications-plan §2.3) ───────────────────────────────────
const bench = { focus: "hypertrophy" as const, reps: "8-12", setting: { harder: "Lower the bench", easier: "Raise the bench" } }
const pushChain = { chain: [{ exerciseId: "elev", name: "Elevated push-ups" }, { exerciseId: "push", name: "Push-ups" }], prescribedIdx: 0 }
const onBench = (hardest: boolean, ...reps: number[]): ScSetsSummary => ({ exerciseId: "elev", sets: reps.map((amount) => ({ amount })), ...(hardest ? { atHardest: true } : {}) })

// Top of the range, not on the hardest setting → same level, make it harder
const harder = planNext(bench, pushChain, undefined, "kg", [onBench(false, 12, 12)], "last time")
assert.equal(harder.level?.name, "Elevated push-ups")
assert.equal(harder.note, "Make it harder: lower the bench — 12 reps on every set")
assert.equal(harder.atHardest, false)
// Top of the range on the hardest setting → next level, switch back off
const up = planNext(bench, pushChain, undefined, "kg", [onBench(true, 12, 12)], "last time")
assert.equal(up.level?.name, "Push-ups")
assert.equal(up.atHardest, false)
// Under the floor → same level, make it easier
const easier = planNext(bench, pushChain, undefined, "kg", [onBench(true, 5)], "last time")
assert.equal(easier.level?.name, "Elevated push-ups")
assert.equal(easier.note, "Make it easier: raise the bench — under 8 reps last time")
assert.equal(easier.atHardest, false)
// In range → hold, switch stays as it was
assert.equal(planNext(bench, pushChain, undefined, "kg", [onBench(true, 10)], "last time").atHardest, true)
assert.equal(planNext(bench, pushChain, undefined, "kg", [onBench(false, 10)], "last time").atHardest, false)
// Weight mode with a setting: same rule, weight unchanged until hardest
const benchW = (hardest: boolean, ...reps: number[]): ScSetsSummary => ({ ...at(20, ...reps), ...(hardest ? { atHardest: true } : {}) })
assert.equal(planNext(bench, undefined, undefined, "kg", [benchW(false, 12, 12)], "last time").weight, 20)
assert.equal(planNext(bench, undefined, undefined, "kg", [benchW(true, 12, 12)], "last time").weight, 21)
// A flagged deload doesn't change the setup rule: same level, "make it easier"
const benchFlag = planNextForFocus(bench, pushChain, undefined, "kg", [
  fe("hypertrophy", "2026-10-05", onBench(false, 5)), fe("max_force", "2026-10-01", { exerciseId: "push", sets: [{ amount: 1 }] }),
], "last time")
assert.equal(benchFlag.level?.name, "Elevated push-ups")
assert.ok(benchFlag.note.startsWith("Make it easier"))
// No setting → unchanged behaviour (straight to the next level)
assert.equal(planNext(hypEx, pushChain, undefined, "kg", [onBench(false, 12, 12)], "last time").level?.name, "Push-ups")
// Explosiveness at the easiest level uses the "easier" hint
const benchExp = { ...bench, focus: "explosiveness" as const, reps: "3-6" }
assert.equal(planNextForFocus(benchExp, pushChain, undefined, "kg", [fe("max_force", "2026-10-03", { exerciseId: "elev", sets: [{ amount: 5 }] })], "last time").note,
  "For speed: Elevated push-ups is the easiest level — raise the bench so you can move fast")

// ─── basisLine: what the suggestion is based on ─────────────────────────────
const lastHyp = { ...fe("hypertrophy", "2026-09-30T10:00:00Z", { ...at(20, 10, 9, 8) }), exerciseName: "KB squat" }
const sameP = planNextForFocus(hypEx, undefined, undefined, "kg", [lastHyp], "last time")
assert.equal(basisLine(sameP, "hypertrophy", "KB squat", "kg"), "Last time · Sep 30 · 20 kg · 10, 9, 8 reps")
// Borrowed from another focus, on another level: names both
const mfPush = { ...fe("max_force", "2026-09-28T10:00:00Z", lvl("pull", 5, 5, 4)), exerciseName: "Pull Ups" }
const borrowedP = planNextForFocus(hypEx, tagged, undefined, "kg", [mfPush], "last time")
assert.equal(basisLine(borrowedP, "hypertrophy", borrowedP.level!.name, "kg"), "Based on · Sep 28 · Max force · Pull Ups · 5, 5, 4 reps")
// Hardest setup is mentioned
const benchLast = { ...fe("hypertrophy", "2026-09-30T10:00:00Z", onBench(true, 10, 9)), exerciseName: "Elevated push-ups" }
assert.equal(basisLine(planNextForFocus(bench, pushChain, undefined, "kg", [benchLast], "last time"), "hypertrophy", "Elevated push-ups", "kg"),
  "Last time · Sep 30 · hardest setup · 10, 9 reps")
// No note → no line
assert.equal(basisLine({ note: "", flags: {} }, "hypertrophy", "x", "kg"), undefined)

console.log("all scNext tests passed")
