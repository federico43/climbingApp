// Tests for the extra solo session (utils/extraSession.ts). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/extraSession.test.ts

import assert from "node:assert/strict"
import {
  extraSessionBlocks, extraSessionDays, extraSessionOf, extraSessionSpec, gymDaysLabel, nextExtraWindow,
  pendingExtraSession, preferredDay, trainingDays, weekdaysLabel, type ExtraSessionNote,
} from "@/utils/extraSession"
import type { PlanShape } from "@/utils/planRotation"

const MON = 0, TUE = 1, WED = 2, THU = 3, FRI = 4, SAT = 5, SUN = 6

// ── Which days ──────────────────────────────────────────────────────────────
// Federico's example: Tue + Thu at the gym → Sat or Sun on their own.
assert.deepEqual(extraSessionDays([TUE, THU]), [SAT, SUN])
assert.equal(weekdaysLabel(extraSessionDays([TUE, THU])), "Sat or Sun")
assert.equal(gymDaysLabel([TUE, THU]), "Tue & Thu")
// Mon + Thu → only Sat keeps a rest day either side.
assert.deepEqual(extraSessionDays([MON, THU]), [SAT])
// Mon + Wed → the long gap Thu–Sun, minus the days next to the gym ones.
assert.deepEqual(extraSessionDays([MON, WED]), [FRI, SAT])
// Order and repeats don't matter.
assert.deepEqual(extraSessionDays([THU, TUE, TUE]), [SAT, SUN])
// One gym day: the middle of the week that's left.
assert.deepEqual(extraSessionDays([TUE]), [FRI, SAT])
// Sat + Sun at the gym → mid-week.
assert.deepEqual(extraSessionDays([SAT, SUN]), [TUE, WED])
// Nothing to go on, or the week is already spread.
assert.deepEqual(extraSessionDays([]), [])
assert.deepEqual(extraSessionDays([MON, WED, FRI]), [])
// Back to back: still finds the gap.
assert.deepEqual(extraSessionDays([MON, TUE]), [THU, FRI])
// Wed + Thu: gap Fri–Tue, rest-day-safe Sat, Sun, Mon → middle two.
assert.deepEqual(extraSessionDays([WED, THU]), [SAT, SUN])

// ── Gym days from classes, else from sessions ───────────────────────────────
assert.deepEqual(trainingDays(["3@9.5", "1@15", "1@17"], [], "2026-11-11"), [TUE, THU])
assert.deepEqual(trainingDays(["junk"], [], "2026-11-11"), [])
const at = (date: string) => ({ $createdAt: `${date}T12:00:00.000Z`, attempts: "[]", protocol: "[]" })
// 2026-11-03 and -10 are Tuesdays, -05 a Thursday (once only), -06 Friday twice.
const sessions = [at("2026-11-03"), at("2026-11-10"), at("2026-11-05"), at("2026-10-30"), at("2026-11-06"), at("2026-09-01")]
assert.deepEqual(trainingDays(null, sessions, "2026-11-11"), [TUE, FRI])

// ── The next window ─────────────────────────────────────────────────────────
// Wed 11 Nov 2026 → Sat 14 – Sun 15.
assert.deepEqual(nextExtraWindow("2026-11-11", [SAT, SUN]), { from: "2026-11-14", to: "2026-11-15" })
// On the Saturday itself: today counts.
assert.deepEqual(nextExtraWindow("2026-11-14", [SAT, SUN]), { from: "2026-11-14", to: "2026-11-15" })
// On the Sunday: just today.
assert.deepEqual(nextExtraWindow("2026-11-15", [SAT, SUN]), { from: "2026-11-15", to: "2026-11-15" })
// Wrapping the week: Sun + Mon from a Sunday.
assert.deepEqual(nextExtraWindow("2026-11-15", [SUN, MON]), { from: "2026-11-15", to: "2026-11-16" })
assert.equal(nextExtraWindow("2026-11-11", []), null)

// ── The homework row ────────────────────────────────────────────────────────
const note: ExtraSessionNote = { from: "2026-11-14", to: "2026-11-15", days: [SAT, SUN], gymDays: [TUE, THU] }
const tagged = extraSessionBlocks([{ type: "strength_conditioning", coached: true }], note)
assert.equal((tagged[0] as any).coached, undefined)
assert.deepEqual((tagged[0] as any).extraSession, note)
const row = (id: string, extra: object = {}) => ({
  $id: id, $createdAt: "2026-11-11T12:00:00.000Z", name: "Extra session", dueBy: "2026-11-15",
  blocks: JSON.stringify(tagged), ...extra,
})
assert.deepEqual(extraSessionOf(row("x")), note)
assert.equal(extraSessionOf({ blocks: "[]" }), null)
assert.equal(extraSessionOf({ blocks: "nope" }), null)

// Open → shown; done or overdue → the coach can send the next one.
const plain = { $id: "p", $createdAt: "2026-11-11T12:00:00.000Z", name: "Density test", dueBy: "2026-11-15", blocks: "[]" }
assert.equal(pendingExtraSession([plain, row("x")], [], "2026-11-12")?.$id, "x")
assert.equal(pendingExtraSession([row("x")], [], "2026-11-16"), null)
const doneSession = { ...at("2026-11-14"), attempts: JSON.stringify([{ timestamp: Date.parse("2026-11-14T12:00:00Z") }]), protocolId: "x" }
assert.equal(pendingExtraSession([row("x")], [doneSession], "2026-11-14"), null)
assert.equal(pendingExtraSession([plain], [], "2026-11-12"), null)

// The day picker starts on the first suggested day still open.
assert.equal(preferredDay(note, ["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]), "2026-11-14")
assert.equal(preferredDay(note, ["2026-11-12"]), undefined)
assert.equal(preferredDay(null, ["2026-11-12"]), undefined)

// ── What it trains ──────────────────────────────────────────────────────────
const plan: PlanShape = {
  windowStart: "2026-11-02", windowEnd: "2026-12-13", kind: null, focus: "strength",
  hasSc: true, hasMobility: false, scPatterns: [{ movementType: "pull" as any, exerciseIds: ["a", "b"] }],
}
// Latest built: workout 3 (power → explosiveness), slot 0 → the extra uses slot 1.
const built = [1, 2, 3].map((n) => ({ planIndex: n, createdAt: `2026-11-0${n + 2}T12:00:00.000Z` }))
const spec = extraSessionSpec(plan, built, "2026-11-11")!
assert.equal(spec.index, 3)
assert.equal(spec.scFocus, "explosiveness")
assert.equal(spec.exerciseSlot, 1)
// Never climbing: no main block, warm-up or test, even on a climbing plan.
assert.equal(spec.mainBlock, null)
assert.equal(spec.warmup, "none")
assert.equal(spec.withTest, false)
// Nothing built yet → workout 1's S&C (max force), other slot.
const first = extraSessionSpec(plan, [], "2026-11-01")!
assert.equal(first.scFocus, "max_force")
assert.equal(first.exerciseSlot, 1)
// No S&C in the plan → nothing to send.
assert.equal(extraSessionSpec({ ...plan, hasSc: false }, built, "2026-11-11"), null)

console.log("extraSession: all tests passed")
