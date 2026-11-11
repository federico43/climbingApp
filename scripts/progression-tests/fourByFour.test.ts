// Tests for the pure 4×4 rules (utils/progression/fourByFour.ts). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/fourByFour.test.ts

import assert from "node:assert/strict"
import {
  authoredGrades, fitGrades, liveStepDown, nextSlotToRaise, pendingStepDowns, runGrades,
  suggestNextFourByFour, summarizeFourByFourRun,
} from "@/utils/progression/fourByFour"

// One run: `tops` per set, climbed on `grades` (logged per set, as the runtime does).
const run = (grades: string[], tops: number[], n = 4) => ({
  sessionId: "s", createdAt: "", block: { type: "four_by_four", bouldersPerSet: n },
  attempts: tops.map((t, i) => ({ success: true, level: grades[grades.length - 1], scData: { tops: t, set: i + 1, grades }, blockIndex: 0, type: "four_by_four", timestamp: 0 })),
})
// One run whose colours changed between sets (live step-downs): `perSet[i]` = set i's colours.
const liveRun = (perSet: string[][], tops: number[]) => ({
  sessionId: "s", createdAt: "", block: { type: "four_by_four", bouldersPerSet: 4 },
  attempts: tops.map((t, i) => ({ success: true, level: "x", scData: { tops: t, set: i + 1, grades: perSet[i] }, blockIndex: 0, type: "four_by_four", timestamp: 0 })),
})
// A session logged before per-slot colours: one colour, no scData.grades.
const legacyRun = (level: string, tops: number[]) => ({
  sessionId: "s", createdAt: "", block: { type: "four_by_four", bouldersPerSet: 4 },
  attempts: tops.map((t, i) => ({ success: true, level, scData: { tops: t, set: i + 1 }, blockIndex: 0, type: "four_by_four", timestamp: 0 })),
})
const G = (s: string) => s.split(" ")
const opts = { bouldersPerSet: 4 }

// ── helpers ──
assert.deepEqual(fitGrades(["green"], 4), G("green green green green"))
assert.deepEqual(fitGrades(G("yellow green"), 3), G("yellow green green"))
assert.deepEqual(fitGrades(G("red red red red red"), 4), G("red red red red"))
assert.equal(fitGrades(["purple"], 4), null)
assert.equal(authoredGrades({ bouldersPerSet: 4 }), null)
assert.deepEqual(runGrades(legacyRun("blue", [4, 4, 4, 4])), G("blue blue blue blue"))
assert.equal(nextSlotToRaise(G("green green green green")), 0)
assert.equal(nextSlotToRaise(G("yellow green green green")), 1)
assert.equal(nextSlotToRaise(G("yellow yellow yellow green")), 3)

// ── in session: fall in set 1/2 lowers the last boulder holding the highest colour ──
let step = liveStepDown(G("yellow yellow yellow yellow"))!
assert.equal(step.slot, 3); assert.deepEqual(step.grades, G("yellow yellow yellow green"))
step = liveStepDown(step.grades)!
assert.equal(step.slot, 2); assert.deepEqual(step.grades, G("yellow yellow green green"))
// coach's example: yellow yellow yellow green → yellow yellow green green
assert.deepEqual(liveStepDown(G("yellow yellow yellow green"))!.grades, G("yellow yellow green green"))
// all equal at the next colour down → wraps to the last slot again
assert.deepEqual(liveStepDown(G("green green green green"))!.grades, G("green green green blue"))
assert.deepEqual(liveStepDown(G("blue blue orange orange"))!.grades, G("blue orange orange orange"))
assert.equal(liveStepDown(G("orange orange orange orange")), null)
const start = G("yellow yellow green green")
// pending drops = early falls the log doesn't show as applied
assert.equal(pendingStepDowns(liveRun([start, G("yellow green green green"), G("yellow green green green"), G("yellow green green green")], [3, 4, 4, 4]).attempts as any, 4), 0)
assert.equal(pendingStepDowns(legacyRun("green", [3, 3, 4, 4]).attempts as any, 4), 2)
assert.deepEqual(summarizeFourByFourRun(run(G("g g g g"), [4, 3, 4, 2])).fellInSets, [2, 4])

// ── first session ──
// no history, no coach colours → every slot flash − 1
let s = suggestNextFourByFour([], { ...opts, flashLevel: "yellow" })!
assert.deepEqual(s.grades, G("green green green green"))
// flash orange → floor orange
assert.deepEqual(suggestNextFourByFour([], { ...opts, flashLevel: "orange" })!.grades, G("orange orange orange orange"))
// coach set colours → no suggestion, runs as authored
assert.equal(suggestNextFourByFour([], { ...opts, flashLevel: "yellow", authored: G("blue blue blue blue") }), null)
// no flash level either → no suggestion (athlete picks)
assert.equal(suggestNextFourByFour([], opts), null)

// ── no falls → first slot with the lowest colour goes up ──
s = suggestNextFourByFour([run(G("green green green green"), [4, 4, 4, 4])], opts)!
assert.equal(s.direction, "increase"); assert.deepEqual(s.grades, G("yellow green green green"))
s = suggestNextFourByFour([run(G("yellow yellow green green"), [4, 4, 4, 4])], opts)!
assert.deepEqual(s.grades, G("yellow yellow yellow green"))
// all equal again → start from slot 1
s = suggestNextFourByFour([run(G("yellow yellow yellow yellow"), [4, 4, 4, 4])], opts)!
assert.deepEqual(s.grades, G("red yellow yellow yellow"))
// after a last-slot drop, refill it first
s = suggestNextFourByFour([run(G("yellow yellow yellow green"), [4, 4, 4, 4])], opts)!
assert.deepEqual(s.grades, G("yellow yellow yellow yellow"))
// cap black
s = suggestNextFourByFour([run(G("black black black black"), [4, 4, 4, 4])], opts)!
assert.equal(s.direction, "hold"); assert.deepEqual(s.grades, G("black black black black"))
// legacy single-colour run counts the same
s = suggestNextFourByFour([legacyRun("blue", [4, 4, 4, 4])], opts)!
assert.deepEqual(s.grades, G("green blue blue blue"))

// ── fall in set 1 or 2 → next session starts on the colours they finished on ──
s = suggestNextFourByFour([liveRun([start, G("yellow green green green"), G("yellow green green green"), G("yellow green green green")], [3, 4, 4, 4])], opts)!
assert.equal(s.direction, "hold"); assert.deepEqual(s.grades, G("yellow green green green"))
// two live drops (sets 1 and 2) carry over
s = suggestNextFourByFour([liveRun([start, G("yellow green green green"), G("green green green green"), G("green green green green")], [2, 3, 4, 4])], opts)!
assert.deepEqual(s.grades, G("green green green green"))
// next clean session refills the lowest first
s = suggestNextFourByFour([run(G("yellow yellow green blue"), [4, 4, 4, 4])], opts)!
assert.deepEqual(s.grades, G("yellow yellow green green"))
// drop that couldn't happen live (fall in the last set of a 2-set block) → applied now
s = suggestNextFourByFour([liveRun([G("green green green green"), G("green green green green")], [4, 3])], opts)!
assert.equal(s.direction, "decrease"); assert.deepEqual(s.grades, G("green green green blue"))
// legacy single-colour log with falls in sets 1 and 2 → both drops applied
s = suggestNextFourByFour([legacyRun("green", [3, 3, 4, 4])], opts)!
assert.deepEqual(s.grades, G("green green blue blue"))
// floor orange
s = suggestNextFourByFour([run(G("orange orange orange orange"), [1, 4, 4, 4])], opts)!
assert.equal(s.direction, "hold"); assert.deepEqual(s.grades, G("orange orange orange orange"))

// ── falls only in set 3+ → same boulders ──
s = suggestNextFourByFour([run(G("yellow green green green"), [4, 4, 3, 2])], opts)!
assert.equal(s.direction, "hold"); assert.deepEqual(s.grades, G("yellow green green green"))

// ── block size changed since last time → fitted to the new size ──
s = suggestNextFourByFour([run(G("yellow green green green"), [4, 4, 4, 4])], { bouldersPerSet: 5 })!
assert.deepEqual(s.grades, G("yellow yellow green green green"))

console.log("all 4×4 tests passed")
