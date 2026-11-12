// Tests for functions/aiProtocol/src/classes.js and classRules.js (weekly
// classes on the server) against an in-memory database. Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/classes.test.ts

import assert from "node:assert/strict"
import { handleClassAction, runClassCron } from "@/functions/aiProtocol/src/classes.js"
import { addDays, classProblem, gymNow, proposeProblem, mondayOfYmd, sessionsLeft } from "@/functions/aiProtocol/src/classRules.js"

// ── Rules ────────────────────────────────────────────────────────────────────
assert.equal(mondayOfYmd("2026-10-25"), "2026-10-19") // Sunday → its Monday
assert.equal(mondayOfYmd("2026-10-26"), "2026-10-26")
// 2 classes a day, 3 on at most 2 days of the week
const two = [{ day: 0, start: 9.5 }, { day: 0, start: 15.5 }]
assert.equal(classProblem(two, [], 0, 12.5), null)
assert.equal(classProblem([...two, { day: 0, start: 6 }], [], 0, 12.5), "max")
const bigMonWed = [0, 2].flatMap((day) => [6, 9, 12].map((start) => ({ day, start })))
assert.equal(classProblem([...bigMonWed, { day: 3, start: 6 }, { day: 3, start: 9 }], [], 3, 12), "bigDays")
assert.equal(classProblem([...bigMonWed, { day: 3, start: 6 }], [], 3, 12), null)
// Athletes only propose on days with fewer than 2 classes
assert.equal(proposeProblem(two, [], 0, 12.5), "proposeMax")
assert.equal(proposeProblem([{ day: 0, start: 9.5 }], [], 0, 12.5), null)
assert.equal(classProblem([{ day: 0, start: 9.5 }], [], 0, 11), "overlap")
assert.equal(classProblem([], [{ day: 1, start: 12, end: 18 }], 1, 10), "blocked")
assert.equal(classProblem([], [], 1, 18), "late")
assert.equal(classProblem([], [], 1, 17.5), null)
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
// The cron's "already sent" marks (main.js: claimCronKey)
const claimed = new Set<string>()

const ctx = {
  db: {
    get: async (table: string, id: string) => (t(table).get(id) ? { ...t(table).get(id)! } : null),
    list: async (table: string, queries: any[]) => [...t(table).values()].filter((r) => queries.every((q) => matches(r, q))).map((r) => ({ ...r })),
    create: async (table: string, data: any, id?: string) => {
      const row = { ...data, $id: id ?? `r${++seq}`, $createdAt: new Date(Date.now() + seq).toISOString() }
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
  claim: async (key: string) => (claimed.has(key) ? false : (claimed.add(key), true)),
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
  weekStart: week, classes: [{ day: 0, start: 7 }, { day: 0, start: 10 }, { day: 0, start: 13 }, { day: 0, start: 16 }],
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
// Moving Thu → Wed is fine (Mon, Wed), and happens right away
r = await call("classRequest", "ana", { kind: "move", classId: at(3, 9.5).$id, toClassId: at(2, 9.5).$id })
assert.equal(r.status, 200)
const moveId = r.json.request.$id
assert.equal(r.json.request.status, "accepted")
assert.ok(pushes.some((p) => p.to === "coach" && p.title === "Moved a class" && p.body.includes("Thu 9:30 → Wed 9:30")))
// Nothing left for the coach to answer
assert.equal((await call("classAnswer", "coach", { requestId: moveId, accept: true })).status, 409)
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
// Requests about Wednesday: a pending move into it, a pending extra and a skip
const wedId = at(2, 9.5).$id
const intoWed = await ctx.db.create("class_requests", {
  athleteId: "bea", weekStart: week, kind: "move", status: "pending", fromClassId: at(1, 12).$id, toClassId: wedId,
})
const extraWed = await ctx.db.create("class_requests", { athleteId: "cami", weekStart: week, kind: "extra", status: "pending", toClassId: wedId })
const skipWed = await ctx.db.create("class_requests", { athleteId: "ana", weekStart: week, kind: "skip", status: "accepted", fromClassId: wedId })
const keep = [...t("classes").values()].filter((c) => !(c.day === 2)).map((c) => ({ id: c.$id, day: c.day, start: c.start }))
assert.equal((await call("classPublish", "coach", { weekStart: week, classes: keep })).status, 200)
assert.ok(pushes.some((p) => p.to === "ana" && p.body.includes("Wed 9:30 was cancelled")))
assert.ok(!pushes.some((p) => p.title.includes("Next week")))
// …are dropped, so cami can ask for another extra and the skip costs nothing
for (const id of [intoWed.$id, extraWed.$id, skipWed.$id]) assert.ok(!t("class_requests").has(id))
assert.ok(pushes.some((p) => p.to === "cami" && p.body.includes("request was dropped")))
assert.deepEqual(at(1, 12).roster, ["bea"])

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
// Not before 20:00 the night before Thursday's class…
pushes.length = 0
report = await runClassCron(ctx, new Date(Date.UTC(y, m - 1, d + 2, 19, 55)))
assert.equal(report.tomorrow, 0)
// …and a run that comes late (no run at 20:00) still sends it
report = await runClassCron(ctx, new Date(Date.UTC(y, m - 1, d + 2, 23, 38)))
assert.equal(report.tomorrow, thu.roster.length)
// A second run that night (overlapping or late) sends nothing again
pushes.length = 0
report = await runClassCron(ctx, new Date(Date.UTC(y, m - 1, d + 2, 23, 50)))
assert.equal(report.tomorrow, 0)
assert.ok(!pushes.some((p) => p.title.startsWith("Class tomorrow")))
// Package running low after a class ends: 3 sessions, Monday done → 2 left
await ctx.db.create("packages", { athleteId: "ana", total: 3, startsOn: week, useBy: addDays(week, 30) })
pushes.length = 0
report = await runClassCron(ctx, new Date(Date.UTC(y, m - 1, d, 12, 30)))
assert.equal(report.low, 1)
assert.ok(pushes.some((p) => p.to === "coach" && p.body === "ana has 2 sessions left."))
// Run again later that day: already sent
pushes.length = 0
report = await runClassCron(ctx, new Date(Date.UTC(y, m - 1, d, 18, 0)))
assert.equal(report.low, 0)
assert.equal(pushes.length, 0)
// A run hours late still counts as of the class's end: ana's Thursday class
// leaves 1, not a "low" level, so nothing even though it's 6 h later
report = await runClassCron(ctx, new Date(Date.UTC(y, m - 1, d + 3, 18, 0)))
assert.equal(report.low, 0)

// ── Package used up or expired: locked until the coach renews ───────────────
// dani's 1-session package was used on Monday; she can't ask for anything
// and isn't put back in her usual class.
t("users").set("dani", { $id: "dani", role: "athlete", username: "dani", defaultClasses: ["3@9.5"] })
await ctx.db.create("packages", { athleteId: "dani", total: 1, startsOn: week, useBy: addDays(week, 30) })
at(0, 9.5).roster = [...at(0, 9.5).roster.filter((u: string) => u !== "x3"), "dani"]
const [ly, lm, ld] = week.split("-").map(Number)
const realNow = Date.now
Date.now = () => Date.UTC(ly, lm - 1, ld, 13)   // Monday 13:00, the class is over
const RealDate = Date
globalThis.Date = class extends RealDate {
  constructor(...a: any[]) { super(...(a.length ? a : [RealDate.now()]) as []) }
  static now() { return Date.UTC(ly, lm - 1, ld, 13) }
} as any
r = await call("classRequest", "dani", { kind: "extra", toClassId: at(3, 9.5).$id })
assert.equal(r.status, 409)
assert.ok(r.json.error.includes("renew"))
// The coach renews: she's back in her usual Thursday class
pushes.length = 0
assert.equal((await call("classPackage", "coach", { athleteId: "dani", total: 8, startsOn: week, useBy: addDays(week, 30) })).status, 200)
assert.ok(at(3, 9.5).roster.includes("dani"))
// 0 sessions: out of the classes still ahead and locked again
pushes.length = 0
assert.equal((await call("classPackage", "coach", { athleteId: "dani", total: 0, startsOn: week, useBy: addDays(week, 30) })).status, 200)
assert.ok(!at(3, 9.5).roster.includes("dani"))
assert.equal((await call("classRequest", "dani", { kind: "extra", toClassId: at(3, 9.5).$id })).status, 409)
assert.ok(!pushes.some((p) => p.to === "dani"))
// She had said she'd skip Thursday: a renewal doesn't put her back in it
const daniSkip = await ctx.db.create("class_requests", {
  athleteId: "dani", weekStart: week, kind: "skip", status: "accepted", fromClassId: at(3, 9.5).$id,
})
assert.equal((await call("classPackage", "coach", { athleteId: "dani", total: 8, startsOn: week, useBy: addDays(week, 30) })).status, 200)
assert.ok(!at(3, 9.5).roster.includes("dani"))
// Nor do new usual classes
assert.equal((await call("classDefaults", "dani", { slots: ["3@9.5"] })).status, 200)
assert.ok(!at(3, 9.5).roster.includes("dani"))
t("class_requests").delete(daniSkip.$id)
assert.equal((await call("classPackage", "coach", { athleteId: "dani", total: -1, startsOn: week, useBy: addDays(week, 30) })).status, 400)
globalThis.Date = RealDate
Date.now = realNow
at(3, 9.5).roster = at(3, 9.5).roster.filter((u: string) => u !== "dani")
at(0, 9.5).roster = at(0, 9.5).roster.filter((u: string) => u !== "dani")

// ── Plan pauses ──────────────────────────────────────────────────────────────
// ana's plan started this coming Monday; the coach pauses its second week.
const week2 = addDays(week, 7)
const plan = await ctx.db.create("training_plans", { athleteId: "ana", status: "active", windowStart: week, windowEnd: addDays(week, 41) })
const pkg = [...t("packages").values()].find((p) => p.athleteId === "ana")!
const useBy = pkg.useBy
const pause = { start: week2, end: addDays(week2, 6), reason: "Holidays" }
assert.equal((await call("classPause", "ana", { planId: plan.$id, pauses: [pause] })).status, 403)
assert.equal((await call("classPause", "coach", { planId: plan.$id, pauses: [{ start: week2, end: addDays(week2, 29) }] })).status, 409)
// Homework: due inside the pause (day picked in it), due before it, already overdue
const [py, pm, pd] = week2.split("-").map(Number)
const hwIn = await ctx.db.create("protocol", {
  athleteId: "ana", planPart: "homework", dueBy: addDays(week2, 2), scheduledFor: new Date(Date.UTC(py, pm - 1, pd + 1, 15)).toISOString(),
})
const hwBefore = await ctx.db.create("protocol", { athleteId: "ana", planPart: "homework", dueBy: addDays(week2, -1), scheduledFor: null })
const hwOld = await ctx.db.create("protocol", { athleteId: "ana", planPart: "homework", dueBy: "2020-01-01", scheduledFor: null })
pushes.length = 0
const paused = await call("classPause", "coach", { planId: plan.$id, pauses: [pause] })
assert.equal(paused.status, 200)
assert.equal(paused.json.homeworkMoved, 1)
assert.equal(t("protocol").get(hwIn.$id)!.dueBy, addDays(week2, 9))
assert.equal(t("protocol").get(hwIn.$id)!.scheduledFor, null)
assert.equal(t("protocol").get(hwBefore.$id)!.dueBy, addDays(week2, -1))
assert.equal(t("protocol").get(hwOld.$id)!.dueBy, "2020-01-01")
assert.equal(t("training_plans").get(plan.$id)!.windowEnd, addDays(week, 48))
assert.equal(t("packages").get(pkg.$id)!.useBy, addDays(useBy, 7))
assert.ok(pushes.some((p) => p.to === "ana" && p.title === "Training paused" && p.body.includes("(Holidays)") && p.body.includes("homework")))
// Publishing the paused week leaves her out of her usual classes
assert.equal((await call("classPublish", "coach", { weekStart: week2, classes: [{ day: 0, start: 9.5 }, { day: 3, start: 9.5 }] })).status, 200)
const mon2 = [...t("classes").values()].find((c) => c.weekStart === week2 && c.day === 0)!
assert.deepEqual(mon2.roster, ["bea"])
assert.equal((await call("classRequest", "ana", { kind: "extra", toClassId: mon2.$id })).status, 409)
// …and "I can go after all" on a skip from before the pause doesn't sneak her back in
const oldSkip = await ctx.db.create("class_requests", { athleteId: "ana", weekStart: week2, kind: "skip", status: "accepted", fromClassId: mon2.$id })
assert.equal((await call("classCancel", "ana", { requestId: oldSkip.$id })).status, 409)
assert.deepEqual(mon2.roster, ["bea"])
t("class_requests").delete(oldSkip.$id)
// The night the pause ends
const [y2, m2, d2] = week2.split("-").map(Number)
report = await runClassCron(ctx, new Date(Date.UTC(y2, m2 - 1, d2 + 6, 20, 5)))
assert.equal(report.resumed, 1)
// Taking the pause off gives the days back
pushes.length = 0
assert.equal((await call("classPause", "coach", { planId: plan.$id, pauses: [] })).status, 200)
assert.equal(t("training_plans").get(plan.$id)!.windowEnd, addDays(week, 41))
assert.equal(t("packages").get(pkg.$id)!.useBy, useBy)
assert.ok(pushes.some((p) => p.to === "ana" && p.title === "Pause changed"))

// ── Publishing this week mid-week (the coach missed Sunday) ─────────────────
{
  const RealDate = Date
  const thisWeek = addDays(week, 21)
  const [y3, m3, d3] = thisWeek.split("-").map(Number)
  const fake = RealDate.UTC(y3, m3 - 1, d3 + 2, 12) // Wednesday 12:00
  globalThis.Date = class extends RealDate {
    constructor(...a: any[]) { super(...((a.length ? a : [fake]) as [])) }
    static now() { return fake }
  } as DateConstructor
  try {
    t("users").get("cami")!.defaultClasses = ["0@9.5", "3@9.5"]
    pushes.length = 0
    // Monday is gone: refused, nothing written
    const late = await call("classPublish", "coach", { weekStart: thisWeek, classes: [{ day: 0, start: 9.5 }, { day: 3, start: 9.5 }] })
    assert.equal(late.status, 409)
    assert.ok(![...t("classes").values()].some((c) => c.weekStart === thisWeek))
    // The rest of the week publishes, fills usual classes ahead and says "this week"
    assert.equal((await call("classPublish", "coach", { weekStart: thisWeek, classes: [{ day: 2, start: 15 }, { day: 3, start: 9.5 }] })).status, 200)
    const thu3 = [...t("classes").values()].find((c) => c.weekStart === thisWeek && c.day === 3)!
    assert.ok(thu3.roster.includes("cami"))
    assert.equal(t("class_weeks").get(thisWeek)!.published, true)
    assert.ok(pushes.some((p) => p.to === "cami" && p.title === "This week's classes are up"))
    // Published, the coach can still add a time; a class already started stays put
    const tue3 = await ctx.db.create("classes", { weekStart: thisWeek, day: 1, start: 9.5, roster: ["bea"] })
    const keep = [...t("classes").values()].filter((c) => c.weekStart === thisWeek && c.day >= 2).map((c) => ({ id: c.$id, day: c.day, start: c.start }))
    assert.equal((await call("classPublish", "coach", { weekStart: thisWeek, classes: [...keep, { day: 4, start: 9.5 }] })).status, 200)
    assert.equal([...t("classes").values()].filter((c) => c.weekStart === thisWeek).length, 4)
    assert.deepEqual(t("classes").get(tue3.$id)!.roster, ["bea"])
    const move = await call("classPublish", "coach", { weekStart: thisWeek, classes: [{ id: tue3.$id, day: 4, start: 15 }] })
    assert.equal(move.status, 409)
    // A week already over can't be published
    assert.equal((await call("classPublish", "coach", { weekStart: addDays(thisWeek, -7), classes: [] })).status, 409)
  } finally {
    globalThis.Date = RealDate
  }
}

// Monday 8:00 with this week unpublished: the coach hears they can still publish it
{
  const [y4, m4, d4] = addDays(week, 35).split("-").map(Number)
  pushes.length = 0
  const rep = await runClassCron(ctx, new Date(Date.UTC(y4, m4 - 1, d4, 8, 5)))
  assert.equal(rep.reminded, true)
  assert.ok(pushes.some((p) => p.to === "coach" && p.title === "This week isn't published"))
  // Once: the next run that morning stays quiet
  pushes.length = 0
  assert.equal((await runClassCron(ctx, new Date(Date.UTC(y4, m4 - 1, d4, 9, 40)))).reminded, false)
  assert.ok(!pushes.some((p) => p.title === "This week isn't published"))
}

// ── Join right away, and the coach's roster ─────────────────────────────────
{
  const wk = addDays(week, 35)
  for (const u of [{ $id: "fran", role: "athlete", username: "fran" }, { $id: "gus", role: "athlete", username: "gus" }, { $id: "off", role: "athlete", username: "off", active: false }]) {
    t("users").set(u.$id, { ...u })
  }
  // Not published yet: nobody joins
  const draft = await ctx.db.create("classes", { weekStart: wk, day: 0, start: 9.5, roster: [] })
  assert.equal((await call("classJoin", "fran", { classId: draft.$id })).status, 409)
  ctx.db.remove("classes", draft.$id)
  assert.equal((await call("classPublish", "coach", { weekStart: wk, classes: [{ day: 0, start: 9.5 }, { day: 1, start: 9.5 }, { day: 3, start: 9.5 }, { day: 5, start: 9.5 }] })).status, 200)
  const c = (day: number) => [...t("classes").values()].find((x) => x.weekStart === wk && x.day === day)!
  pushes.length = 0
  // Coaches don't join; athletes do, and the coach hears about it
  assert.equal((await call("classJoin", "coach", { classId: c(0).$id })).status, 403)
  assert.equal((await call("classJoin", "fran", { classId: c(0).$id })).status, 200)
  assert.ok(c(0).roster.includes("fran"))
  assert.ok(pushes.some((p) => p.to === "coach" && p.body === "fran joined Mon 9:30."))
  assert.equal((await call("classJoin", "fran", { classId: c(0).$id })).status, 409) // already in
  assert.equal((await call("classJoin", "fran", { classId: c(1).$id })).status, 409) // Tue is next to Mon
  assert.equal((await call("classJoin", "fran", { classId: c(3).$id })).status, 200)
  // One session left and it's booked
  await ctx.db.create("packages", { athleteId: "gus", total: 1, startsOn: addDays(mondayOfYmd(new Date().toISOString().slice(0, 10)), 0), useBy: addDays(wk, 30) })
  { const j = await call("classJoin", "gus", { classId: c(1).$id }); assert.equal(j.status, 200, j.json.error) }
  const noSession = await call("classJoin", "gus", { classId: c(5).$id })
  assert.equal(noSession.status, 409)
  assert.match(noSession.json.error, /1 session left/, noSession.json.error)

  // The coach adds and removes; athletes can't
  assert.equal((await call("classRoster", "fran", { classId: c(1).$id, athleteId: "gus", add: true })).status, 403)
  pushes.length = 0
  assert.equal((await call("classRoster", "coach", { classId: c(1).$id, athleteId: "fran", add: true })).status, 200) // rest day is the coach's call
  assert.ok(c(1).roster.includes("fran"))
  assert.ok(pushes.some((p) => p.to === "fran" && p.title === "You're in a class"))
  assert.equal((await call("classRoster", "coach", { classId: c(1).$id, athleteId: "fran", add: true })).status, 409)
  assert.equal((await call("classRoster", "coach", { classId: c(1).$id, athleteId: "off", add: true })).status, 409)
  assert.equal((await call("classRoster", "coach", { classId: c(1).$id, athleteId: "coach", add: true })).status, 404)
  // A pending move out of a class goes when the coach takes them out
  const mv = await ctx.db.create("class_requests", { athleteId: "fran", weekStart: wk, kind: "move", status: "pending", fromClassId: c(1).$id, toClassId: c(3).$id })
  assert.equal((await call("classRoster", "coach", { classId: c(1).$id, athleteId: "fran", add: false })).status, 200)
  assert.ok(!c(1).roster.includes("fran"))
  assert.ok(!t("class_requests").has(mv.$id))
  assert.ok(pushes.some((p) => p.to === "fran" && p.title === "Class changed"))
  // Full
  c(1).roster = ["x1", "x2", "x3", "x4"]
  assert.equal((await call("classRoster", "coach", { classId: c(1).$id, athleteId: "gus", add: true })).status, 409)
  assert.equal((await call("classJoin", "fran", { classId: c(1).$id })).status, 409)
  // No usual classes is fine (stop repeating the last one)
  assert.equal((await call("classDefaults", "fran", { slots: [] })).status, 200)
  assert.deepEqual(t("users").get("fran")!.defaultClasses, [])
}

// ── Recurring series (pre-fill for new weeks) ────────────────────────────────
{
  assert.equal((await call("classSeries", "ana", { series: [] })).status, 403)
  assert.equal((await call("classSeries", "coach", { series: [{ day: 0, start: 19 }] })).status, 400) // ends after 20:00
  const r = await call("classSeries", "coach", { series: [{ day: 0, start: 7 }, { day: 2, start: 7 }, { day: 0, start: 7 }] })
  assert.equal(r.status, 200)
  assert.deepEqual(JSON.parse(t("class_weeks").get("series")!.blocks), [{ day: 0, start: 7 }, { day: 2, start: 7 }])
  assert.equal((await call("classSeries", "coach", { series: [{ day: 1, start: 6.5 }] })).status, 200)
  assert.deepEqual(JSON.parse(t("class_weeks").get("series")!.blocks), [{ day: 1, start: 6.5 }])
}

// ── Less than 12 h before: cancel and move are requests ─────────────────────
{
  const at6 = new Date(Date.now() + 6 * 3600000)
  const ymdOf = (d: Date) => d.toISOString().slice(0, 10)
  const wk = mondayOfYmd(ymdOf(at6))
  const day = (at6.getUTCDay() + 6) % 7
  const start = at6.getUTCHours() + (at6.getUTCMinutes() >= 30 ? 0.5 : 0)
  t("users").set("hugo", { $id: "hugo", role: "athlete", username: "hugo" })
  if (!t("class_weeks").has(wk)) await ctx.db.create("class_weeks", { published: true, blocks: "[]" }, wk)
  else t("class_weeks").get(wk)!.published = true
  const soon = await ctx.db.create("classes", { weekStart: wk, day, start, roster: ["hugo"] })
  pushes.length = 0
  const r = await call("classRequest", "hugo", { kind: "skip", classId: soon.$id })
  assert.equal(r.status, 200)
  assert.equal(r.json.request.status, "pending")
  assert.deepEqual(t("classes").get(soon.$id)!.roster, ["hugo"]) // still in until the coach says
  assert.ok(pushes.some((p) => p.to === "coach" && p.body.includes("less than 12 h")))
  assert.equal((await call("classAnswer", "coach", { requestId: r.json.request.$id, accept: true })).status, 200)
  assert.deepEqual(t("classes").get(soon.$id)!.roster, [])
  assert.ok(pushes.some((p) => p.to === "hugo" && p.title === "Cancel accepted"))
}

console.log("classes: all tests passed")
