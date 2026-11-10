// Tests for the spray-wall blocks and their suggested sequences
// (utils/sprayBlocks.ts). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/sprayBlocks.test.ts

import assert from "node:assert/strict"
import { isSprayBlock, routeRecords, sprayRouteTypeFor, spraySettings, suggestSprayRoutes } from "@/utils/sprayBlocks"
import { findBlockRuns } from "@/utils/blockHistory"

// which blocks are spray blocks — name AND type
assert.equal(sprayRouteTypeFor({ type: "sequence", blockName: "Max bouldering" }), "max_bouldering")
assert.equal(sprayRouteTypeFor({ type: "sequence", blockName: " base 1" }), "base")
assert.equal(sprayRouteTypeFor({ type: "free_session", blockName: "Power boulders" }), "power")
assert.equal(sprayRouteTypeFor({ type: "free_session", blockName: "Coordination boulders" }), "coordination")
assert.equal(sprayRouteTypeFor({ type: "free_session", blockName: "Base 1" }), null)
assert.equal(sprayRouteTypeFor({ type: "project_bouldering", blockName: "Project Bouldering" }), null)
assert.ok(!isSprayBlock(null))

// by time (Power, Coordination) or by attempts (Max, Base 1), with defaults
assert.deepEqual(spraySettings({ type: "free_session", blockName: "Power boulders", timeLimit: 25 }),
  { mode: "time", routeType: "power", minutes: 25, timeCap: null, attempts: 5, rest: 120 })
assert.equal(spraySettings({ type: "free_session", blockName: "Coordination boulders" }).minutes, 20)
assert.equal(spraySettings({ type: "free_session", blockName: "Coordination boulders" }).mode, "time")
assert.deepEqual(spraySettings({ type: "sequence", blockName: "Base 1", targetAttempts: 6, restTime: 90 }),
  { mode: "attempts", routeType: "base", minutes: 20, timeCap: null, attempts: 6, rest: 90 })
assert.equal(spraySettings({ type: "sequence", blockName: "Max bouldering" }).mode, "attempts")
// attempts block with a time limit (Max bouldering in the plan): ends at whichever comes first
assert.equal(spraySettings({ type: "sequence", blockName: "Max bouldering", timeLimit: 15 }).timeCap, 15)

// records across sessions (any block), totals and last time
const session = (id: string, at: string, attempts: any[]) => ({ $id: id, $createdAt: at, userId: "u", protocol: "[]", attempts: JSON.stringify(attempts) })
const sessions: any[] = [
  session("s2", "2026-11-08T10:00:00Z", [
    { blockIndex: 0, routeId: "a", success: true }, { blockIndex: 0, routeId: "a", success: true },
    { blockIndex: 1, routeId: "c", success: false },
    { blockIndex: 1, success: true }, // a Done marker
  ]),
  session("s1", "2026-11-01T10:00:00Z", [
    { blockIndex: 0, routeId: "a", success: false },
    { blockIndex: 0, routeId: "b", success: true },
    { blockIndex: 0, routeId: "d", success: false },
  ]),
]
const rec = routeRecords(sessions)
assert.deepEqual(rec.get("a"), { routeId: "a", tries: 3, sends: 2, lastAt: "2026-11-08T10:00:00Z" })
assert.equal(rec.size, 4)

// suggestions: only the block's type, fewest sends first, ties → climbed longest ago first
const routes = new Map([
  ["a", { id: "a", type: "power" }], ["b", { id: "b", type: "power" }],
  ["c", { id: "c", type: "power" }], ["d", { id: "d", type: "power" }],
  ["e", { id: "e", type: "power" }], // never logged → not suggested
  ["x", { id: "x", type: "coordination" }],
])
assert.deepEqual(suggestSprayRoutes(rec, routes, "power").map((r) => r.routeId), ["d", "c", "b", "a"])
assert.deepEqual(suggestSprayRoutes(rec, routes, "power", ["d"]).map((r) => r.routeId), ["c", "b", "a"]) // already picked
assert.deepEqual(suggestSprayRoutes(rec, routes, "power", [], 2).map((r) => r.routeId), ["d", "c"])
assert.deepEqual(suggestSprayRoutes(rec, routes, "coordination"), [])
// a route the athlete can't see (another athlete's, deleted) is left out
assert.deepEqual(suggestSprayRoutes(rec, new Map([["a", { id: "a", type: "power" }]]), "power").map((r) => r.routeId), ["a"])

// the workout in progress counts too (a sequence added on the first copy of the block)
const withCurrent = routeRecords(sessions, [{ blockIndex: 3, routeId: "new", success: false } as any], "2026-11-10T10:00:00Z")
assert.deepEqual(withCurrent.get("new"), { routeId: "new", tries: 1, sends: 0, lastAt: "2026-11-10T10:00:00Z" })
assert.deepEqual(suggestSprayRoutes(withCurrent, new Map([...routes, ["new", { id: "new", type: "power" }]]), "power").map((r) => r.routeId),
  ["d", "c", "new", "b", "a"])

// the coach's sequence on the block goes first, whatever its type or record
assert.deepEqual(suggestSprayRoutes(rec, routes, "power", [], 5, "a").map((r) => r.routeId), ["a", "d", "c", "b"])
assert.deepEqual(suggestSprayRoutes(rec, routes, "power", [], 5, "x").map((r) => r.routeId), ["x", "d", "c", "b", "a"])
assert.deepEqual(suggestSprayRoutes(rec, routes, "power", ["a"], 5, "a").map((r) => r.routeId), ["d", "c", "b"]) // already on it
assert.deepEqual(suggestSprayRoutes(rec, routes, "power", [], 5, "gone").map((r) => r.routeId), ["d", "c", "b", "a"]) // can't see it

// progression history: a spray block gives one run per sequence, marker left out
const sprayRun = [{
  $id: "s", $createdAt: "2026-11-09T10:00:00Z", userId: "u",
  protocol: JSON.stringify([{ type: "free_session", blockName: "Power boulders", libraryBlockId: "pw" }]),
  attempts: JSON.stringify([
    { blockIndex: 0, routeId: "a", success: true }, { blockIndex: 0, routeId: "b", success: false },
    { blockIndex: 0, success: true },
  ]),
}]
const runs = findBlockRuns(sprayRun as any, { type: "free_session", blockName: "Power boulders", libraryBlockId: "pw" })
assert.deepEqual(runs.map((r) => r.attempts.map((a: any) => a.routeId)), [["b"], ["a"]])

console.log("sprayBlocks: all tests passed")
