// Tests for the spray blocks' intro instructions (sprayBlockSteps in utils/sprayBlocks.ts). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/sprayInstructions.test.ts

import assert from "node:assert/strict"
import { SPRAY_BLOCKS, sprayBlockSteps, spraySettings } from "@/utils/sprayBlocks"

// every spray block gets its own goal + the four steps
for (const ref of SPRAY_BLOCKS) {
  const block = { type: ref.type, blockName: ref.name }
  const steps = sprayBlockSteps(block, spraySettings(block))
  assert.deepEqual(steps.map((s) => s.title), ["Goal", "Choose a sequence", "Climb it", "Rest"], ref.name)
  assert.ok(steps.every((s) => s.text.length > 0 && s.text.length < 160), ref.name)
}

// the goals differ between blocks
const goals = new Set(SPRAY_BLOCKS.map((r) => sprayBlockSteps({ type: r.type, blockName: r.name }, spraySettings({ type: r.type, blockName: r.name }))[0].text))
assert.equal(goals.size, SPRAY_BLOCKS.length)

// counts follow the block's settings
const power = { type: "free_session", blockName: "Power boulders", timeLimit: 12 }
assert.match(sprayBlockSteps(power, spraySettings(power))[2].text, /in 12 min/)
const max = { type: "sequence", blockName: "Max bouldering", targetAttempts: 4, timeLimit: 15 }
assert.match(sprayBlockSteps(max, spraySettings(max))[2].text, /^4 attempts in 15 min\./)

// benchmark has its own copy
assert.match(sprayBlockSteps({ type: "sequence", blockName: "Benchmark" }, spraySettings({ type: "sequence", blockName: "Benchmark" }))[0].text, /start and at the end/)

// unknown block: no Goal, generic copy
const other = sprayBlockSteps({ type: "free_session", blockName: "Something" }, spraySettings({ type: "free_session", blockName: "Something" }))
assert.equal(other[0].title, "Choose a sequence")

console.log("sprayInstructions: ok")
