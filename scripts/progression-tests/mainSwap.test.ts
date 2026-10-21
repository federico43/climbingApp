// Tests for the athlete's mid-workout ⇄ switch of the main block
// (utils/mainSwap.ts). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/mainSwap.test.ts

import assert from "node:assert/strict"
import { applyMainSwap, mainSwapFor } from "@/utils/mainSwap"

const warmup = { id: "w", blockName: "1 on 1 off", type: "intervals" }
const project = (id: string) => ({ id, blockName: "Project Bouldering", type: "project_bouldering", libraryBlockId: "p" })
const fourByFour = (id: string) => ({ id, blockName: "Power endurance - 4x4", type: "four_by_four" })
const blocks = [warmup, project("m1"), project("m2")]

// which blocks can switch, and to what
assert.equal(mainSwapFor(blocks, 0), null)                                  // warm-up isn't a main block
assert.equal(mainSwapFor(blocks, 1)?.to.name, "Max bouldering")
assert.equal(mainSwapFor(blocks, 1)?.mainType, "strength")
assert.equal(mainSwapFor([fourByFour("a")], 0)?.to.name, "Base 1")
assert.equal(mainSwapFor([{ blockName: "Base 1", type: "sequence" }], 0)?.to.name, "Power endurance - 4x4")
assert.equal(mainSwapFor([{ blockName: "Base 1", type: "free_session" }], 0), null) // name AND type
assert.equal(mainSwapFor([{ blockName: "Power boulders", type: "free_session" }], 0), null) // only one power block
assert.equal(mainSwapFor([{ blockName: " max BOULDERING ", type: "sequence" }], 0)?.to.name, "Project Bouldering")
assert.equal(mainSwapFor(blocks, 9), null)

// swapping replaces this copy and the untouched copies right after it
const max = { blockName: "Max bouldering", type: "sequence", libraryBlockId: "x" }
const out = applyMainSwap([...blocks, warmup], 1, max, new Set())
assert.deepEqual(out.map((b) => b.blockName), ["1 on 1 off", "Max bouldering", "Max bouldering", "1 on 1 off"])
assert.deepEqual(out.map((b) => b.id), ["w", "m1", "m2", "w"])               // ids kept
assert.equal(out[1].libraryBlockId, "x")
// a copy already started stays as it is
assert.deepEqual(applyMainSwap(blocks, 1, max, new Set([2])).map((b) => b.blockName), ["1 on 1 off", "Max bouldering", "Project Bouldering"])
// switching the second copy only touches that one
assert.deepEqual(applyMainSwap(blocks, 2, max, new Set([1])).map((b) => b.blockName), ["1 on 1 off", "Project Bouldering", "Max bouldering"])
// the coached flag stays with each slot
const coached = applyMainSwap([{ ...project("m1"), coached: true }, project("m2")], 0, max, new Set())
assert.equal(coached[0].coached, true)
assert.equal(coached[1].coached, undefined)

console.log("mainSwap tests passed")
