// Tests for functions/aiProtocol/src/expoPush.js (Expo push guardrails). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/expoPush.test.ts

import assert from "node:assert/strict"
import { EXPO_PUSH_URL, EXPO_RECEIPTS_URL, isExpoPushToken, sendExpoPush } from "@/functions/aiProtocol/src/expoPush.js"

const A = "ExponentPushToken[aaaa]"
const B = "ExponentPushToken[bbbb]"
const C = "ExpoPushToken[cccc]"

type Call = { url: string; body: any }
type Reply = { status: number; json?: unknown } | Error

// A fake fetch that answers from a queue and records what was sent.
function fakeFetch(replies: Reply[]) {
  const calls: Call[] = []
  const impl = async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) })
    const r = replies.shift()
    if (!r) throw new Error("unexpected fetch")
    if (r instanceof Error) throw r
    const text = r.json === undefined ? "" : JSON.stringify(r.json)
    return { status: r.status, text: async () => text }
  }
  return { calls, impl }
}

const msg = (to: unknown) => ({ to, title: "t", body: "b" })
const quiet = { retryDelayMs: 0 }

assert.equal(isExpoPushToken(A), true)
assert.equal(isExpoPushToken(C), true)
assert.equal(isExpoPushToken("abc"), false)
assert.equal(isExpoPushToken("ExponentPushToken[]"), false)
assert.equal(isExpoPushToken(null), false)

// 200 with a DeviceNotRegistered ticket → counted as failed, token returned to clear
{
  const f = fakeFetch([{ status: 200, json: { data: [
    { status: "ok", id: "t1" },
    { status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } },
  ] } }])
  const r = await sendExpoPush([msg(A), msg(B)], { ...quiet, fetchImpl: f.impl })
  assert.deepEqual(r, { sent: 1, failed: 1, invalidTokens: [B] })
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].url, EXPO_PUSH_URL)
}

// other ticket errors are failures but the token is kept
{
  const f = fakeFetch([{ status: 200, json: { data: [{ status: "error", details: { error: "MessageRateExceeded" } }] } }])
  const r = await sendExpoPush([msg(A)], { ...quiet, fetchImpl: f.impl })
  assert.deepEqual(r, { sent: 0, failed: 1, invalidTokens: [] })
}

// malformed tokens never go out (they'd fail the whole request); missing ones are ignored; duplicates sent once
{
  const f = fakeFetch([{ status: 200, json: { data: [{ status: "ok", id: "t1" }] } }])
  const r = await sendExpoPush([msg("garbage"), msg(null), msg(A), msg(A)], { ...quiet, fetchImpl: f.impl })
  assert.deepEqual(r, { sent: 1, failed: 1, invalidTokens: ["garbage"] })
  assert.deepEqual(f.calls[0].body.map((m: any) => m.to), [A])
}

// nothing to send → no request
{
  const f = fakeFetch([])
  assert.deepEqual(await sendExpoPush([msg(undefined)], { ...quiet, fetchImpl: f.impl }), { sent: 0, failed: 0, invalidTokens: [] })
}

// 5xx then success → retried once
{
  const f = fakeFetch([{ status: 503 }, { status: 200, json: { data: [{ status: "ok", id: "t1" }] } }])
  const r = await sendExpoPush([msg(A)], { ...quiet, fetchImpl: f.impl })
  assert.equal(r.sent, 1)
  assert.equal(f.calls.length, 2)
}

// network error twice → failed, no throw
{
  const f = fakeFetch([new TypeError("fetch failed"), new TypeError("fetch failed")])
  assert.deepEqual(await sendExpoPush([msg(A)], { ...quiet, fetchImpl: f.impl }), { sent: 0, failed: 1, invalidTokens: [] })
}

// a 400 on the batch → each message retried alone, so one bad one doesn't sink the rest
{
  const f = fakeFetch([
    { status: 400, json: { errors: [{ code: "PUSH_TOO_MANY_EXPERIENCE_IDS" }] } },
    { status: 200, json: { data: [{ status: "ok", id: "t1" }] } },
    { status: 400, json: { errors: [{ code: "VALIDATION_ERROR" }] } },
  ])
  const r = await sendExpoPush([msg(A), msg(B)], { ...quiet, fetchImpl: f.impl })
  assert.deepEqual(r, { sent: 1, failed: 1, invalidTokens: [] })
  assert.equal(f.calls.length, 3)
}

// receipts: a later DeviceNotRegistered moves the message from sent to failed
{
  const f = fakeFetch([
    { status: 200, json: { data: [{ status: "ok", id: "t1" }, { status: "ok", id: "t2" }] } },
    { status: 200, json: { data: {
      t1: { status: "ok" },
      t2: { status: "error", details: { error: "DeviceNotRegistered" } },
    } } },
  ])
  const r = await sendExpoPush([msg(A), msg(B)], { ...quiet, fetchImpl: f.impl, receiptWaitMs: 1 })
  assert.deepEqual(r, { sent: 1, failed: 1, invalidTokens: [B] })
  assert.equal(f.calls[1].url, EXPO_RECEIPTS_URL)
  assert.deepEqual(f.calls[1].body, { ids: ["t1", "t2"] })
}

// receipts not ready yet (empty) → nothing changes; lookup failing → logged, not thrown
{
  const f = fakeFetch([{ status: 200, json: { data: [{ status: "ok", id: "t1" }] } }, { status: 200, json: { data: {} } }])
  assert.deepEqual(await sendExpoPush([msg(A)], { ...quiet, fetchImpl: f.impl, receiptWaitMs: 1 }), { sent: 1, failed: 0, invalidTokens: [] })
  const errors: string[] = []
  const g = fakeFetch([{ status: 200, json: { data: [{ status: "ok", id: "t1" }] } }, { status: 500 }, { status: 500 }])
  const r = await sendExpoPush([msg(A)], { ...quiet, fetchImpl: g.impl, receiptWaitMs: 1, error: (s: string) => errors.push(s) })
  assert.deepEqual(r, { sent: 1, failed: 0, invalidTokens: [] })
  assert.ok(errors.some((e) => e.includes("receipts lookup failed")))
}

// no receipt lookup unless asked (sync callers don't wait)
{
  const f = fakeFetch([{ status: 200, json: { data: [{ status: "ok", id: "t1" }] } }])
  await sendExpoPush([msg(A)], { ...quiet, fetchImpl: f.impl })
  assert.equal(f.calls.length, 1)
}

console.log("all expoPush tests passed")
