// Tests for the pure intervals rules (utils/progression/intervals.ts). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/intervals.test.ts

import assert from "node:assert/strict"
import { earlyFallLimit, intervalsDescription, liveWorkAfterFall, suggestNextIntervals } from "@/utils/progression/intervals"

const run = (scData: Record<string, any>) => ({
  sessionId: "s", createdAt: "", block: { type: "intervals" },
  attempts: [{ success: true, scData: { series: 4, workTime: 40, restTime: 60, ...scData }, blockIndex: 0, type: "intervals", timestamp: 0 }],
})
const W = (sc: Record<string, any>) => suggestNextIntervals([run(sc)], "warmup")!
const P = (sc: Record<string, any>) => suggestNextIntervals([run({ series: 8, ...sc })], "power_endurance")!

// no kind on the block, no history, or an old log without answers → no suggestion
assert.equal(suggestNextIntervals([run({ pumped: false })], undefined), null)
assert.equal(suggestNextIntervals([], "warmup"), null)
assert.equal(suggestNextIntervals([run({})], "warmup"), null)
assert.equal(suggestNextIntervals([run({ series: 8 })], "power_endurance"), null)

// ── warm-up ──
assert.equal(W({ pumped: false }).workTime, 50)
assert.equal(W({ pumped: false }).direction, "increase")
assert.equal(W({ pumped: true }).workTime, 30)
// live: each fall cuts the following rounds by 10 s (floor 30)
assert.equal(liveWorkAfterFall(50), 40)
assert.equal(liveWorkAfterFall(30), 30)
// fell in round 2, cut live 40 → 30: next session starts on 30 (no second cut)
let w = W({ startWorkTime: 40, workTime: 30, fellInRound: 2, falls: [2] })
assert.equal(w.workTime, 30); assert.equal(w.direction, "hold")
// fell in the last round (no round left to cut) → cut next session
w = W({ workTime: 50, startWorkTime: 50, fellInRound: 4, falls: [4] })
assert.equal(w.workTime, 40); assert.equal(w.direction, "decrease")
// two falls, one cut live, the other in the last round → one more cut owed
w = W({ startWorkTime: 60, workTime: 50, fellInRound: 2, falls: [2, 4] })
assert.equal(w.workTime, 40)
// older log with only fellInRound → one cut
assert.equal(W({ fellInRound: 4 }).workTime, 30)
// limits 30–90
assert.equal(W({ workTime: 90, pumped: false }).workTime, 90)
assert.equal(W({ workTime: 90, pumped: false }).direction, "hold")
assert.equal(W({ workTime: 30, pumped: true }).workTime, 30)
assert.equal(W({ workTime: 20, pumped: false }).workTime, 40)   // clamped to 30, then +10
assert.equal(W({ workTime: 120, pumped: true }).workTime, 80)   // clamped to 90, then −10

// ── power endurance ──
assert.equal(earlyFallLimit(8), 5)
assert.equal(earlyFallLimit(10), 6)
assert.equal(earlyFallLimit(4), 2)
assert.equal(P({ fellInRound: 5 }).workTime, 30)                 // round 5 of 8 → too much
assert.equal(P({ fellInRound: 6 }).workTime, 40)                 // round 6 of 8 → same
assert.equal(P({ fellInRound: 6 }).direction, "hold")
assert.equal(P({ veryEasy: true }).workTime, 50)
assert.equal(P({ veryEasy: false }).workTime, 40)
assert.equal(P({ veryEasy: false }).direction, "hold")
// rounds stay the same unless at 90 s
assert.equal(P({ veryEasy: true }).series, 8)
// at 90 s and very easy → one more round, still 90 s
const top = P({ workTime: 90, veryEasy: true })
assert.equal(top.workTime, 90); assert.equal(top.series, 9); assert.equal(top.direction, "increase")
// with 9 rounds the early-fall limit moves with it (rounds 1–6)
assert.equal(P({ series: 9, workTime: 90, fellInRound: 6 }).workTime, 80)
assert.equal(P({ series: 9, workTime: 90, fellInRound: 7 }).workTime, 90)
// warm-up never adds rounds
assert.equal(W({ workTime: 90, pumped: false }).series, 4)

// description follows the settings being run
assert.match(intervalsDescription({ kind: "warmup", series: 4, workTime: 40, restTime: 60 }), /^Warm-up intervals: 4 rounds of 40 s on the wall, 1 min rest/)
assert.match(intervalsDescription({ kind: "power_endurance", series: 9, workTime: 90, restTime: 90 }), /9 rounds of 90 s/)
assert.match(intervalsDescription({ series: 6, workTime: 30, restTime: 60 }), /^Intervals: 6 rounds/)

console.log("all intervals tests passed")
