import {
  CAPACITY, CLASS_HOURS, LOW_SESSIONS, MAX_CARRY, PROBLEM_TEXT, addDays, classLabel, classMs, classProblem,
  currentPackage, gymNow, mondayOfYmd, packageLocked, parseSlot, proposeProblem, restDayOk, sessionsLeft, slotKey,
} from "./classRules.js"
import { parsePauses, pauseLength, pauseOn, pausedDayCount, pausesProblem, planEndWith } from "./planPauses.js"

// Weekly classes (Plan › This week for athletes, the Classes tab for
// coaches). Everyone reads the tables; every write goes through here so the
// rules hold: 4 per class, 2 classes a day (3 on up to 2 days, set by the
// coach; athletes only propose on days with fewer than 2), a rest day
// between an athlete's classes, nothing over the coach's blocked times,
// nothing for an athlete whose package is used up or expired. `ctx` carries the
// Appwrite helpers from main.js: { db, q, getUserRow, listCoachRows,
// listUsers, push, log, error, tz }.

const CLASSES = "classes"
const WEEKS = "class_weeks"
const REQUESTS = "class_requests"
const PACKAGES = "packages"
const USERS = "users"
const PLANS = "training_plans"
const PROTOCOLS = "protocol"

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const KINDS = ["move", "propose", "extra", "skip"]

const ok = (json) => ({ status: 200, json: { ok: true, ...json } })
const fail = (status, error) => ({ status, json: { error } })

const parseBlocks = (raw) => {
  try { const b = JSON.parse(raw || "[]"); return Array.isArray(b) ? b : [] } catch { return [] }
}

async function weekClasses(ctx, weekStart) {
  return ctx.db.list(CLASSES, [ctx.q.equal("weekStart", weekStart)])
}

async function weekRow(ctx, weekStart) {
  return ctx.db.get(WEEKS, weekStart)
}

const name = (u) => u?.username || "An athlete"

// "Nov 2" for a "YYYY-MM-DD".
const dayLabel = (ymd) => {
  const [y, m, d] = ymd.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

const classDate = (c) => addDays(c.weekStart, c.day)

// athleteId → the pauses in their active plan (utils/planPauses.ts): no
// classes for them on those days.
async function pausesByAthlete(ctx) {
  const plans = await ctx.db.list(PLANS, [ctx.q.equal("status", "active")])
  const map = new Map()
  for (const p of plans) {
    const pauses = parsePauses(p.pauses)
    if (pauses.length) map.set(p.athleteId, pauses)
  }
  return map
}

// Classes the athlete is in this week, leaving out `except`.
const busyDays = (classes, athleteId, except) =>
  classes.filter((c) => c.$id !== except && (c.roster ?? []).includes(athleteId)).map((c) => c.day)

async function pushCoaches(ctx, callerId, title, body, data) {
  const coaches = (await ctx.listCoachRows()).filter((c) => c.$id !== callerId)
  await ctx.push(coaches, () => ({ sound: "default", title, body, data }))
}

async function pushUser(ctx, userId, title, body, data) {
  const u = await ctx.getUserRow(userId)
  if (u) await ctx.push([u], () => ({ sound: "default", title, body, data }))
}

async function setRoster(ctx, cls, roster) {
  return ctx.db.update(CLASSES, cls.$id, { roster })
}

// ── Athlete: a change to one of this week's classes ─────────────────────────
// body: { kind: "move" | "propose" | "extra" | "skip", classId?, toClassId?, day?, start? }
async function request(ctx, userId, body) {
  const now = gymNow(new Date(), ctx.tz)
  if (!KINDS.includes(body.kind)) return fail(400, "Bad request.")
  if (body.kind !== "skip" && (await athletePackage(ctx, userId, now)).locked) {
    return fail(409, "Your package is used up or expired. Ask your coach to renew it.")
  }
  const from = body.kind === "extra" ? null : await ctx.db.get(CLASSES, String(body.classId ?? ""))
  const to = ["move", "extra"].includes(body.kind) ? await ctx.db.get(CLASSES, String(body.toClassId ?? "")) : null
  if (body.kind !== "extra" && !from) return fail(404, "No such class.")
  if (["move", "extra"].includes(body.kind) && !to) return fail(404, "No such class.")
  const weekStart = (from ?? to).weekStart
  if (to && to.weekStart !== weekStart) return fail(400, "Pick a class in the same week.")
  if (!(await weekRow(ctx, weekStart))?.published) return fail(409, "This week isn't published yet.")
  if (from && !(from.roster ?? []).includes(userId)) return fail(403, "That's not one of your classes.")
  if (from && classMs(from) <= now.ms) return fail(409, "That class already started.")
  if (to && classMs(to) <= now.ms) return fail(409, "That class already started.")

  const mine = (await ctx.db.list(REQUESTS, [ctx.q.equal("athleteId", userId), ctx.q.equal("weekStart", weekStart)]))
  const live = mine.filter((r) => r.status === "pending" || (r.status === "accepted" && r.kind === "skip"))
  if (from && live.some((r) => r.fromClassId === from.$id)) return fail(409, "You already changed that class.")
  if (body.kind === "extra" && mine.some((r) => r.kind === "extra" && ["pending", "accepted"].includes(r.status))) {
    return fail(409, "You already asked for an extra class this week.")
  }

  const classes = await weekClasses(ctx, weekStart)
  const busy = busyDays(classes, userId, from?.$id)
  // Days of pending moves and proposals count as taken too.
  for (const r of mine.filter((x) => x.status === "pending" && x.fromClassId !== from?.$id)) {
    const day = r.kind === "propose" ? r.day : classes.find((c) => c.$id === r.toClassId)?.day
    if (Number.isInteger(day)) busy.push(day)
  }
  const caller = await ctx.getUserRow(userId)
  const data = { athleteId: userId, weekStart, kind: body.kind, status: "pending", fromClassId: from?.$id ?? null }
  const toDate = to ? classDate(to) : body.kind === "propose" ? addDays(weekStart, Number(body.day)) : null
  if (toDate && pauseOn((await pausesByAthlete(ctx)).get(userId), toDate)) return fail(409, "Your plan is paused that day.")

  if (body.kind === "skip") {
    await setRoster(ctx, from, from.roster.filter((u) => u !== userId))
    const row = await ctx.db.create(REQUESTS, { ...data, status: "accepted" })
    if (!row) return fail(502, "Could not save.")
    await pushCoaches(ctx, userId, "A spot opened up", `${name(caller)} won't make ${classLabel(from)}.`,
      { type: "class_request", requestId: row.$id })
    return ok({ request: row })
  }

  let what
  if (body.kind === "propose") {
    const day = Number(body.day)
    const start = Number(body.start)
    const blocks = parseBlocks((await weekRow(ctx, weekStart))?.blocks)
    const problem = proposeProblem(classes, blocks, day, start)
    if (problem) return fail(409, PROBLEM_TEXT[problem])
    if (classMs({ weekStart, day, start }) <= now.ms) return fail(409, "That time already passed.")
    if (!restDayOk(busy, day)) return fail(409, "Leave a rest day between classes.")
    Object.assign(data, { day, start })
    what = `${classLabel(from)} → new time: ${classLabel({ day, start })}`
  } else {
    if ((to.roster ?? []).includes(userId)) return fail(409, "You're already in that class.")
    if ((to.roster ?? []).length >= CAPACITY) return fail(409, "That class is full.")
    if (!restDayOk(busy, to.day)) return fail(409, "Leave a rest day between classes.")
    data.toClassId = to.$id
    what = body.kind === "extra" ? `Extra class: ${classLabel(to)}` : `${classLabel(from)} → ${classLabel(to)}`
  }
  const row = await ctx.db.create(REQUESTS, data)
  if (!row) return fail(502, "Could not save.")
  await pushCoaches(ctx, userId, "Class request", `${name(caller)}: ${what}`, { type: "class_request", requestId: row.$id })
  return ok({ request: row })
}

// ── Athlete: take back a pending request, or "I can go after all" ────────────
async function cancel(ctx, userId, body) {
  const r = await ctx.db.get(REQUESTS, String(body.requestId ?? ""))
  if (!r || r.athleteId !== userId) return fail(404, "No such request.")
  if (r.kind === "skip" && r.status === "accepted") {
    const cls = await ctx.db.get(CLASSES, r.fromClassId)
    if (!cls || classMs(cls) <= gymNow(new Date(), ctx.tz).ms) return fail(409, "That class already started.")
    if ((cls.roster ?? []).length >= CAPACITY) return fail(409, "Someone took your spot. The class is full.")
    await setRoster(ctx, cls, [...new Set([...(cls.roster ?? []), userId])])
  } else if (r.status !== "pending") {
    return fail(409, "Your coach already answered.")
  }
  await ctx.db.remove(REQUESTS, r.$id)
  return ok({})
}

// ── Coach: accept or decline a request ───────────────────────────────────────
async function answer(ctx, userId, body) {
  const r = await ctx.db.get(REQUESTS, String(body.requestId ?? ""))
  if (!r) return fail(404, "No such request.")
  if (r.status !== "pending") return fail(409, "Already answered.")
  const from = r.fromClassId ? await ctx.db.get(CLASSES, r.fromClassId) : null
  let to = r.toClassId ? await ctx.db.get(CLASSES, r.toClassId) : null
  const accept = body.accept === true
  const label = to ? classLabel(to) : r.kind === "propose" ? classLabel(r) : "your class"

  if (accept) {
    if (r.kind === "propose") {
      const classes = await weekClasses(ctx, r.weekStart)
      const existing = classes.find((c) => c.day === r.day && c.start === r.start)
      if (existing) to = existing
      else {
        const blocks = parseBlocks((await weekRow(ctx, r.weekStart))?.blocks)
        const problem = classProblem(classes, blocks, r.day, r.start)
        if (problem) return fail(409, PROBLEM_TEXT[problem])
        to = await ctx.db.create(CLASSES, { weekStart: r.weekStart, day: r.day, start: r.start, roster: [] })
        if (!to) return fail(502, "Could not save.")
      }
    }
    if (!to) return fail(404, "That class is gone.")
    const roster = to.roster ?? []
    if (!roster.includes(r.athleteId)) {
      if (roster.length >= CAPACITY) return fail(409, "That class is full.")
      await setRoster(ctx, to, [...roster, r.athleteId])
    }
    if (from && from.$id !== to.$id) await setRoster(ctx, from, (from.roster ?? []).filter((u) => u !== r.athleteId))
  }
  const updated = await ctx.db.update(REQUESTS, r.$id, { status: accept ? "accepted" : "rejected", ...(to ? { toClassId: to.$id } : {}) })
  if (!updated) return fail(502, "Could not save.")
  await pushUser(ctx, r.athleteId,
    accept ? "Change accepted" : "Change declined",
    accept ? `You're in ${label}.` : `Your coach declined ${label}.${from ? ` You keep ${classLabel(from)}.` : ""}`,
    { type: "class_answer", requestId: r.$id })
  return ok({ request: updated })
}

// Put athletes in the classes they usually take, where
// there's room, they aren't in any class that week yet, their plan isn't
// paused that day and their package isn't used up or expired. Returns the
// athletes added.
async function fillFromDefaults(ctx, classes, users, onlyUser, paused) {
  const added = new Set()
  const now = gymNow(new Date(), ctx.tz)
  for (const u of users) {
    if (onlyUser && u.$id !== onlyUser) continue
    const slots = (u.defaultClasses ?? []).map(parseSlot).filter(Boolean)
    if (!slots.length || classes.some((c) => (c.roster ?? []).includes(u.$id))) continue
    if ((await athletePackage(ctx, u.$id, now)).locked) continue
    for (const s of slots) {
      const c = classes.find((x) => x.day === s.day && x.start === s.start)
      if (!c || (c.roster ?? []).length >= CAPACITY) continue
      if (pauseOn(paused?.get(u.$id), classDate(c))) continue
      c.roster = [...(c.roster ?? []), u.$id]
      await setRoster(ctx, c, c.roster)
      added.add(u.$id)
    }
  }
  return added
}

// ── Coach: publish a week (the classes and blocked times drafted on the phone)
// body: { weekStart, classes: [{ id?, day, start }], blocks: [{ day, start, end, all? }] }
async function publish(ctx, userId, body) {
  const weekStart = String(body.weekStart ?? "")
  if (!DAY_RE.test(weekStart) || mondayOfYmd(weekStart) !== weekStart) return fail(400, "Bad week.")
  if (classMs({ weekStart, day: 6, start: 24 }) <= gymNow(new Date(), ctx.tz).ms) return fail(409, "That week is over.")
  const wanted = Array.isArray(body.classes) ? body.classes : []
  const blocks = (Array.isArray(body.blocks) ? body.blocks : [])
    .filter((b) => Number.isInteger(b?.day) && typeof b.start === "number" && typeof b.end === "number")
    .map((b) => ({ day: b.day, start: b.start, end: b.end, ...(b.all ? { all: true } : {}) }))
  // Check the whole week before writing anything.
  const placed = []
  for (const c of wanted) {
    const problem = classProblem(placed, blocks, Number(c?.day), Number(c?.start))
    if (problem) return fail(409, `${classLabel({ day: c.day, start: c.start })}: ${PROBLEM_TEXT[problem]}`)
    placed.push({ day: Number(c.day), start: Number(c.start) })
  }

  const existing = await weekClasses(ctx, weekStart)
  const week = await weekRow(ctx, weekStart)
  const firstTime = !week?.published
  const changedFor = new Map() // athleteId → what happened to their class
  const kept = []
  for (const c of wanted) {
    const old = existing.find((e) => e.$id === c.id)
    if (old) {
      if (old.day !== c.day || old.start !== c.start) {
        const moved = await ctx.db.update(CLASSES, old.$id, { day: c.day, start: c.start })
        for (const a of old.roster ?? []) changedFor.set(a, `${classLabel(old)} moved to ${classLabel(c)}.`)
        kept.push(moved ?? { ...old, day: c.day, start: c.start })
      } else kept.push(old)
    } else {
      const made = await ctx.db.create(CLASSES, { weekStart, day: c.day, start: c.start, roster: [] })
      if (!made) return fail(502, "Could not save.")
      kept.push(made)
    }
  }
  for (const old of existing.filter((e) => !kept.some((k) => k.$id === e.$id))) {
    await ctx.db.remove(CLASSES, old.$id)
    for (const a of old.roster ?? []) changedFor.set(a, `${classLabel(old)} was cancelled. Pick another class.`)
  }
  const weekData = { published: true, blocks: JSON.stringify(blocks) }
  const saved = week ? await ctx.db.update(WEEKS, weekStart, weekData) : await ctx.db.create(WEEKS, weekData, weekStart)
  if (!saved) return fail(502, "Could not save.")

  const users = await ctx.listUsers()
  if (firstTime) {
    const paused = await pausesByAthlete(ctx)
    await fillFromDefaults(ctx, kept, users, undefined, paused)
    // Athletes paused the whole week don't need to check it.
    const offAllWeek = (u) => [0, 1, 2, 3, 4, 5, 6].every((d) => pauseOn(paused.get(u.$id), addDays(weekStart, d)))
    const athletes = users.filter((u) => u.role !== "coach" && !offAllWeek(u))
    await ctx.push(athletes, () => ({
      sound: "default",
      title: "Next week's classes are up",
      body: "Check your classes and change any you can't make.",
      data: { type: "class_week", weekStart },
    }))
  } else {
    for (const [a, text] of changedFor) await pushUser(ctx, a, "Your class changed", text, { type: "class_week", weekStart })
  }
  return ok({ classes: kept })
}

// ── Athlete: their usual classes ("day@start"), used for every new week ──────
async function setDefaults(ctx, userId, body) {
  const slots = (Array.isArray(body.slots) ? body.slots : []).map(parseSlot).filter(Boolean)
  if (slots.length < 1 || slots.length > 3) return fail(400, "Pick 1 to 3 classes.")
  const days = []
  for (const s of slots) {
    if (!restDayOk(days, s.day)) return fail(409, "Leave a rest day between classes.")
    days.push(s.day)
  }
  const saved = await ctx.db.update(USERS, userId, { defaultClasses: slots.map((s) => slotKey(s.day, s.start)) })
  if (!saved) return fail(502, "Could not save.")
  // Join this week's (and a published next week's) classes still ahead.
  await joinUsualClasses(ctx, saved, await pausesByAthlete(ctx))
  return ok({})
}

// Into their usual classes still ahead this week and in a published next week.
async function joinUsualClasses(ctx, user, paused) {
  const now = gymNow(new Date(), ctx.tz)
  const thisWeek = mondayOfYmd(now.ymd)
  for (const weekStart of [thisWeek, addDays(thisWeek, 7)]) {
    if (!(await weekRow(ctx, weekStart))?.published) continue
    const ahead = (await weekClasses(ctx, weekStart)).filter((c) => classMs(c) > now.ms)
    await fillFromDefaults(ctx, ahead, [user], user.$id, paused)
  }
}

// ── Coach: pause an athlete's plan (holidays, an injury) ────────────────────
// body: { planId, pauses: [{ start, end, reason? }] } — the plan's whole list,
// so adding, removing and ending one early are the same call. The plan's end
// date and the package's use-by date move by the paused days; the athlete
// leaves their classes on paused days still ahead (and goes back into their
// usual ones for days no longer paused). Pending homework due during or
// after a new pause gets its deadline moved by the pause's length, and a day
// picked inside the pause is cleared. Taking a pause off doesn't pull
// homework deadlines back (the extra days stay).
async function setPauses(ctx, userId, body) {
  const plan = await ctx.db.get(PLANS, String(body.planId ?? ""))
  if (!plan || plan.status !== "active") return fail(404, "No such plan.")
  const pauses = parsePauses(body.pauses)
  if (!Array.isArray(body.pauses) || pauses.length !== body.pauses.length) return fail(400, "Bad pause.")
  const problem = pausesProblem(pauses, plan.windowStart)
  if (problem) return fail(409, problem)
  const before = parsePauses(plan.pauses)
  const windowEnd = planEndWith(plan.windowStart, pauses)
  const saved = await ctx.db.update(PLANS, plan.$id, { pauses: JSON.stringify(pauses), windowEnd })
  if (!saved) return fail(502, 'Could not save. Add the optional string column "pauses" to training_plans.')
  const athleteId = plan.athleteId
  const now = gymNow(new Date(), ctx.tz)

  const shift = pausedDayCount(pauses) - pausedDayCount(before)
  if (shift) {
    const pkg = (await ctx.db.list(PACKAGES, [ctx.q.equal("athleteId", athleteId)]))
      .filter((p) => p.useBy >= now.ymd)
      .sort((a, b) => (a.startsOn < b.startsOn ? 1 : -1))[0]
    if (pkg) await ctx.db.update(PACKAGES, pkg.$id, { useBy: addDays(pkg.useBy, shift) })
  }

  const thisWeek = mondayOfYmd(now.ymd)
  let removed = 0
  for (const c of await ctx.db.list(CLASSES, [ctx.q.contains("roster", athleteId), ctx.q.gte("weekStart", thisWeek)])) {
    if (classMs(c) <= now.ms || !pauseOn(pauses, classDate(c))) continue
    await setRoster(ctx, c, (c.roster ?? []).filter((u) => u !== athleteId))
    removed++
  }
  // Pending moves and extras into a paused day are dropped.
  const classes = new Map((await ctx.db.list(CLASSES, [ctx.q.gte("weekStart", thisWeek)])).map((c) => [c.$id, c]))
  for (const r of await ctx.db.list(REQUESTS, [ctx.q.equal("athleteId", athleteId), ctx.q.gte("weekStart", thisWeek)])) {
    if (r.status !== "pending") continue
    const to = classes.get(r.toClassId)
    const date = to ? classDate(to) : r.kind === "propose" ? addDays(r.weekStart, r.day) : null
    if (date && pauseOn(pauses, date)) await ctx.db.remove(REQUESTS, r.$id)
  }
  const athlete = await ctx.getUserRow(athleteId)
  if (athlete) await joinUsualClasses(ctx, athlete, new Map([[athleteId, pauses]]))

  const same = (a, b) => a.start === b.start && a.end === b.end
  const added = pauses.filter((p) => !before.some((b) => same(b, p)))

  let homeworkMoved = 0
  if (added.length) {
    const homework = await ctx.db.list(PROTOCOLS, [ctx.q.equal("athleteId", athleteId), ctx.q.equal("planPart", "homework")])
    for (const hw of homework) {
      if (!DAY_RE.test(hw.dueBy ?? "") || hw.dueBy < now.ymd) continue
      let dueBy = hw.dueBy
      let scheduledFor = hw.scheduledFor ?? null
      for (const p of added) {
        if (dueBy < p.start) continue
        dueBy = addDays(dueBy, pauseLength(p))
        if (scheduledFor && pauseOn([p], gymNow(new Date(scheduledFor), ctx.tz).ymd)) scheduledFor = null
      }
      if (dueBy === hw.dueBy) continue
      await ctx.db.update(PROTOCOLS, hw.$id, { dueBy, scheduledFor })
      homeworkMoved++
    }
  }

  const data = { type: "plan_pause", planId: plan.$id }
  for (const p of added) {
    await pushUser(ctx, athleteId, "Training paused",
      `Your coach paused your plan from ${dayLabel(p.start)} to ${dayLabel(p.end)}${p.reason ? ` (${p.reason})` : ""}. No classes on those days${homeworkMoved ? ", and your homework is due later" : ""}.`, data)
  }
  if (!added.length && before.some((b) => !pauses.some((p) => same(b, p)))) {
    await pushUser(ctx, athleteId, "Pause changed", `Your plan now ends ${dayLabel(windowEnd)}.`, data)
  }
  return ok({ plan: saved, removedFromClasses: removed, homeworkMoved })
}

// ── Coach: a new package for an athlete ──────────────────────────────────────
async function addPackage(ctx, userId, body) {
  const total = Number(body.total)
  if (typeof body.athleteId !== "string" || !Number.isInteger(total) || total < 1 || total > 100
    || !DAY_RE.test(body.startsOn ?? "") || !DAY_RE.test(body.useBy ?? "") || body.useBy < body.startsOn) {
    return fail(400, "Bad package.")
  }
  const row = await ctx.db.create(PACKAGES, { athleteId: body.athleteId, total, startsOn: body.startsOn, useBy: body.useBy })
  if (!row) return fail(502, "Could not save.")
  // A renewal unlocks the athlete: back into their usual classes still ahead.
  const athlete = await ctx.getUserRow(body.athleteId)
  if (athlete) await joinUsualClasses(ctx, athlete, await pausesByAthlete(ctx))
  await pushUser(ctx, body.athleteId, "Package ready", `${total} sessions, use them by ${body.useBy}.`, { type: "class_package" })
  return ok({ package: row })
}

// The athlete's package right now: sessions left (null without a package)
// and whether they're locked out. Classes count from when the package was
// added (a renewal right after a class doesn't pay for it twice).
async function athletePackage(ctx, athleteId, now) {
  const pkg = currentPackage(await ctx.db.list(PACKAGES, [ctx.q.equal("athleteId", athleteId)]), now.ymd)
  if (!pkg) return { left: null, locked: false }
  const from = mondayOfYmd(pkg.startsOn)
  const since = pkg.$createdAt ? gymNow(new Date(pkg.$createdAt), ctx.tz).ms : 0
  const classes = await ctx.db.list(CLASSES, [ctx.q.contains("roster", athleteId), ctx.q.gte("weekStart", from)])
  const done = classes.filter((c) => {
    const end = classMs(c, CLASS_HOURS)
    return addDays(c.weekStart, c.day) >= pkg.startsOn && end > since && end <= now.ms
  }).length
  const skips = (await ctx.db.list(REQUESTS, [ctx.q.equal("athleteId", athleteId), ctx.q.gte("weekStart", from)]))
    .filter((r) => r.kind === "skip" && r.status === "accepted" && (!pkg.$createdAt || (r.$createdAt ?? "") >= pkg.$createdAt)).length
  const left = sessionsLeft(pkg.total, done, skips)
  return { left, locked: packageLocked(pkg, left, now.ymd) }
}

export async function handleClassAction(action, userId, body, ctx) {
  const caller = await ctx.getUserRow(userId)
  if (!caller) return fail(403, "Unknown user.")
  const coach = caller.role === "coach"
  switch (action) {
    case "classRequest": return request(ctx, userId, body)
    case "classCancel": return cancel(ctx, userId, body)
    case "classDefaults": return setDefaults(ctx, userId, body)
    case "classAnswer": return coach ? answer(ctx, userId, body) : fail(403, "Coaches only.")
    case "classPublish": return coach ? publish(ctx, userId, body) : fail(403, "Coaches only.")
    case "classPackage": return coach ? addPackage(ctx, userId, body) : fail(403, "Coaches only.")
    case "classPause": return coach ? setPauses(ctx, userId, body) : fail(403, "Coaches only.")
    default: return null
  }
}

// ── Every hour (the function's schedule) ─────────────────────────────────────
// Requests nobody answered before the class are declined; the night before,
// athletes hear about tomorrow's class; on Saturday morning the coach is
// reminded to publish next week; the night a pause ends, the athlete hears
// their plan restarts; after a class, athletes with 2 or 0
// sessions left (and the coach) hear about it.
export async function runClassCron(ctx, date = new Date()) {
  const now = gymNow(date, ctx.tz)
  const thisWeek = mondayOfYmd(now.ymd)
  const nextWeek = addDays(thisWeek, 7)
  const classes = [...(await weekClasses(ctx, thisWeek)), ...(await weekClasses(ctx, nextWeek))]
  const byId = new Map(classes.map((c) => [c.$id, c]))
  const report = { expired: 0, tomorrow: 0, low: 0, reminded: false, resumed: 0 }

  const pending = [
    ...(await ctx.db.list(REQUESTS, [ctx.q.equal("weekStart", thisWeek), ctx.q.equal("status", "pending")])),
    ...(await ctx.db.list(REQUESTS, [ctx.q.equal("weekStart", nextWeek), ctx.q.equal("status", "pending")])),
  ]
  for (const r of pending) {
    const from = byId.get(r.fromClassId)
    const to = byId.get(r.toClassId) ?? (r.kind === "propose" ? { weekStart: r.weekStart, day: r.day, start: r.start } : null)
    const starts = [from, to].filter(Boolean).map((c) => classMs(c))
    if (!starts.length || Math.min(...starts) > now.ms) continue
    await ctx.db.update(REQUESTS, r.$id, { status: "expired" })
    report.expired++
    await pushUser(ctx, r.athleteId, "No answer from your coach",
      from ? `${classLabel(from)} stays as it was.` : "Your extra class wasn't confirmed.", { type: "class_answer", requestId: r.$id })
  }

  // 20:00 the night before.
  if (Math.floor(now.hour) === 20) {
    const tomorrow = addDays(now.ymd, 1)
    for (const c of classes.filter((x) => addDays(x.weekStart, x.day) === tomorrow)) {
      const users = (await Promise.all((c.roster ?? []).map((id) => ctx.getUserRow(id)))).filter(Boolean)
      report.tomorrow += await ctx.push(users, () => ({
        sound: "default",
        title: `Class tomorrow at ${classLabel(c).split(" ")[1]}`,
        body: "Get there a little early. Can't make it? Tell your coach now so someone else can take your spot.",
        data: { type: "class_tomorrow", classId: c.$id },
      }))
    }
    for (const [athleteId, pauses] of await pausesByAthlete(ctx)) {
      if (!pauses.some((p) => p.end === now.ymd)) continue
      report.resumed++
      await pushUser(ctx, athleteId, "Your plan restarts tomorrow", "Welcome back! Your next workout is waiting in Plan.", { type: "plan_pause" })
    }
  }

  // Saturday 10:00, next week still unpublished.
  if (now.weekday === 5 && Math.floor(now.hour) === 10 && !(await weekRow(ctx, nextWeek))?.published) {
    await pushCoaches(ctx, null, "Plan next week", "Publish next week's classes so athletes can check theirs.", { type: "class_plan" })
    report.reminded = true
  }

  // Classes that ended in the last hour.
  for (const c of classes) {
    const end = classMs(c, CLASS_HOURS)
    if (end > now.ms || end <= now.ms - 3600000) continue
    for (const a of c.roster ?? []) {
      const { left } = await athletePackage(ctx, a, now)
      if (left !== LOW_SESSIONS && left !== 0) continue
      report.low++
      const u = await ctx.getUserRow(a)
      await pushUser(ctx, a, left ? `${left} sessions left` : "No sessions left",
        left ? "Talk to your coach to renew your package." : "Your package is used up. Your coach can renew it.", { type: "class_package" })
      await pushCoaches(ctx, a, left ? "Package running low" : "Package used up",
        `${name(u)} has ${left} session${left === 1 ? "" : "s"} left.`, { type: "class_package", athleteId: a })
    }
  }
  return report
}

export { MAX_CARRY }
