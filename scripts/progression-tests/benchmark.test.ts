// Tests for the plan's Benchmark sequence (utils/benchmark.ts). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/benchmark.test.ts

import assert from "node:assert/strict"
import { benchmarkBlockDraft, benchmarkComparison, benchmarkTries, benchmarkTryLabel, isBenchmark, isBenchmarkBlock } from "@/utils/benchmark"
import { isSprayBlock, spraySettings } from "@/utils/sprayBlocks"

// the block runs as a spray block: attempts, max bouldering sequences
const fresh = benchmarkBlockDraft(null)
assert.ok(isBenchmarkBlock(fresh))
assert.ok(isSprayBlock(fresh))
assert.equal(spraySettings(fresh).mode, "attempts")
assert.equal(spraySettings(fresh).routeType, "max_bouldering")
assert.equal(spraySettings(fresh).attempts, 5)
assert.equal(fresh.lockRoute, false)
const retry = benchmarkBlockDraft("r1")
assert.equal(retry.routeId, "r1")
assert.equal(retry.lockRoute, true)
assert.ok(!isBenchmarkBlock({ type: "free_session", blockName: "Benchmark" }))

// tries: only the Benchmark block, from the plan's start, oldest first
const ts = (iso: string) => new Date(iso).getTime()
const session = (iso: string, attempts: any[]) => ({
  $createdAt: iso,
  protocol: JSON.stringify([{ type: "sequence", blockName: "Max bouldering" }, { type: "sequence", blockName: "Benchmark" }]),
  attempts: JSON.stringify(attempts.map((a) => ({ timestamp: ts(iso), ...a }))),
})
const first = session("2026-10-06T15:00:00", [
  { blockIndex: 0, routeId: "x", success: true },          // another block: ignored
  { blockIndex: 1, routeId: "r1", success: false },
  { blockIndex: 1, routeId: "r1", success: false },
  { blockIndex: 1, routeId: "r1", success: false },
  { blockIndex: 1, routeId: "r1", success: false },
  { blockIndex: 1, routeId: "r1", success: false },
])
const last = session("2026-11-12T15:00:00", [
  { blockIndex: 1, routeId: "r1", success: false },
  { blockIndex: 1, routeId: "r1", success: true },
  { blockIndex: 1, routeId: "r1", success: false },
  { blockIndex: 1, routeId: "r1", success: true },
  { blockIndex: 1, routeId: "r1", success: false },
])
const before = session("2026-09-20T15:00:00", [{ blockIndex: 1, routeId: "old", success: true }])
const tries = benchmarkTries([last, before, first], "2026-10-05")
assert.deepEqual(tries.map((t) => [t.date, t.routeId, t.tries, t.tops, t.firstTop]), [
  ["2026-10-06", "r1", 5, 0, null],
  ["2026-11-12", "r1", 5, 2, 2],
])
assert.equal(benchmarkTryLabel(tries[0]), "No tops / 5")
assert.equal(benchmarkTryLabel(tries[1]), "2 tops / 5 · first on try 2")

// comparison: first try, and the latest one on the same sequence
assert.equal(benchmarkComparison([before], "2026-10-05"), null)
assert.deepEqual(benchmarkComparison([first], "2026-10-05")?.last, null)
const cmp = benchmarkComparison([last, first], "2026-10-05")!
assert.equal(cmp.routeId, "r1")
assert.equal(cmp.first.tops, 0)
assert.equal(cmp.last?.tops, 2)
// a retry on another sequence doesn't count as the retry
const other = session("2026-11-12T15:00:00", [{ blockIndex: 1, routeId: "r2", success: true }])
assert.equal(benchmarkComparison([first, other], "2026-10-05")?.last, null)

// homework naming
assert.ok(isBenchmark([{ type: "exploration_session", blockName: "Density test" }, { type: "sequence", blockName: "Benchmark" }]))
assert.ok(!isBenchmark([{ type: "exploration_session", blockName: "Density test" }]))
assert.ok(!isBenchmark([{ type: "sequence", blockName: "Benchmark" }, { type: "sequence", blockName: "Base 1" }]))

console.log("benchmark tests passed")
