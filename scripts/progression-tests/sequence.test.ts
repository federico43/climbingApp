// Tests for the pure sequence rules (utils/progression/sequence.ts). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/sequence.test.ts

import assert from "node:assert/strict"
import { suggestNextSequence, summarizeSequenceRun, isPassed, isEarlyFall, passesAtLevel, type RouteInfo } from "@/utils/progression/sequence"

const R = (id: string, level: number, o: Partial<RouteInfo> = {}): RouteInfo => ({ id, name: id, level, type: "base", wallId: "w", hasEasy: true, ...o })
const routes = new Map<string, RouteInfo>([
  ["a3", R("a3", 3)], ["b3", R("b3", 3)], ["c3", R("c3", 3)], ["d3", R("d3", 3)], ["e3", R("e3", 3)],
  ["a4", R("a4", 4)], ["a2", R("a2", 2)], ["noeasy3", R("noeasy3", 3, { hasEasy: false })],
  ["other-wall3", R("other-wall3", 3, { wallId: "x" })], ["max3", R("max3", 3, { type: "max_bouldering" })],
])
const att = (routeId: string, results: string, variation = "original") =>
  [...results].map((c) => ({ success: c === "s", routeId, variation, blockIndex: 0, type: "sequence", timestamp: 0 }))
const run = (attempts: any[]) => ({ sessionId: "s", createdAt: "", block: {}, attempts })

// rounding: 3/4 = 75 % → 80 % pass; 5/7 = 71 % → 70 % no
assert.equal(isPassed(summarizeSequenceRun(att("a3", "sssf"))!), true)
assert.equal(isPassed(summarizeSequenceRun(att("a3", "sssssff"))!), false)
assert.equal(summarizeSequenceRun(att("a3", "ssssf"))!.sendRate, 0.8)
// pass on Easier doesn't count
assert.equal(isPassed(summarizeSequenceRun(att("a3", "sssss", "easy"))!), false)

// passed, 1st pass at level → different level-3 route, same wall/type, not passed yet
let s = suggestNextSequence([run(att("a3", "sssss"))], routes)!
assert.equal(s.direction, "hold"); assert.equal(s.route!.level, 3); assert.notEqual(s.route!.id, "a3")
assert.ok(!["other-wall3", "max3"].includes(s.route!.id), s.route!.id)

// 4 distinct passes at level 3 → level 4
const four = [run(att("d3", "sssss")), run(att("c3", "ssssf")), run(att("b3", "sssss")), run(att("a3", "sssss"))]
assert.equal(passesAtLevel(four, routes, "base", 3), 4)
s = suggestNextSequence(four, routes)!
assert.equal(s.direction, "increase"); assert.equal(s.route!.id, "a4")
// a level-2 run in between resets the count
assert.equal(passesAtLevel([run(att("d3", "sssss")), run(att("c3", "sssss")), run(att("a2", "sssss")), run(att("b3", "sssss"))], routes, "base", 3), 2)

// sends but under 80 % → same route, start on variation finished
s = suggestNextSequence([run(att("a3", "sffff", "hard"))], routes)!
assert.equal(s.route!.id, "a3"); assert.equal(s.startVariation, "hard")
// sends only on Easier → same route, start Easier
s = suggestNextSequence([run(att("a3", "sssss", "easy"))], routes)!
assert.equal(s.route!.id, "a3"); assert.equal(s.startVariation, "easy")
// 0 sends on Original → same route on Easier
s = suggestNextSequence([run(att("a3", "fffff"))], routes)!
assert.equal(s.direction, "decrease"); assert.equal(s.route!.id, "a3"); assert.equal(s.startVariation, "easy")
// 0 sends having started on Easier → level 2
s = suggestNextSequence([run(att("a3", "fffff", "easy"))], routes)!
assert.equal(s.route!.id, "a2")
// 0 sends, route has no Easier → level down directly
s = suggestNextSequence([run(att("noeasy3", "fffff"))], routes)!
assert.equal(s.route!.id, "a2")
// in-session level drop: judged on the route ended on
assert.equal(summarizeSequenceRun([...att("a3", "f"), ...att("a2", "sssss")])!.routeId, "a2")
// no history → null
assert.equal(suggestNextSequence([], routes), null)

// first third: 9 moves → falls at 1–3 are early
assert.equal(isEarlyFall(3, 9), true); assert.equal(isEarlyFall(4, 9), false)
assert.equal(isEarlyFall(1, 2), true); assert.equal(isEarlyFall(undefined, 9), false)
console.log("all sequence tests passed")
