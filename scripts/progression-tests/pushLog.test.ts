// Tests for functions/aiProtocol/src/pushLog.js (rows for the push log). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/pushLog.test.ts

import assert from "node:assert/strict"
import { pushLogRows, toPushLogEntry } from "@/functions/aiProtocol/src/pushLog.js"

const A = "ExponentPushToken[aaaa]"
const B = "ExponentPushToken[bbbb]"
const build = (u: any) => ({ sound: "default", title: `Hi ${u.username}`, body: "Class tomorrow at 7:00", data: { type: "class_tomorrow" } })

// sent / failed / no token, one row each, with who, what and why
{
  const users = [
    { $id: "u1", username: "Ana", pushToken: A },
    { $id: "u2", username: "Beto", pushToken: B },
    { $id: "u3", username: "Caro", pushToken: null },
  ]
  const outcomes = new Map([[A, { ok: true, error: null }], [B, { ok: false, error: "DeviceNotRegistered" }]])
  const rows = pushLogRows(users, build, outcomes, "classCron")
  assert.deepEqual(rows.map((r: any) => [r.userId, r.status, r.error]), [
    ["u1", "sent", null],
    ["u2", "failed", "DeviceNotRegistered"],
    ["u3", "no_token", null],
  ])
  assert.deepEqual(rows[0], {
    userId: "u1", userName: "Ana", type: "class_tomorrow", title: "Hi Ana",
    body: "Class tomorrow at 7:00", status: "sent", error: null, source: "classCron",
  })
}

// a token with no outcome (never went out) is a failure, not a silent "sent"
{
  const rows = pushLogRows([{ $id: "u1", pushToken: A }], build, new Map(), "notifyCoach")
  assert.equal(rows[0].status, "failed")
  assert.equal(rows[0].error, "Not sent")
  assert.equal(rows[0].userName, null)
}

// long text is cut to the column sizes; rows without an id and a throwing build don't break it
{
  const long = "x".repeat(900)
  const rows = pushLogRows(
    [{ $id: "u1", pushToken: A }, null, { username: "no id" }, { $id: "u2", pushToken: B }],
    (u: any) => { if (u.$id === "u2") throw new Error("boom"); return { title: long, body: long, data: { type: long } } },
    new Map([[A, { ok: true, error: null }], [B, { ok: true, error: null }]]),
    "x".repeat(99),
  )
  assert.equal(rows.length, 2)
  assert.equal(rows[0].title?.length, 120)
  assert.equal(rows[0].body?.length, 500)
  assert.equal(rows[0].type?.length, 40)
  assert.equal(rows[0].source?.length, 40)
  assert.equal(rows[1].title, null)
  assert.equal(rows[1].status, "sent")
}

// the app's shape
{
  const e = toPushLogEntry({ $id: "r1", $createdAt: "2026-11-03T01:00:00.000+00:00", userId: "u1", status: "no_token" })
  assert.deepEqual(e, {
    id: "r1", at: "2026-11-03T01:00:00.000+00:00", userId: "u1", userName: null, type: null,
    title: null, body: null, status: "no_token", error: null, source: null,
  })
}

console.log("pushLog tests passed")
