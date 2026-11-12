// Tests for handsAfterBounce (utils/sprayHands.ts). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/sprayHands.test.ts

import assert from "node:assert/strict"
import { handsAfterBounce, type HandHold } from "@/utils/sprayHands"

const mv = (id: string, order: number, extra: Partial<HandHold> = {}): HandHold => ({ id, type: "move", order, ...extra })

// 1L, 2R, 3L bounce → 4 is L again
assert.deepEqual([...handsAfterBounce([mv("a", 1, { hand: "left" }), mv("b", 2), mv("c", 3, { bounce: true }), mv("d", 4), mv("e", 5)])], [["d", "L"]])
// bounce on move 2 (R) → 3 is R
assert.deepEqual([...handsAfterBounce([mv("a", 1, { hand: "left" }), mv("b", 2, { bounce: true }), mv("c", 3)])], [["c", "R"]])
// two bounces: 1R, 2L bounce → 3L, 4R bounce → 5R
assert.deepEqual(
  [...handsAfterBounce([mv("a", 1, { hand: "right" }), mv("b", 2, { bounce: true }), mv("c", 3), mv("d", 4, { bounce: true }), mv("e", 5)])],
  [["c", "L"], ["e", "R"]],
)
// a match before the bounce: 1L, 2R+3L (match), 4R bounce → 5R
assert.deepEqual(
  [...handsAfterBounce([mv("a", 1, { hand: "left" }), mv("b", 2, { match: true }), mv("c", 3, { bounce: true }), mv("d", 4)])],
  [["d", "R"]],
)
// order comes from `order`, not array position; feet are ignored
assert.deepEqual(
  [...handsAfterBounce([mv("d", 3), { id: "f", type: "foot" }, mv("b", 2, { bounce: true }), mv("a", 1, { hand: "left" })])],
  [["d", "R"]],
)
// no hand on move 1, or both hands → nothing
assert.equal(handsAfterBounce([mv("a", 1), mv("b", 2, { bounce: true }), mv("c", 3)]).size, 0)
assert.equal(handsAfterBounce([mv("a", 1, { hand: "both" }), mv("b", 2, { bounce: true }), mv("c", 3)]).size, 0)
// bounce on the last move → nothing to label
assert.equal(handsAfterBounce([mv("a", 1, { hand: "left" }), mv("b", 2, { bounce: true })]).size, 0)
console.log("sprayHands ok")
