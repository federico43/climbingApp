// Tests for utils/sessionQueue.ts (finished workouts kept until they reach
// Appwrite). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/sessionQueue.test.ts

import assert from "node:assert/strict"
import { flushPendingSessions, type FlushDeps, type PendingSession } from "@/utils/sessionQueue"

const offline = () => new TypeError("Network request failed")
const appwrite = (message: string, code: number) => Object.assign(new Error(message), { name: "AppwriteException", code })

const entry = (id: string, extra: Partial<PendingSession> = {}): PendingSession => ({
  id, userId: "u1", data: { protocol: "[]" }, createdAt: Number(id.replace(/\D/g, "")) || 0, tries: 0, ...extra,
})

// A fake store + backend: `saveFails` / `notifyFails` map an entry id to the
// error that step throws.
function harness(entries: PendingSession[], opts: { saveFails?: Record<string, unknown>; notifyFails?: Record<string, unknown>; user?: string } = {}) {
  let store = entries.map((e) => ({ ...e }))
  const saved: string[] = []
  const notified: string[] = []
  const deps: FlushDeps = {
    currentUserId: opts.user ?? "u1",
    save: async (e) => { if (opts.saveFails?.[e.id]) throw opts.saveFails[e.id]; saved.push(e.id) },
    notify: async (e) => { if (opts.notifyFails?.[e.id]) throw opts.notifyFails[e.id]; notified.push(e.id) },
    update: async (e) => { store = store.map((x) => (x.id === e.id ? e : x)) },
    remove: async (id) => { store = store.filter((x) => x.id !== id) },
  }
  return { deps, saved, notified, get store() { return store } }
}

// Online: rows written oldest first, coach notified only where asked, queue emptied.
{
  const h = harness([entry("s2", { notify: { protocolName: "Power" } }), entry("s1")])
  const r = await flushPendingSessions(h.store, h.deps)
  assert.deepEqual(r, { synced: 2, offline: false })
  assert.deepEqual(h.saved, ["s1", "s2"])
  assert.deepEqual(h.notified, ["s2"])
  assert.equal(h.store.length, 0)
}

// Offline: nothing lost, nothing sent, the pass stops at the first failure.
{
  const h = harness([entry("s1", { notify: { protocolName: "A" } }), entry("s2")], { saveFails: { s1: offline() } })
  const r = await flushPendingSessions(h.store, h.deps)
  assert.deepEqual(r, { synced: 0, offline: true })
  assert.deepEqual(h.saved, [])
  assert.deepEqual(h.notified, [])
  assert.equal(h.store.length, 2)
}

// Row written but the push couldn't go out → kept as saved; next pass only notifies.
{
  const h = harness([entry("s1", { notify: { protocolName: "A" } })], { notifyFails: { s1: offline() } })
  assert.deepEqual(await flushPendingSessions(h.store, h.deps), { synced: 0, offline: true })
  assert.equal(h.store.length, 1)
  assert.equal(h.store[0].saved, true)
  const h2 = harness(h.store)
  assert.deepEqual(await flushPendingSessions(h2.store, h2.deps), { synced: 1, offline: false })
  assert.deepEqual(h2.saved, [])
  assert.deepEqual(h2.notified, ["s1"])
  assert.equal(h2.store.length, 0)
}

// An earlier write reached the server but the answer got lost → 409 on retry
// counts as saved (no duplicate session), and the coach still gets the push.
{
  const h = harness([entry("s1", { notify: { protocolName: "A" } })], { saveFails: { s1: appwrite("Row with the requested ID already exists.", 409) } })
  assert.deepEqual(await flushPendingSessions(h.store, h.deps), { synced: 1, offline: false })
  assert.deepEqual(h.notified, ["s1"])
  assert.equal(h.store.length, 0)
}

// A server error on one entry keeps it (with the reason) and moves on to the next.
{
  const h = harness([entry("s1"), entry("s2")], { saveFails: { s1: appwrite("Invalid document structure", 400) } })
  assert.deepEqual(await flushPendingSessions(h.store, h.deps), { synced: 1, offline: false })
  assert.deepEqual(h.store.map((e) => [e.id, e.tries, e.lastError]), [["s1", 1, "Invalid document structure"]])
}

// The backend refusing the push (not a connection problem) doesn't keep the
// workout queued forever.
{
  const h = harness([entry("s1", { notify: { protocolName: "A" } })], { notifyFails: { s1: appwrite("Server error", 500) } })
  assert.deepEqual(await flushPendingSessions(h.store, h.deps), { synced: 1, offline: false })
  assert.equal(h.store.length, 0)
}

// Someone else signed in on the phone: their pass leaves the other athlete's
// workout alone; an entry queued without a known user is claimed by whoever syncs it.
{
  const h = harness([entry("s1", { userId: "u1" }), entry("s2", { userId: null })], { user: "u2" })
  assert.deepEqual(await flushPendingSessions(h.store, h.deps), { synced: 1, offline: false })
  assert.deepEqual(h.saved, ["s2"])
  assert.deepEqual(h.store.map((e) => e.id), ["s1"])
}

console.log("all session queue tests passed")
