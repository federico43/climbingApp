// Tests for coached blocks in history (docs/training-plan-implementation.md
// §12c — utils/blockHistory.ts, constraintWarmup.ts, workoutSummary.ts). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/coached.test.ts

import assert from "node:assert/strict"
import { findBlockRuns } from "@/utils/blockHistory"
import { warmupUsage } from "@/utils/progression/constraintWarmup"
import { summarizeSequenceRun, isPassed, passesAtLevel, suggestNextSequence, type RouteInfo } from "@/utils/progression/sequence"
import { buildDurationHistory } from "@/utils/workoutSummary"

const sess = (id: string, protocol: any[], attempts: any[], extra: any = {}) =>
  ({ $id: id, $createdAt: `2026-10-0${id.slice(-1)}T10:00:00Z`, userId: "a", protocol: JSON.stringify(protocol), attempts: JSON.stringify(attempts), ...extra })

// ── a coached 4×4 is skipped: progression continues from the last guided run ──
const fx = { type: "four_by_four", blockName: "Power endurance - 4x4", libraryBlockId: "44" }
const sessions = [
  sess("s3", [{ ...fx, coached: true }], [{ blockIndex: 0, success: true, coached: true }]),
  sess("s2", [fx], [{ blockIndex: 0, success: true, notes: "guided" }]),
]
let runs = findBlockRuns(sessions as any, fx)
assert.deepEqual(runs.map((r) => r.sessionId), ["s2"])

// ── a coached sequence: one run per route the athlete saved, newest first ──
const seq = { type: "sequence", blockName: "Max bouldering", libraryBlockId: "mb" }
const att = (routeId: string, success: boolean) => ({ blockIndex: 0, routeId, variation: "original", success, coached: true })
const coachedSeq = sess("s4", [{ ...seq, coached: true }], [
  att("r1", true), att("r1", true), att("r1", true), att("r1", true), att("r1", true),   // 5/5
  att("r2", true), att("r2", false), att("r2", false),                                   // 1/3
  { blockIndex: 0, success: true, coached: true },                                        // Done marker
])
runs = findBlockRuns([coachedSeq] as any, seq)
assert.deepEqual(runs.map((r) => r.attempts[0].routeId), ["r2", "r1"])
assert.equal(isPassed(summarizeSequenceRun(runs[1].attempts)!), true)
assert.equal(isPassed(summarizeSequenceRun(runs[0].attempts)!), false)
// a coached block with no sequences (only Done) gives no runs
assert.deepEqual(findBlockRuns([sess("s5", [{ ...seq, coached: true }], [{ blockIndex: 0, success: true, coached: true }])] as any, seq), [])

// ── coached passes count toward levelling up ──
const routes = new Map<string, RouteInfo>([
  ["r1", { id: "r1", name: "A", level: 3, type: "max_bouldering", hasEasy: false }],
  ["r2", { id: "r2", name: "B", level: 3, type: "max_bouldering", hasEasy: false }],
  ["r3", { id: "r3", name: "C", level: 3, type: "max_bouldering", hasEasy: false }],
  ["r4", { id: "r4", name: "D", level: 3, type: "max_bouldering", hasEasy: false }],
  ["r5", { id: "r5", name: "E", level: 4, type: "max_bouldering", hasEasy: false }],
])
const pass = (r: string) => [att(r, true), att(r, true), att(r, true), att(r, true), att(r, true)]
const four = sess("s6", [{ ...seq, coached: true }], [...pass("r1"), ...pass("r2"), ...pass("r3"), ...pass("r4")])
runs = findBlockRuns([four] as any, seq)
assert.equal(passesAtLevel(runs, routes, "max_bouldering", 3), 4)
const next = suggestNextSequence(runs, routes)!
assert.equal(next.direction, "increase"); assert.equal(next.route?.id, "r5")

// ── a coached warm-up doesn't use up the constraint rotation ──
const cands = [{ id: "sf", name: "Silent Feet" }, { id: "fm", name: "foot moves" }] as any
const usage = warmupUsage([
  sess("s7", [{ type: "constraint_warmup", blockName: "Silent Feet", libraryBlockId: "sf", coached: true }], [{ blockIndex: 0, success: true, coached: true }]),
  sess("s8", [{ type: "constraint_warmup", blockName: "foot moves", libraryBlockId: "fm" }], [{ blockIndex: 0, success: true }]),
] as any, cands)
assert.deepEqual([...usage.last], ["fm"])
assert.equal(usage.recency.has("sf"), false)

// ── coached blocks don't feed duration estimates ──
const hist = buildDurationHistory([{ protocol: JSON.stringify([{ ...fx, coached: true }, fx]), blockDurations: JSON.stringify({ 0: 3000, 1: 1200 }) }])
assert.deepEqual(hist.get("four_by_four"), [1200])

console.log("all coached tests passed")
