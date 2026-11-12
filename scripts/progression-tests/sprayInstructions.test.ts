// Tests for the spray blocks' intro instructions (sprayBlockSteps in utils/sprayBlocks.ts). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/sprayInstructions.test.ts

import assert from "node:assert/strict"
import { sprayBlockSteps, spraySettings, sprayShowsAttempts, sprayShowsCoachNotes } from "@/utils/sprayBlocks"

const steps = (b: any) => sprayBlockSteps(b, spraySettings(b))
const text = (b: any) => steps(b).map((s) => s.text).join(" ")

// Power, Coordination, Max, Benchmark: Goal + steps; time only, never the attempt count
for (const name of ["Power boulders", "Coordination boulders"]) {
  const b = { type: "free_session", blockName: name }
  assert.deepEqual(steps(b).map((s) => s.title), ["Goal", "Choose a sequence", "Climb it", "Rest"], name)
  assert.match(text(b), /15 min/, name)
  assert.doesNotMatch(text(b), /attempts? (in|·)|\d+ attempts/, name)
  assert.ok(!sprayShowsAttempts(b, spraySettings(b)), name)
}
const max = { type: "sequence", blockName: "Max bouldering", targetAttempts: 4, timeLimit: 15 }
assert.equal(steps(max)[0].title, "Goal")
assert.match(text(max), /15 min/)
assert.doesNotMatch(text(max), /4 attempts/)
assert.ok(!sprayShowsAttempts(max, spraySettings(max)))

// no technique talk
for (const b of [max, { type: "free_session", blockName: "Power boulders" }, { type: "free_session", blockName: "Coordination boulders" }]) {
  assert.doesNotMatch(text(b), /feet|legs|lock off|quiet|sloppy|full effort|commit/i)
}

// Base 1: the plain steps with the attempt count (the coach's notes explain it)
const base = { type: "sequence", blockName: "Base 1", targetAttempts: 6 }
assert.deepEqual(steps(base).map((s) => s.title), ["Choose a sequence", "Climb it", "Rest"])
assert.match(text(base), /^A new one/)
assert.match(text(base), /6 attempts/)
assert.ok(sprayShowsAttempts(base, spraySettings(base)))

// Benchmark with no time limit still says something to climb
const bench = { type: "sequence", blockName: "Benchmark" }
assert.match(steps(bench)[0].text, /start and at the end/)
assert.ok(sprayShowsAttempts(bench, spraySettings(bench)))

// not a spray block: plain steps
assert.equal(steps({ type: "free_session", blockName: "Something" })[0].title, "Choose a sequence")

console.log("sprayInstructions: ok")

// Power and Max: no coach notes, choose-or-create step, Max goal (coach 2026-11-12)
assert.ok(!sprayShowsCoachNotes(max))
assert.ok(!sprayShowsCoachNotes({ type: "free_session", blockName: "Power boulders" }))
assert.ok(sprayShowsCoachNotes({ type: "free_session", blockName: "Coordination boulders" }))
assert.ok(sprayShowsCoachNotes({ type: "sequence", blockName: "Base 1" }))
assert.match(steps(max)[0].text, /4–5 move/)
assert.match(steps(max)[1].text, /with your coach or on your own/)
assert.doesNotMatch(text({ type: "free_session", blockName: "Coordination boulders" }), /deadpoint/i)
