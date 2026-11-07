// Tests for band-assisted ladders, the guided test and progression (utils/bands.ts). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/bands.test.ts

import assert from "node:assert/strict"
import {
  BAND_LADDER, DEFAULT_START_INDEX, comboId, comboLabel, isBandAssisted, ladderIndexOf,
  nextTestStep, parseSavedBands, planBandNext, stepBands, withSavedBand,
} from "@/utils/bands"

const idx = (id: string) => ladderIndexOf(id)

// ── ladder ──
assert.equal(BAND_LADDER.length, 10)
assert.equal(comboId(BAND_LADDER[DEFAULT_START_INDEX]), "green")
assert.equal(comboId(BAND_LADDER[BAND_LADDER.length - 1]), "")
assert.equal(comboId(["red", "green"]), "green+red")          // stable order
assert.equal(comboLabel(["green", "red"]), "Green + Red")
assert.equal(comboLabel([]), "No band")
assert.equal(ladderIndexOf("black+red"), -1)                  // not a step
assert.equal(new Set(BAND_LADDER.map(comboId)).size, BAND_LADDER.length)
assert.ok(BAND_LADDER.every((c) => c.length <= 2))

// ── recognising the exercise ──
assert.ok(isBandAssisted("Band Assisted Pull-Ups"))
assert.ok(isBandAssisted("Banded pull-ups"))
assert.ok(!isBandAssisted("Pull Ups"))
assert.ok(!isBandAssisted(undefined))

// ── guided test ──
// Nothing tried yet → green
assert.deepEqual(nextTestStep("hypertrophy", []), { done: false, next: idx("green") })
// In range on the first try → saved
assert.deepEqual(nextTestStep("hypertrophy", [{ index: idx("green"), reps: 10 }]), { done: true, index: idx("green"), reason: "in_range" })
// A bit over (13 vs 8–12) → one step less help
assert.deepEqual(nextTestStep("hypertrophy", [{ index: idx("green"), reps: 13 }]), { done: false, next: idx("purple+yellow") })
// Way over (16) → two steps
assert.deepEqual(nextTestStep("hypertrophy", [{ index: idx("green"), reps: 16 }]), { done: false, next: idx("purple") })
// Under → more help
assert.deepEqual(nextTestStep("max_force", [{ index: idx("green"), reps: 1 }]), { done: false, next: idx("green+red") })
// Too easy then too hard on neighbours → keep the easier (more help)
assert.deepEqual(
  nextTestStep("hypertrophy", [{ index: idx("green"), reps: 14 }, { index: idx("purple+yellow"), reps: 6 }]),
  { done: true, index: idx("green"), reason: "bracketed" },
)
// Skipped two, too hard → back one, between the two known edges
assert.deepEqual(
  nextTestStep("hypertrophy", [{ index: idx("green"), reps: 18 }, { index: idx("purple"), reps: 5 }]),
  { done: false, next: idx("purple+yellow") },
)
// …and that one too hard as well → bracketed on green
assert.deepEqual(
  nextTestStep("hypertrophy", [{ index: idx("green"), reps: 18 }, { index: idx("purple"), reps: 5 }, { index: idx("purple+yellow"), reps: 7 }]),
  { done: true, index: idx("green"), reason: "bracketed" },
)
// A big overshoot never jumps past a step known to be too hard
assert.deepEqual(
  nextTestStep("max_force", [{ index: idx("black"), reps: 1 }, { index: idx("purple"), reps: 1 }, { index: idx("purple+yellow"), reps: 12 }]),
  { done: true, index: idx("purple+yellow"), reason: "bracketed" },
)
// Over the range with no band → done
assert.deepEqual(nextTestStep("max_force", [{ index: idx(""), reps: 9 }]), { done: true, index: idx(""), reason: "no_band" })
// Under the range with the most help there is → done
assert.deepEqual(nextTestStep("max_force", [{ index: 0, reps: 1 }]), { done: true, index: 0, reason: "max_help" })
// Explosiveness uses its 3–6 range
assert.deepEqual(nextTestStep("explosiveness", [{ index: idx("red"), reps: 5 }]), { done: true, index: idx("red"), reason: "in_range" })

// ── saved combos ──
assert.deepEqual(parseSavedBands(null), {})
assert.deepEqual(parseSavedBands("nope"), {})
assert.deepEqual(parseSavedBands("[]"), {})
assert.deepEqual(parseSavedBands('{"hypertrophy":"green+red","max_force":"black+red","bogus":"green"}'), { hypertrophy: "green+red" })
assert.deepEqual(parseSavedBands('{"explosiveness":""}'), { explosiveness: "" })   // no band is a valid result
assert.deepEqual(withSavedBand({ hypertrophy: "green" }, "max_force", idx("purple")), { hypertrophy: "green", max_force: "purple" })

// ── progression ──
assert.deepEqual(stepBands(idx("green"), "increase"), { index: idx("purple+yellow"), changed: true, atNoBand: false })
assert.deepEqual(stepBands(idx("green"), "decrease"), { index: idx("green+red"), changed: true, atNoBand: false })
assert.deepEqual(stepBands(idx("green"), "hold"), { index: idx("green"), changed: false, atNoBand: false })
assert.deepEqual(stepBands(0, "decrease"), { index: 0, changed: false, atNoBand: false })
assert.deepEqual(stepBands(idx(""), "increase"), { index: idx(""), changed: false, atNoBand: true })

console.log("bands tests passed")

// ── next session ──
assert.deepEqual(planBandNext(-1, "increase", true), { bandIdx: -1, keepLevel: true })
assert.deepEqual(planBandNext(idx("green"), "hold", true), { bandIdx: idx("green"), keepLevel: true })
assert.deepEqual(planBandNext(idx("green"), "increase", true), { bandIdx: idx("purple+yellow"), keepLevel: true, note: "▲ Top of the range last time. Next band: Purple + Yellow" })
assert.deepEqual(planBandNext(idx("green"), "decrease", true), { bandIdx: idx("green+red"), keepLevel: true, note: "▼ Under the range last time. More help: Green + Red" })
// No band and still topping out → the next level of the ladder takes over
assert.deepEqual(planBandNext(idx(""), "increase", true), { bandIdx: idx(""), keepLevel: false })
// Most help and still under → the easier level takes over
assert.deepEqual(planBandNext(0, "decrease", true), { bandIdx: 0, keepLevel: false })
// Coming from another level: the saved band, unchanged
assert.deepEqual(planBandNext(idx("red"), "decrease", false), { bandIdx: idx("red"), keepLevel: false })
console.log("band plan tests passed")
