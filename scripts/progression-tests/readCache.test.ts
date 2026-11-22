// Run with:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/readCache.test.ts
import assert from "node:assert/strict"
import {
  cachedRows, filtersOf, freshReads, IDLE_MS, LIBRARY_TTL_MS, MAX_LISTS, mergeOrderOf, mergeRows, READ_TTL_MS,
  signatureOf, tableChanged, type Signature,
} from "@/utils/readCache"

let fetches = 0
const load = <T>(rows: T[]) => () => { fetches++; return Promise.resolve(rows) }
const t0 = 1_000_000

// Same table and queries within the TTL: one fetch, shared.
const [a, b] = await Promise.all([
  cachedRows("workoutsession", ["q1"], load([1, 2]), { now: t0 }),
  cachedRows("workoutsession", ["q1"], load([1, 2]), { now: t0 + 1000 }),
])
assert.equal(fetches, 1)
assert.deepEqual(a, [1, 2])
// Each caller gets its own array
a.push(3)
assert.deepEqual(b, [1, 2])
assert.deepEqual(await cachedRows("workoutsession", ["q1"], load([9]), { now: t0 + 2000 }), [1, 2])
assert.equal(fetches, 1)
// Other queries are their own entry
await cachedRows("workoutsession", ["q2"], load([5]), { now: t0 })
assert.equal(fetches, 2)
// Past the TTL with no way to check: read again
assert.deepEqual(await cachedRows("workoutsession", ["q1"], load([7]), { now: t0 + READ_TTL_MS + 1 }), [7])
assert.equal(fetches, 3)
// Libraries keep longer
await cachedRows("exercises", [], load([1]), { now: t0 })
await cachedRows("exercises", [], load([2]), { now: t0 + READ_TTL_MS + 1 })
assert.equal(fetches, 4)
assert.deepEqual(await cachedRows("exercises", [], load([3]), { now: t0 + LIBRARY_TTL_MS + 1 }), [3])
assert.equal(fetches, 5)
// A write to a table touches only that table's lists
tableChanged("workoutsession")
await cachedRows("workoutsession", ["q2"], load([6]), { now: t0 + 10 })
await cachedRows("exercises", [], load([4]), { now: t0 + LIBRARY_TTL_MS + 2 })
assert.equal(fetches, 6)
// A failed read isn't remembered
await assert.rejects(cachedRows("users", [], () => { fetches++; return Promise.reject(new Error("offline")) }, { now: t0 }))
assert.deepEqual(await cachedRows("users", [], load([1]), { now: t0 + 1 }), [1])
assert.equal(fetches, 8)

// ── Helpers ──────────────────────────────────────────────────────────────────
type Row = { $id: string; $createdAt: string; $updatedAt: string; [k: string]: unknown }
const at = (h: number) => `2026-11-20T${String(h).padStart(2, "0")}:00:00.000+00:00`
const row = (id: string, created: number, updated = created, extra: Record<string, unknown> = {}): Row =>
  ({ $id: id, $createdAt: at(created), $updatedAt: at(updated), ...extra })
assert.deepEqual(signatureOf([row("a", 10), row("b", 11)]), { count: 2, newest: at(11) })
assert.deepEqual(signatureOf([]), { count: 0, newest: "" })
assert.equal(signatureOf([{ $id: "a" }]), null) // a select without $updatedAt
// The check uses the filters only (no order, page or columns)
const eqUser = '{"method":"equal","attribute":"userId","values":["u1"]}'
const newestFirst = '{"method":"orderDesc","attribute":"$createdAt"}'
assert.deepEqual(
  filtersOf([eqUser, newestFirst, '{"method":"select","values":["$id"]}', '{"method":"limit","values":[100]}', '{"method":"cursorAfter","values":["x"]}']),
  [eqUser],
)
// New rows are merged only into lists sorted by $createdAt alone
assert.deepEqual(mergeOrderOf([eqUser, newestFirst]), { desc: true })
assert.deepEqual(mergeOrderOf(['{"method":"orderAsc","attribute":"$createdAt"}']), { desc: false })
assert.equal(mergeOrderOf(['{"method":"orderAsc","attribute":"name"}']), null)
assert.equal(mergeOrderOf([eqUser]), null)
assert.equal(mergeOrderOf([newestFirst, '{"method":"orderAsc","attribute":"name"}']), null)
assert.deepEqual(
  mergeRows([row("s2", 11), row("s1", 10)], [row("s3", 12), row("s1", 10, 13, { attempts: "edited" })], { desc: true }).map((r: any) => [r.$id, r.attempts]),
  [["s3", undefined], ["s2", undefined], ["s1", "edited"]],
)

// ── A session history: checked with one row, brought up to date with a few ──
{
  let server: Row[] = [row("s2", 11, 11, { roster: ["ana"] }), row("s1", 10)]
  let checks = 0, reads = 0, deltas = 0
  const read = () => { reads++; return Promise.resolve(server) }
  const check = () => { checks++; return Promise.resolve(signatureOf(server) as Signature) }
  const delta = (since: string) => { deltas++; return Promise.resolve(server.filter((r) => r.$updatedAt > since)) }
  const q = [eqUser, newestFirst]
  const fetchers = { check, delta }
  const t1 = 50_000_000
  const get = (now: number) => cachedRows<any>("workoutsession", q, read, { ...fetchers, now })
  await get(t1)
  assert.equal(reads, 1)
  // Unchanged: one check, the same rows, no full read
  assert.deepEqual(await get(t1 + READ_TTL_MS + 1), server)
  assert.deepEqual([checks, reads, deltas], [1, 1, 0])
  // …and trusted for another TTL from that check
  await get(t1 + READ_TTL_MS + 2)
  assert.equal(checks, 1)
  // A new session (a workout saved on this phone): check + just the new row
  server = [row("s3", 12), ...server]
  tableChanged("workoutsession")
  const withNew = await get(t1 + READ_TTL_MS + 3)
  assert.deepEqual(withNew.map((r: any) => r.$id), ["s3", "s2", "s1"])
  assert.deepEqual([checks, reads, deltas], [2, 1, 1])
  // An edited one (someone else's write, past the TTL): merged in place
  server = [server[0], server[1], row("s1", 10, 14, { attempts: "edited" })]
  const edited = await get(t1 + 2 * READ_TTL_MS + 4)
  assert.deepEqual(edited.map((r: any) => [r.$id, r.attempts]), [["s3", undefined], ["s2", undefined], ["s1", "edited"]])
  assert.deepEqual([checks, reads, deltas], [3, 1, 2])
  // A deleted one changes the count, which a merge can't fix: read in full
  server = [server[0], server[2]]
  freshReads()
  assert.deepEqual((await get(t1 + 2 * READ_TTL_MS + 5)).map((r: any) => r.$id), ["s3", "s1"])
  assert.deepEqual([checks, reads, deltas], [4, 2, 3])
  // A delete and a new row at once: the merge doesn't match the check either
  server = [row("s4", 15), server[1]]
  freshReads()
  assert.deepEqual((await get(t1 + 2 * READ_TTL_MS + 6)).map((r: any) => r.$id), ["s4", "s1"])
  assert.deepEqual([checks, reads, deltas], [5, 3, 4])
  // A check that fails (bad query) falls back to a full read
  const failing = () => { checks++; return Promise.reject(new Error("400")) }
  await cachedRows("workoutsession", q, read, { check: failing, delta, now: t1 + 4 * READ_TTL_MS })
  assert.equal(reads, 4)
  // Offline (check and read both fail): the call fails, the old rows stay to
  // check against next time
  const offline = () => Promise.reject(new Error("offline"))
  await assert.rejects(cachedRows("workoutsession", q, offline, { check: offline, delta: offline, now: t1 + 6 * READ_TTL_MS }))
  await get(t1 + 6 * READ_TTL_MS + 1)
  assert.equal(reads, 4)
  // Rows can't be changed through the cache, nested arrays included
  const mine = await get(t1 + 6 * READ_TTL_MS + 2)
  mine[0].attempts = "changed"
  mine[0].$id = "other"
  const theirs = await get(t1 + 6 * READ_TTL_MS + 3)
  assert.equal(theirs[0].$id, "s4")
  assert.equal(theirs[0].attempts, undefined)
  // Not asked for in a long while: dropped, read in full
  await get(t1 + 6 * READ_TTL_MS + 4 + IDLE_MS + 1)
  assert.equal(reads, 5)
}
{
  // A list not sorted by $createdAt (the library, by name): a change means a full read
  let server: Row[] = [row("b1", 10, 10, { name: "A" })]
  let reads = 0, deltas = 0
  const fetchers = {
    check: () => Promise.resolve(signatureOf(server) as Signature),
    delta: (since: string) => { deltas++; return Promise.resolve(server.filter((r) => r.$updatedAt > since)) },
  }
  const q = ['{"method":"orderAsc","attribute":"name"}']
  const read = () => { reads++; return Promise.resolve(server) }
  await cachedRows("blocks", q, read, { ...fetchers, now: t0 })
  server = [...server, row("b2", 11, 11, { name: "B" })]
  tableChanged("blocks")
  assert.equal((await cachedRows("blocks", q, read, { ...fetchers, now: t0 + 1 })).length, 2)
  assert.deepEqual([reads, deltas], [2, 0])
}
{
  // Rows from a select without $updatedAt can't be checked: read in full past the TTL
  let reads = 0, checks = 0
  const read = () => { reads++; return Promise.resolve([{ $id: "a" }]) }
  const check = () => { checks++; return Promise.resolve({ count: 1, newest: "" }) }
  await cachedRows("protocol", ["sel"], read, { check, now: t0 })
  await cachedRows("protocol", ["sel"], read, { check, now: t0 + READ_TTL_MS + 1 })
  assert.deepEqual([checks, reads], [0, 2])
}
{
  // Nested arrays are copies (a roster pushed to doesn't leak)
  const read = () => Promise.resolve([row("c", 9, 9, { roster: ["ana"] })])
  const first = await cachedRows<any>("classes", ["arr"], read, { now: t0 })
  first[0].roster.push("bea")
  const second = await cachedRows<any>("classes", ["arr"], read, { now: t0 + 1 })
  assert.deepEqual(second[0].roster, ["ana"])
}
{
  // At most MAX_LISTS lists kept: the least recently used go first
  const t2 = 90_000_000
  let reads = 0
  const read = () => { reads++; return Promise.resolve([] as unknown[]) }
  for (let i = 0; i <= MAX_LISTS; i++) await cachedRows("cap", [`k${i}`], read, { now: t2 + i })
  assert.equal(reads, MAX_LISTS + 1)
  await cachedRows("cap", [`k${MAX_LISTS}`], read, { now: t2 + MAX_LISTS + 1 }) // still there
  await cachedRows("cap", ["k0"], read, { now: t2 + MAX_LISTS + 2 })              // dropped
  assert.equal(reads, MAX_LISTS + 2)
}

console.log("readCache: all tests passed")
