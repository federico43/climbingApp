// Tests for functions/aiProtocol/src/classes.js and classRules.js (weekly
// classes on the server) against an in-memory database. Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/classes.test.ts

import assert from "node:assert/strict"
import { handleClassAction, runClassCron } from "@/functions/aiProtocol/src/classes.js"
import { addDays, classProblem, gymNow, mondayOfYmd, sessionsLeft } from "@/functions/aiProtocol/src/classRules.js"

// ── Rules ────────────────────────────────────────────────────────────────────
assert.equal(mondayOfYmd("2026-10-25"), "2026-10-19") // Sunday → its Monday
assert.equal(mondayOfYmd("2026-10-26"), "2026-10-26")
assert.equal(classProblem([{ day: 0, start: 9.5 }, { day: 0, start: 15.5 }], [], 0, 12.5), "max")
assert.equal(classProblem([{ day: 0, start: 9.5 }], [], 0, 11), "overlap")
assert.equal(classProblem([], [{ day: 1, start: 12, end: 18 }], 1, 10), "blocked")
assert.equal(classProblem([], [], 1, 16), "late")
assert.equal(classProblem([], [], 1, 9.25), "time")
assert.equal(classProblem([], [], 1, 9.5), null)
// Santiago in October is UTC−3: 23:30 UTC is 20:30 there, a Saturday.
const santiago = gymNow(new Date("2026-10-24T23:30:00Z"), "America/Santiago")
assert.equal(santiago.ymd, "2026-10-24")
assert.equal(santiago.hour, 20.5)
assert.equal(santiago.weekday, 5)
// 8 sessions, 3 done, 3 skipped → 1 skip lost past the 2 that move to a later week
assert.equal(sessionsLeft(8, 3, 3), 4)
assert.equal(sessionsLeft(8, 9, 0), 0)

// ── Fake Appwrite ────────────────────────────────────────────────────────────
type Row = Record<string, any> & { $id: string }
const tables: Record<string, Map<string, Row>> = {}
let seq = 0
const t = (name: string) => (tables[name] ??= new Map())
const matches = (row: Row, q: any) =>
  q.method === "equal" ? row[q.attribute] === q.values[0]
  : q.method === "contains" ? (row[q.attribute] ?? []).includes(q.values[0])
  : q.method === "greaterThanEqual" ? row[q.attribute] >= q.values[0]
  : true
const pushes: { to: string; title: string; body: string }[] = []

const ctx = {
  db: {
    get: async (table: string, id: string) => (t(table).get(id) ? { ...t(table).get(id)! } : null),
    list: async (table: string, queries: any[]) => [...t(table).values()].filter((r) => queries.every((q) => matches(r, q))).map((r) => ({ ...r })),
    create: async (table: string, data: any, id?: string) => {
      const row = { ...data, $id: id ?? `r${++seq}` }
      t(table).set(row.$id, row)
      return { ...row }
    },
    update: async (table: string, id: string, data: any) => {
      const row = t(table).get(id)
      if (!row) return null
      Object.assign(row, data)
      return { ...row }
    },
    remove: async (table: string, id: string) => t(table).delete(id),
  },
  q: {
    equal: (attribute: string, value: any) => ({ method: "equal", attribute, values: [value] }),
    contains: (attribute: string, value: any) => ({ method: "contains", attribute, values: [value] }),
    gte: (attribute: string, value: any) => ({ method: "greaterThanEqual", attribute, values: [value] }),
  },
  getUserRow: async (id: string) => (t("users").get(id) ? { ...t("users").get(id)! } : null),
  listCoachRows: async () => [...t("users").values()].filter((u) => u.role === "coach"),
  listUsers: async () => [...t("users").values()].map((u) => ({ ...u })),
  push: async (users: Row[], build: (u: Row) => any) => {
    for (const u of users) pushes.push({ to: u.$id, ...build(u) })
    return users.length
  },
  log: () => {}, error: () => {}, tz: "UTC",
}

const users = [
  { $id: "coach", role: "coach", username: "coach" },
  { $id: "ana", role: "athlete", username: "ana", defaultClasses: ["0@9.5", "3@9.5"] },
  { $id: "bea", role: "athlete", username: "bea", defaultClasses: ["0@9.5"] },
  { $id: "cami", role: "athlete", username: "cami" },
]
for (const u of users) t("users").set(u.$id, { ...u })

const call = async (action: string, who: string, body: any = {}) => (await handleClassAction(action, who, body, ctx))!

// Next week, so every class is still ahead.
const week = addDays(mondayOfYmd(new Date().toISOString().slice(0, 10)), 7)

// ── Publish ──────────────────────────────────────────────────────────────────
assert.equal((await call("classPublish", "ana", { weekStart: week, classes: [] })).status, 403)
const tooMany = await call("classPublish", "coach", {
  weekStart: week, classes: [{ day: 0, start: 7 }, { day: 0, start: 10 }, { day: 0, start: 13 }],
})
assert.equal(tooMany.status, 409)
assert.equal(t("classes").size, 0) // nothing written when the week doesn't check out

const pub = await call("classPublish", "coach", {
  weekStart: week,
  classes: [{ day: 0, start: 9.5 }, { day: 2, start: 9.5 }, { day: 3, start: 9.5 }, { day: 4, start: 15 }],
  blocks: [{ day: 5, start: 6, end: 18, all: true }],
})
assert.equal(pub.status, 200)
const at = (day: number, start: number) => [...t("classes").values()].find((c) => c.day === day && c.start === start)!
// Usual classes filled in on the first publish
assert.deepEqual(at(0, 9.5).roster, ["ana", "bea"])
assert.deepEqual(at(3, 9.5).roster, ["ana"])
assert.equal(t("class_weeks").get(week)!.published, true)
assert.ok(pushes.some((p) => p.to === "cami" && p.title.includes("Next week")))

// ── Requests ─────────────────────────────────────────────────────────────────
// Wed is next to Thu, where ana already has a class
let r = await call("classRequest", "ana", { kind: "move", classId: at(0, 9.5).$id, toClassId: at(2, 9.5).$id })
assert.equal(r.status, 409)
// Fri is next to Thu too
r = await call("classRequest", "ana", { kind: "move", classId: at(0, 9.5).$id, toClassId: at(4, 15).$id })
assert.equal(r.status, 409)
// Moving Thu → Wed is fine (Mon, Wed)
r = await call("classRequest", "ana", { kind: "move", classId: at(3, 9.5).$id, toClassId: at(2, 9.5).$id })
assert.equal(r.status, 200)
const moveId = r.json.request.$id
assert.ok(pushes.some((p) => p.to === "coach" && p.body.includes("Thu 9:30 → Wed 9:30")))
// Only coaches answer
assert.equal((await call("classAnswer", "ana", { requestId: moveId, accept: true })).status, 403)
assert.equal((await call("classAnswer", "coach", { requestId: moveId, accept: true })).status, 200)
assert.deepEqual(at(3, 9.5).roster, [])
assert.deepEqual(at(2, 9.5).roster, ["ana"])

// A new time on a blocked day is refused; Tuesday is fine once she leaves Monday
assert.equal((await call("classRequest", "bea", { kind: "propose", classId: at(0, 9.5).$id, day: 5, start: 9 })).status, 409)
r = await call("classRequest", "bea", { kind: "propose", classId: at(0, 9.5).$id, day: 1, start: 12 })
assert.equal(r.status, 200)
assert.equal((await call("classAnswer", "coach", { requestId: r.json.request.$id, accept: true })).status, 200)
assert.deepEqual(at(1, 12).roster, ["bea"])
assert.deepEqual(at(0, 9.5).roster, ["ana"])

// Skip frees the spot right away; "I can go after all" takes it back
r = await call("classRequest", "ana", { kind: "skip", classId: at(0, 9.5).$id })
assert.equal(r.status, 200)
assert.deepEqual(at(0, 9.5).roster, [])
assert.equal((await call("classCancel", "ana", { requestId: r.json.request.$id })).status, 200)
assert.deepEqual(at(0, 9.5).roster, ["ana"])

// An extra class, then a second one is refused
r = await call("classRequest", "cami", { kind: "extra", toClassId: at(4, 15).$id })
assert.equal(r.status, 200)
assert.equal((await call("classRequest", "cami", { kind: "extra", toClassId: at(0, 9.5).$id })).status, 409)
assert.equal((await call("classAnswer", "coach", { requestId: r.json.request.$id, accept: false })).status, 200)
assert.ok(pushes.some((p) => p.to === "cami" && p.title === "Change declined"))
// A full class takes no one else
at(0, 9.5).roster = ["ana", "x1", "x2", "x3"]
assert.equal((await call("classRequest", "cami", { kind: "extra", toClassId: at(0, 9.5).$id })).status, 409)

// ── Republish: a removed class tells its athletes ────────────────────────────
pushes.length = 0
const keep = [...t("classes").values()].filter((c) => !(c.day === 2)).map((c) => ({ id: c.$id, day: c.day, start: c.start }))
assert.equal((await call("classPublish", "coach", { weekStart: week, classes: keep })).status, 200)
assert.ok(pushes.some((p) => p.to === "ana" && p.body.includes("Wed 9:30 was cancelled")))
assert.ok(!pushes.some((p) => p.title.includes("Next week")))

// ── Cron ─────────────────────────────────────────────────────────────────────
// A pending request whose class has started expires
const thu = at(3, 9.5)
const exp = await ctx.db.create("class_requests", {
  athleteId: "bea", weekStart: week, kind: "move", status: "pending", fromClassId: at(1, 12).$id, toClassId: thu.$id,
})
const [y, m, d] = week.split("-").map(Number)
const tueNoon = new Date(Date.UTC(y, m - 1, d + 1, 12, 30))
let report = await runClassCron(ctx, tueNoon)
assert.equal(report.expired, 1)
assert.equal(t("class_requests").get(exp.$id)!.status, "expired")
// 20:00 the night before Thursday's class
pushes.length = 0
report = await runClassCron(ctx, new Date(Date.UTC(y, m - 1, d + 2, 20, 5)))
assert.equal(report.tomorrow, thu.roster.length)
// Package running low after a class ends: 3 sessions, Monday done → 2 left
await ctx.db.create("packages", { athleteId: "ana", total: 3, startsOn: week, useBy: addDays(week, 30) })
pushes.length = 0
report = await runClassCron(ctx, new Date(Date.UTC(y, m - 1, d, 12, 30)))
assert.equal(report.low, 1)
assert.ok(pushes.some((p) => p.to === "coach" && p.body === "ana has 2 sessions left."))

console.log("classes: all tests passed")
