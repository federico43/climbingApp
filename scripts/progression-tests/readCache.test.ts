// Run with:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/readCache.test.ts
import assert from "node:assert/strict"
import { cachedRows, forgetTable, freshReads, LIBRARY_TTL_MS, READ_TTL_MS } from "@/utils/readCache"

let fetches = 0
const load = (rows: number[]) => () => { fetches++; return Promise.resolve(rows) }
const t0 = 1_000_000

// Same table and queries within the TTL: one fetch, shared.
const [a, b] = await Promise.all([
  cachedRows("workoutsession", ["q1"], load([1, 2]), t0),
  cachedRows("workoutsession", ["q1"], load([1, 2]), t0 + 1000),
])
assert.equal(fetches, 1)
assert.deepEqual(a, [1, 2])
// Each caller gets its own array
a.push(3)
assert.deepEqual(b, [1, 2])
assert.deepEqual(await cachedRows("workoutsession", ["q1"], load([9]), t0 + 2000), [1, 2])
assert.equal(fetches, 1)
// Other queries are their own entry
await cachedRows("workoutsession", ["q2"], load([5]), t0)
assert.equal(fetches, 2)
// Past the TTL: read again
assert.deepEqual(await cachedRows("workoutsession", ["q1"], load([7]), t0 + READ_TTL_MS + 1), [7])
assert.equal(fetches, 3)
// Libraries keep longer
await cachedRows("exercises", [], load([1]), t0)
await cachedRows("exercises", [], load([2]), t0 + READ_TTL_MS + 1)
assert.equal(fetches, 4)
assert.deepEqual(await cachedRows("exercises", [], load([3]), t0 + LIBRARY_TTL_MS + 1), [3])
assert.equal(fetches, 5)
// A write to a table forgets only that table
forgetTable("workoutsession")
await cachedRows("workoutsession", ["q2"], load([6]), t0 + 10)
await cachedRows("exercises", [], load([4]), t0 + LIBRARY_TTL_MS + 2)
assert.equal(fetches, 6)
// freshReads forgets everything
freshReads()
await cachedRows("exercises", [], load([4]), t0 + LIBRARY_TTL_MS + 3)
assert.equal(fetches, 7)
// A failed read isn't remembered
await assert.rejects(cachedRows("users", [], () => { fetches++; return Promise.reject(new Error("offline")) }, t0))
assert.deepEqual(await cachedRows("users", [], load([1]), t0 + 1), [1])
assert.equal(fetches, 9)

console.log("readCache: all tests passed")
