// Tests for the S&C end-of-block review slides (utils/scReview.ts). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/scReview.test.ts

import assert from "node:assert/strict"
import { asksQuestions, overviewLine, reviewExercise, reviewLog, reviewLogLine, tally, type ReviewInput } from "@/utils/scReview"

const sets = (...amounts: (number | [number, number])[]) =>
  amounts.map((a) => (Array.isArray(a) ? { amount: a[0], rpe: a[1] } : { amount: a }))
const entry = (focus: any, summary: any, date = "2026-11-01T10:00:00Z") => ({ focus, date, summary })
const base = (today: any, past: any[] = [], extra: Partial<ReviewInput> = {}): ReviewInput =>
  ({ key: "0", name: "KB squat", focus: "hypertrophy", today, past, weightUnit: "kg", ...extra })

// First time at this focus (another focus's session doesn't count) → baseline
{
  const r = reviewExercise(base({ weight: 20, sets: sets([10, 7], [10, 8]) }, [entry("max_force", { weight: 40, sets: sets(4) })]))!
  assert.equal(r.verdict, "first")
  assert.deepEqual(r.metrics.map((m) => m.label), ["Weight", "Reps per set", "Effort"])
  assert.equal(r.metrics[0].before, undefined)
  assert.equal(r.metrics[2].after, "RPE 7.5")
  assert.equal(asksQuestions(r), false)
}

// More weight, fewer reps → improved (load decides first)
{
  const r = reviewExercise(base({ weight: 22.5, sets: sets(8, 8) }, [entry("hypertrophy", { weight: 20, sets: sets(10, 10) })]))!
  assert.equal(r.verdict, "improved")
  assert.equal(r.headline, "You moved up the load")
  const w = r.metrics.find((m) => m.label === "Weight")!
  assert.deepEqual([w.before, w.after, w.trend], ["20 kg", "22.5 kg", "up"])
  assert.equal(r.metrics.find((m) => m.label === "Reps per set")!.trend, "down")
}

// Same weight, more reps → improved
{
  const r = reviewExercise(base({ weight: 20, sets: sets(11, 10) }, [entry("hypertrophy", { weight: 20, sets: sets(10, 10) })]))!
  assert.equal(r.verdict, "improved")
  assert.equal(r.headline, "More reps at the same load")
  assert.equal(r.metrics.find((m) => m.label === "Reps per set")!.before, "10 · 10")
}

// Same load and reps, RPE down by a full point → improved; by 0.5 or less → same
{
  const prev = entry("hypertrophy", { weight: 20, sets: sets([10, 8], [10, 8]) })
  assert.equal(reviewExercise(base({ weight: 20, sets: sets([10, 7], [10, 7]) }, [prev]))!.headline, "Same work, felt easier")
  const same = reviewExercise(base({ weight: 20, sets: sets([10, 8], [10, 7.5]) }, [prev]))!
  assert.equal(same.verdict, "same")
  assert.equal(same.headline, "Same as last time")
  assert.equal(asksQuestions(same), true)
  const harder = reviewExercise(base({ weight: 20, sets: sets([10, 9], [10, 9]) }, [prev]))!
  assert.equal(harder.verdict, "declined")
}

// Lighter weight → declined
assert.equal(reviewExercise(base({ weight: 17.5, sets: sets(12, 12) }, [entry("hypertrophy", { weight: 20, sets: sets(10) })]))!.verdict, "declined")

// Levels: a harder step on the ladder → improved, named from the ladder
{
  const ladder = [{ exerciseId: "a", name: "Knee push-up" }, { exerciseId: "b", name: "Push-up" }, { exerciseId: "c", name: "Archer push-up" }]
  const r = reviewExercise(base({ exerciseId: "c", sets: sets(5, 5) }, [entry("hypertrophy", { exerciseId: "b", sets: sets(10, 10) })], { ladder, name: "Archer push-up" }))!
  assert.equal(r.verdict, "improved")
  const lvl = r.metrics.find((m) => m.label === "Level")!
  assert.deepEqual([lvl.before, lvl.after], ["Push-up", "Archer push-up"])
  // same level, fewer reps → declined
  assert.equal(reviewExercise(base({ exerciseId: "b", sets: sets(8, 8) }, [entry("hypertrophy", { exerciseId: "b", sets: sets(10, 10) })], { ladder }))!.verdict, "declined")
}

// Reaching the hardest setting is a step up
assert.equal(reviewExercise(base({ sets: sets(10), atHardest: true }, [entry("hypertrophy", { sets: sets(10) })]))!.verdict, "improved")

// Seconds
assert.equal(reviewExercise(base({ sets: sets(30, 30) }, [entry("hypertrophy", { sets: sets(30, 30) })], { amountUnit: "seconds" }))!.metrics[0].label, "Seconds per set")

// No sets → nothing to review
assert.equal(reviewExercise(base({ sets: [] })), null)

// Overview line
assert.equal(overviewLine({ improved: 2, same: 1, declined: 0, first: 1 }), "You improved on 2 of 3 exercises")
assert.equal(overviewLine({ improved: 2, same: 0, declined: 0, first: 0 }), "You improved on all 2 exercises")
assert.equal(overviewLine({ improved: 0, same: 1, declined: 1, first: 0 }), "No progress this time — let's see why")
assert.equal(overviewLine({ improved: 0, same: 0, declined: 0, first: 2 }), "Baseline set — next time you'll see how you progress")
assert.deepEqual(tally([{ verdict: "same" }, { verdict: "same" }, { verdict: "first" }] as any), { improved: 0, same: 2, declined: 0, first: 1 })

// The log: answers only on exercises that were asked, blank notes dropped
{
  const same = reviewExercise(base({ exerciseId: "kb", weight: 20, sets: sets(10) }, [entry("hypertrophy", { exerciseId: "kb", weight: 20, sets: sets(10) })]))!
  assert.deepEqual(reviewLog(same, { form: "good", tired: true, improve: "  slower down  " }),
    { exerciseId: "kb", exerciseName: "KB squat", focus: "hypertrophy", verdict: "same", form: "good", tired: true, improve: "slower down" })
  assert.deepEqual(reviewLog(same, { improve: "   " }), { exerciseId: "kb", exerciseName: "KB squat", focus: "hypertrophy", verdict: "same" })
  const up = reviewExercise(base({ weight: 25, sets: sets(10) }, [entry("hypertrophy", { weight: 20, sets: sets(10) })]))!
  assert.equal(reviewLog(up, { form: "off" }).form, undefined)
  assert.equal(reviewLogLine({ exerciseName: "x", verdict: "same", form: "good", tired: false, improve: "Tempo" }), "Same as last time · Good form · Not tired · “Tempo”")
}

console.log("scReview: all tests passed")
