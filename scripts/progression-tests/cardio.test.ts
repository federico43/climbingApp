// Tests for the jump rope cardio plan (utils/cardio.ts, docs/cardio-rope.md). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/cardio.test.ts

import assert from "node:assert/strict"
import {
  afterDeload, afterLongBreak, canTrainToday, coordinationPassed, deloadDueBeforePromotion, deloadSeries,
  gradeSession, initialState, isDeloadWeek, protocolFor, protocolLabel, protocolMinutes, sessionProtocol,
  startStepFromCapacity, validDays, weekStart, weekStatus, type CardioAnswers, type CardioState,
} from "@/utils/cardio"

const GREEN: CardioAnswers = { rest: "enough", pain: "none", pace: "all", effort: "steady" }
const EASY: CardioAnswers = { rest: "plenty", pain: "none", pace: "all", effort: "easy" }
const counts = { counts: true, deloadDueSoon: false }

// ── protocol ──
assert.deepEqual([protocolFor(1, 1).series, protocolFor(2, 1).series, protocolFor(3, 1).series], [6, 8, 10])
assert.equal(protocolFor(0, 1).dryJumps, true)
assert.equal(protocolFor(4, 1).restSec, 20)
assert.equal(protocolFor(5, 1).doublesEverySec, 10)
assert.equal(protocolFor(6, 1).workSec, 40)
assert.equal(protocolFor(3, 2).series, 12)
assert.equal(protocolFor(4, 3).restSec, 15)
assert.equal(protocolFor(6, 4).triplesOrHeavy, true)
assert.equal(protocolFor(3, 6).series, 14)
assert.equal(protocolFor(3, 40).series, 15)                   // capped
assert.equal(protocolFor(1, 3).series, 6)                     // steps 0–2 never change
assert.equal(protocolLabel(protocolFor(5, 1)), "10 × 30s on / 30s off · doubles every 10s")
assert.equal(protocolMinutes(protocolFor(3, 1)), 10)          // 300 + 270 s
assert.deepEqual([deloadSeries(10), deloadSeries(12), deloadSeries(6)], [6, 7, 4])
assert.equal(sessionProtocol(3, 1, { deload: true }).series, 6)
assert.equal(sessionProtocol(4, 1, { climbedHard: true }).restSec, 30) // step 3's protocol
assert.equal(sessionProtocol(0, 1, { climbedHard: true }).dryJumps, true)

// ── rules ──
const s3 = initialState(3)
// 6: one green repeats, two greens go up.
let r = gradeSession(s3, GREEN, counts)
assert.equal(r.outcome, "repeat"); assert.equal(r.next.greenStreak, 1)
r = gradeSession(r.next, GREEN, counts)
assert.equal(r.outcome, "up"); assert.equal(r.next.step, 4); assert.equal(r.next.greenStreak, 0)
// A yellow in between resets the streak (rule 5).
r = gradeSession(gradeSession(s3, GREEN, counts).next, { ...GREEN, effort: "mixed" }, counts)
assert.equal(r.rule, 5); assert.equal(r.next.greenStreak, 0)
// 1: pain → one step down, pain cap; two painless sessions lift it.
r = gradeSession(s3, { ...GREEN, pain: "pain", painZone: "shin" }, counts)
assert.equal(r.rule, 1); assert.equal(r.next.step, 2); assert.equal(r.next.painCap, true); assert.equal(r.alertCoach, false)
const again = gradeSession(r.next, { ...GREEN, pain: "pain", painZone: "shin" }, counts)
assert.equal(again.alertCoach, true); assert.equal(again.next.step, 1)
let capped = gradeSession(r.next, GREEN, counts).next
assert.equal(capped.painCap, true)
capped = gradeSession(capped, GREEN, counts).next
assert.equal(capped.painCap, false)
// 2: mild discomfort repeats even if all else is green.
assert.equal(gradeSession(s3, { ...GREEN, pain: "mild" }, counts).rule, 2)
// 3: many coordination stops.
const many: CardioAnswers = { ...GREEN, pace: "stoppedMany", stopReason: "coordination" }
assert.equal(gradeSession(initialState(1), many, counts).next.step, 0)
assert.equal(gradeSession(initialState(5), many, counts).next.step, 4)
assert.equal(gradeSession(initialState(4), many, counts).next.step, 1)
assert.equal(gradeSession(initialState(0), many, counts).outcome, "repeat")
// 4: tired → repeat slower.
r = gradeSession(s3, { ...GREEN, pace: "stoppedMany", stopReason: "tired" }, counts)
assert.equal(r.rule, 4); assert.equal(r.next.slowDown, true)
assert.equal(gradeSession(r.next, GREEN, counts).next.slowDown, false)
assert.equal(gradeSession(s3, { ...GREEN, effort: "allOut" }, counts).rule, 4)
// 7: two easy sessions skip a step, but never past step 3.
r = gradeSession(gradeSession(initialState(1), EASY, counts).next, EASY, counts)
assert.equal(r.outcome, "skip"); assert.equal(r.next.step, 3)
r = gradeSession(gradeSession(initialState(2), EASY, counts).next, EASY, counts)
assert.equal(r.outcome, "up"); assert.equal(r.next.step, 3)
// Sessions that don't count (deload / climbed hard) never build a streak.
r = gradeSession(gradeSession(s3, GREEN, { counts: false, deloadDueSoon: false }).next, GREEN, counts)
assert.equal(r.outcome, "repeat")
// Step 6 waits for a deload; 8: cycle up from step 6.
const s5: CardioState = { ...initialState(5), greenStreak: 1 }
r = gradeSession(s5, GREEN, { counts: true, deloadDueSoon: true })
assert.equal(r.outcome, "deloadHold"); assert.equal(r.needsDeload, true); assert.equal(r.next.step, 5)
assert.deepEqual(afterDeload(r.next).step, 6)
r = gradeSession({ ...initialState(6), greenStreak: 1 }, GREEN, counts)
assert.equal(r.outcome, "cycleUp"); assert.equal(r.next.step, 3); assert.equal(r.next.cycle, 2)
r = gradeSession({ ...initialState(6), greenStreak: 1 }, GREEN, { counts: true, deloadDueSoon: true })
assert.equal(r.outcome, "deloadHold")
const after = afterDeload(r.next)
assert.equal(after.step, 3); assert.equal(after.cycle, 2); assert.equal(after.pendingUp, null)
// Pain drops a held promotion.
assert.equal(gradeSession(r.next, { ...GREEN, pain: "pain" }, counts).next.pendingUp, null)
// Long break.
assert.equal(afterLongBreak(initialState(4), 13).step, 4)
assert.equal(afterLongBreak(initialState(4), 14).step, 3)

// ── starting test ──
assert.equal(coordinationPassed(["0", "1-3", "6+"]), true)
assert.equal(coordinationPassed(["4-5", "1-3", "6+"]), false)
assert.equal(startStepFromCapacity(GREEN), 3)
assert.equal(startStepFromCapacity({ ...GREEN, rest: "short" }), 2)
assert.equal(startStepFromCapacity({ ...GREEN, pace: "stoppedMany" }), 1)
assert.equal(startStepFromCapacity({ ...GREEN, pain: "mild" }), 1)

// ── deload calendar ──
assert.equal(weekStart("2026-11-08"), "2026-11-02")           // Sunday → its Monday
assert.equal(weekStart("2026-11-09"), "2026-11-09")
assert.equal(isDeloadWeek("2026-12-06", "2026-11-02", null, null), false) // week 5
assert.equal(isDeloadWeek("2026-12-07", "2026-11-02", null, null), true)  // week 6 = 5 weeks later
assert.equal(isDeloadWeek("2026-12-14", "2026-11-02", "2026-12-07", null), false)
assert.equal(isDeloadWeek("2026-11-18", "2026-11-02", null, "2026-11-16"), true)
assert.equal(deloadDueBeforePromotion("2026-11-20", null), true)
assert.equal(deloadDueBeforePromotion("2026-11-20", "2026-11-09"), false)
assert.equal(deloadDueBeforePromotion("2026-11-30", "2026-11-09"), true)

// ── days ──
assert.equal(validDays([0, 2, 4]), true)
assert.equal(validDays([0, 1]), false)
assert.equal(validDays([0, 6]), false)                        // Sun → Mon
assert.equal(validDays([1, 3, 5]), true)
assert.equal(validDays([0]), false)
assert.equal(validDays([0, 2, 4, 6]), false)
assert.deepEqual(canTrainToday("2026-11-11", ["2026-11-10"], false), { ok: false, reason: "yesterday" })
assert.deepEqual(canTrainToday("2026-11-13", ["2026-11-09", "2026-11-11"], false), { ok: true })
assert.deepEqual(canTrainToday("2026-11-13", ["2026-11-09", "2026-11-11"], true), { ok: false, reason: "weekFull" })
assert.deepEqual(canTrainToday("2026-11-15", ["2026-11-09", "2026-11-11", "2026-11-13"], false), { ok: false, reason: "weekFull" })
assert.deepEqual(
  weekStatus("2026-11-11", [0, 2, 4], ["2026-11-09"]),
  ["done", "rest", "today", "rest", "planned", "rest", "rest"],
)
assert.deepEqual(weekStatus("2026-11-12", [0, 2, 4], []).slice(0, 3), ["missed", "rest", "missed"])

console.log("cardio tests passed")
