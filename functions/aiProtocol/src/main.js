import Anthropic from "@anthropic-ai/sdk"
import { UNIFIED_PACK, PLAN_TOOL } from "./knowledgePack.js"
import { sendExpoPush } from "./expoPush.js"

// Model. Haiku is cheap and plenty for turning a sentence into a structured
// protocol. Bump to "claude-sonnet-4-6" or "claude-opus-4-8" for higher quality.
const MODEL = "claude-haiku-4-5"

// Appwrite injects these automatically at runtime; the fallbacks match this app.
const ENDPOINT = process.env.APPWRITE_FUNCTION_API_ENDPOINT || "https://nyc.cloud.appwrite.io/v1"
const PROJECT = process.env.APPWRITE_FUNCTION_PROJECT_ID || "689e515d000c2e1af428"
const DATABASE_ID = process.env.DATABASE_ID || "68bd9dd7003c15f7147e"
const USERS_TABLE = process.env.USERS_TABLE || "users"
const PROTOCOLS_TABLE = process.env.PROTOCOLS_TABLE || "protocol"
const TRAINING_PLANS_TABLE = process.env.TRAINING_PLANS_TABLE || "training_plans"
const EXERCISES_TABLE = process.env.EXERCISES_TABLE || "exercises"

async function appwriteFetch(path, log) {
  const apiKey = process.env.APPWRITE_API_KEY
  if (!apiKey) return null
  const headers = { "X-Appwrite-Project": PROJECT, "X-Appwrite-Key": apiKey }
  try {
    const r = await fetch(`${ENDPOINT}${path}`, { headers })
    if (!r.ok) return null
    return await r.json()
  } catch (e) {
    log?.(`Appwrite request failed: ${e?.message ?? e}`)
    return null
  }
}

// A write through the server API key (needs a key with write scope on the
// database). Same two REST shapes as reads. Returns the row, or null.
async function appwriteWrite(method, tablePath, docPath, data, log) {
  const apiKey = process.env.APPWRITE_API_KEY
  if (!apiKey) return null
  const headers = { "X-Appwrite-Project": PROJECT, "X-Appwrite-Key": apiKey, "Content-Type": "application/json" }
  for (const path of [tablePath, docPath]) {
    try {
      const r = await fetch(`${ENDPOINT}${path}`, { method, headers, body: JSON.stringify({ data }) })
      if (r.ok) return await r.json()
      log?.(`Appwrite ${method} ${path} → ${r.status} ${await r.text().catch(() => "")}`)
    } catch (e) {
      log?.(`Appwrite ${method} ${path} failed: ${e?.message ?? e}`)
    }
  }
  return null
}

async function getProtocolRow(id, log) {
  const rid = encodeURIComponent(id)
  return (
    (await appwriteFetch(`/tablesdb/${DATABASE_ID}/tables/${PROTOCOLS_TABLE}/rows/${rid}`, log)) ??
    (await appwriteFetch(`/databases/${DATABASE_ID}/collections/${PROTOCOLS_TABLE}/documents/${rid}`, log))
  )
}

async function updateProtocolRow(id, data, log) {
  const rid = encodeURIComponent(id)
  return appwriteWrite(
    "PATCH",
    `/tablesdb/${DATABASE_ID}/tables/${PROTOCOLS_TABLE}/rows/${rid}`,
    `/databases/${DATABASE_ID}/collections/${PROTOCOLS_TABLE}/documents/${rid}`,
    data, log,
  )
}

// Generic row helpers (both REST shapes, like the protocol ones above).
async function getRow(table, id, log) {
  const rid = encodeURIComponent(id)
  return (
    (await appwriteFetch(`/tablesdb/${DATABASE_ID}/tables/${table}/rows/${rid}`, log)) ??
    (await appwriteFetch(`/databases/${DATABASE_ID}/collections/${table}/documents/${rid}`, log))
  )
}

async function updateRow(table, id, data, log) {
  const rid = encodeURIComponent(id)
  return appwriteWrite(
    "PATCH",
    `/tablesdb/${DATABASE_ID}/tables/${table}/rows/${rid}`,
    `/databases/${DATABASE_ID}/collections/${table}/documents/${rid}`,
    data, log,
  )
}

async function listRowsEqual(table, attribute, value, log) {
  const query = encodeURIComponent(JSON.stringify({ method: "equal", attribute, values: [value] }))
  const limit = encodeURIComponent(JSON.stringify({ method: "limit", values: [200] }))
  const viaTables = await appwriteFetch(`/tablesdb/${DATABASE_ID}/tables/${table}/rows?queries[]=${query}&queries[]=${limit}`, log)
  if (viaTables) return viaTables.rows ?? []
  const viaDocs = await appwriteFetch(`/databases/${DATABASE_ID}/collections/${table}/documents?queries[]=${query}&queries[]=${limit}`, log)
  return viaDocs?.documents ?? []
}

// Best-effort Expo push to user rows: `build(user)` is the message minus
// `to`. Users without a token are skipped. Tokens Expo says are dead
// (DeviceNotRegistered, or malformed) are cleared from their rows so we stop
// pushing them; the app saves a fresh one on its next launch. Pass
// `receiptWaitMs` only from async executions (see expoPush.js). Returns how
// many were accepted by Expo.
async function pushToUsers(users, build, log, error, { receiptWaitMs = 0 } = {}) {
  const withToken = users.filter((u) => typeof u?.pushToken === "string" && u.pushToken)
  if (withToken.length === 0) return 0
  const { sent, invalidTokens } = await sendExpoPush(
    withToken.map((u) => ({ ...build(u), to: u.pushToken })),
    { log, error, receiptWaitMs },
  )
  for (const token of invalidTokens) {
    for (const u of withToken.filter((x) => x.pushToken === token)) {
      const cleared = await updateRow(USERS_TABLE, u.$id, { pushToken: null }, log)
      if (cleared) log(`Cleared dead push token for user ${u.$id}`)
      else error(`Could not clear dead push token for user ${u.$id}`)
    }
  }
  return sent
}

// Async executions (nobody waits on the response) look up delivery receipts
// after this long, to catch tokens Apple/Google reject.
const RECEIPT_WAIT_MS = 5000

// Users whose row holds `token`. Filters a full listing in memory rather
// than querying `pushToken`, which may not have an index — the roster is small.
async function listUsersWithToken(token, log) {
  const limit = encodeURIComponent(JSON.stringify({ method: "limit", values: [5000] }))
  const viaTables = await appwriteFetch(`/tablesdb/${DATABASE_ID}/tables/${USERS_TABLE}/rows?queries[]=${limit}`, log)
  const rows = viaTables?.rows
    ?? (await appwriteFetch(`/databases/${DATABASE_ID}/collections/${USERS_TABLE}/documents?queries[]=${limit}`, log))?.documents
    ?? []
  return rows.filter((u) => u?.pushToken === token)
}

const parseJson = (raw, fallback) => {
  if (raw && typeof raw === "object") return raw
  try { return JSON.parse(raw) } catch { return fallback }
}

// A block exercise swapped for library row `to` — mirrors swappedExercise in
// utils/scSwap.ts: the pick's identity, photo, notes, pattern, ladder and
// setting hints; the block's target kept when both are measured the same way,
// else the pick's own default.
function swapBlockExercise(ex, to) {
  const mob = (m) => m === "mobility"
  const sameMeasure = ex.type !== "7/3s" && to.type !== "7/3s"
    && (ex.unit || "reps") === (to.unit || "reps") && mob(ex.movementType) === mob(to.movementType)
  const out = {
    ...ex,
    type: to.type === "both_sides" ? "both_sides" : "reps",
    name: to.name, exerciseId: to.$id,
    photoUri: to.photoUri || undefined, notes: to.notes || undefined,
    movementType: to.movementType || undefined,
    loadMode: to.loadMode || "weight",
    levels: parseJson(to.levels, undefined) || undefined,
    loadStep: to.loadStep ?? undefined,
    settingHarder: to.settingHarder || undefined, settingEasier: to.settingEasier || undefined,
  }
  if (!sameMeasure) {
    out.unit = to.unit || "reps"
    out.reps = to.defaultReps || ex.reps
  }
  return out
}

const clip = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "")
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

// Reads a user's row through the server API key (so the client can't spoof a
// role or read another user's row). Tries both REST shapes: the newer
// TablesDB rows path and the classic Databases documents path, so this works
// regardless of Appwrite version.
async function getUserRow(userId, log) {
  if (!process.env.APPWRITE_API_KEY) {
    log?.("APPWRITE_API_KEY not set — cannot read user row")
    return null
  }
  const id = encodeURIComponent(userId)
  return (
    (await appwriteFetch(`/tablesdb/${DATABASE_ID}/tables/${USERS_TABLE}/rows/${id}`, log)) ??
    (await appwriteFetch(`/databases/${DATABASE_ID}/collections/${USERS_TABLE}/documents/${id}`, log))
  )
}

async function listCoachRows(log) {
  const query = encodeURIComponent(JSON.stringify({ method: "equal", attribute: "role", values: ["coach"] }))
  const viaTables = await appwriteFetch(`/tablesdb/${DATABASE_ID}/tables/${USERS_TABLE}/rows?queries[]=${query}`, log)
  if (viaTables) return viaTables.rows ?? []
  const viaDocs = await appwriteFetch(`/databases/${DATABASE_ID}/collections/${USERS_TABLE}/documents?queries[]=${query}`, log)
  return viaDocs?.documents ?? []
}

/**
 * Confirm the caller exists and has the coach role. Returns true/false; never
 * throws.
 */
async function isCoach(userId, log) {
  const row = await getUserRow(userId, log)
  if (!row) log?.(`Could not read user row for ${userId} on either REST path`)
  return row?.role === "coach"
}

export default async ({ req, res, log, error }) => {
  // ── Parse input ─────────────────────────────────────────────────────────────
  let body = {}
  try {
    body = req.bodyJson ?? (req.body ? JSON.parse(req.body) : {})
  } catch {
    return res.json({ error: "Invalid JSON body." }, 400)
  }
  // ── Auth: must be signed in ─────────────────────────────────────────────────
  const userId = req.headers["x-appwrite-user-id"]
  if (!userId) {
    return res.json({ error: "Not authenticated." }, 401)
  }

  // ── Action: notify the coach(es) that an athlete finished a workout ──────────
  // Doesn't need ANTHROPIC_API_KEY — keep it ahead of that check.
  if (body.action === "notifyCoach") {
    // Only an athlete finishing their own workout triggers a coach ping — a
    // coach logging their own session (or a caller we can't identify) is a
    // silent no-op, not an error, so the client doesn't need to know the difference.
    // A missing role counts as athlete: accounts made before sign-up set it
    // have none, and they're athletes unless a coach says otherwise.
    const caller = await getUserRow(userId, log)
    if (!caller || caller.role === "coach") {
      return res.json({ ok: true, notified: 0 }, 200)
    }

    const protocolName = typeof body.protocolName === "string" ? body.protocolName.trim().slice(0, 120) : ""
    const athleteName = caller.username || "An athlete"

    const coaches = (await listCoachRows(log)).filter((c) => c.$id !== userId)
    // Called with async: true, so there's time to check delivery receipts.
    const notified = await pushToUsers(coaches, () => ({
      sound: "default",
      title: "Workout completed",
      body: protocolName ? `${athleteName} finished "${protocolName}".` : `${athleteName} finished a workout.`,
      data: { type: "workout_completed", athleteId: userId },
    }), log, error, { receiptWaitMs: RECEIPT_WAIT_MS })
    return res.json({ ok: true, notified }, 200)
  }

  // ── Action: this device's token now belongs to the caller ───────────────────
  // The app calls this right after saving its token on the caller's row. Any
  // other account still holding the same token (someone else used this phone
  // and the sign-out cleanup didn't run, e.g. offline) loses it, so their
  // pushes stop reaching this device. The token is read from the caller's own
  // row, not the body, so nobody can strip someone else's token.
  if (body.action === "claimPushToken") {
    const caller = await getUserRow(userId, log)
    const token = caller?.pushToken
    if (typeof token !== "string" || !token) return res.json({ ok: true, cleared: 0 }, 200)
    const others = (await listUsersWithToken(token, log)).filter((u) => u.$id !== userId)
    let cleared = 0
    for (const u of others) {
      if (await updateRow(USERS_TABLE, u.$id, { pushToken: null }, log)) cleared++
      else error(`Could not clear shared push token for user ${u.$id}`)
    }
    if (cleared) log(`Moved push token to ${userId}, cleared it from ${cleared} other account(s)`)
    return res.json({ ok: true, cleared }, 200)
  }

  // ── Action: coach made homework (or moved its deadline) → push the athlete ───
  // body: { homeworkId, dueLabel, extended? }. Only a coach; the row must exist.
  if (body.action === "homeworkAssigned") {
    if (!(await isCoach(userId, log))) return res.json({ error: "Coaches only." }, 403)
    const hw = typeof body.homeworkId === "string" ? await getProtocolRow(body.homeworkId, log) : null
    if (!hw || hw.planPart !== "homework" || !hw.athleteId) return res.json({ error: "No such homework." }, 404)
    const athlete = await getUserRow(hw.athleteId, log)
    const due = DAY_RE.test(hw.dueBy ?? "") ? ` Pick a day before ${clip(body.dueLabel, 40) || hw.dueBy}.` : ""
    const extended = body.extended === true
    // Called with async: true, so there's time to check delivery receipts.
    const sent = await pushToUsers(athlete ? [athlete] : [], () => ({
      sound: "default",
      title: extended ? "More time for your homework" : "You've got homework",
      body: extended
        ? `${clip(hw.name, 80) || "Your homework"} is now due ${clip(body.dueLabel, 40) || hw.dueBy}. Pick a day.`
        : `${clip(hw.name, 80) || "New homework"} from your coach.${due}`,
      data: { type: "homework_assigned", homeworkId: hw.$id },
    }), log, error, { receiptWaitMs: RECEIPT_WAIT_MS })
    return res.json({ ok: true, notified: sent }, 200)
  }

  // ── Action: athlete schedules / can't attend their homework ──────────────────
  // body: { homeworkId, scheduledFor: ISO, day: "YYYY-MM-DD" (local), whenLabel }
  //    or { homeworkId, cantAttend: true, note }
  // Written here with the server key so athletes don't need write access to
  // the coach's workout rows; then the coach(es) get a push.
  if (body.action === "homeworkUpdate") {
    const hw = typeof body.homeworkId === "string" ? await getProtocolRow(body.homeworkId, log) : null
    if (!hw || hw.planPart !== "homework") return res.json({ error: "No such homework." }, 404)
    if (hw.athleteId !== userId) return res.json({ error: "Not your homework." }, 403)

    let data
    let pushBody
    const caller = await getUserRow(userId, log)
    const name = caller?.username || "Your athlete"
    const what = clip(hw.name, 80) || "their homework"
    if (body.cantAttend === true) {
      const note = clip(body.note, 300)
      data = { homeworkStatus: "cant_attend", homeworkNote: note || null, scheduledFor: null }
      pushBody = `${name} can't do ${what}${note ? `: "${note}"` : "."}`
    } else {
      const when = typeof body.scheduledFor === "string" ? new Date(body.scheduledFor) : null
      if (!when || isNaN(when.getTime()) || !DAY_RE.test(body.day ?? "")) {
        return res.json({ error: "Pick a day and time." }, 400)
      }
      if (DAY_RE.test(hw.dueBy ?? "") && body.day > hw.dueBy) {
        return res.json({ error: "That's after the deadline." }, 400)
      }
      data = { scheduledFor: when.toISOString(), homeworkStatus: null, homeworkNote: null }
      pushBody = `${name} scheduled ${what} for ${clip(body.whenLabel, 40) || body.day}.`
    }

    const updated = await updateProtocolRow(hw.$id, data, log)
    if (!updated) return res.json({ error: "Could not save. (Does the function's API key have write access?)" }, 502)

    const coaches = (await listCoachRows(log)).filter((c) => c.$id !== userId)
    await pushToUsers(coaches, () => ({
      sound: "default",
      title: body.cantAttend === true ? "Homework: can't attend" : "Homework scheduled",
      body: pushBody,
      data: { type: "homework_update", athleteId: userId, homeworkId: hw.$id },
    }), log, error)
    return res.json({ ok: true, row: updated }, 200)
  }

  // ── Action: athlete replaces an S&C exercise for the rest of their plan ─────
  // body: { planId, fromExerciseId, toExerciseId, afterPlanIndex? }
  // The plan's pick for that pattern is replaced (same slot), and workouts
  // already built from the plan after `afterPlanIndex` (not done yet) get the
  // new exercise too. Written with the server key — athletes can't write the
  // coach's rows. The coach(es) get a push.
  if (body.action === "planSwapExercise") {
    const { planId, fromExerciseId: fromId, toExerciseId: toId } = body
    if (typeof planId !== "string" || typeof fromId !== "string" || typeof toId !== "string" || fromId === toId) {
      return res.json({ error: "Bad request." }, 400)
    }
    const plan = await getRow(TRAINING_PLANS_TABLE, planId, log)
    if (!plan) return res.json({ error: "No such plan." }, 404)
    if (plan.athleteId !== userId) return res.json({ error: "Not your plan." }, 403)
    if (plan.status !== "active") return res.json({ error: "This plan has ended." }, 409)
    const to = await getRow(EXERCISES_TABLE, toId, log)
    if (!to) return res.json({ error: "No such exercise." }, 404)

    const patterns = parseJson(plan.scPatterns, [])
    if (!Array.isArray(patterns) || !patterns.some((p) => Array.isArray(p?.exerciseIds) && p.exerciseIds.includes(fromId))) {
      return res.json({ error: "That exercise isn't one of the plan's picks." }, 400)
    }
    const nextPatterns = patterns.map((p) => {
      if (!p.exerciseIds?.includes(fromId)) return p
      const ids = p.exerciseIds.map((id) => (id === fromId ? toId : id))
      return { ...p, exerciseIds: ids.filter((id, i) => ids.indexOf(id) === i) }
    })
    const updatedPlan = await updateRow(TRAINING_PLANS_TABLE, planId, { scPatterns: JSON.stringify(nextPatterns) }, log)
    if (!updatedPlan) return res.json({ error: "Could not save. (Does the function's API key have write access?)" }, 502)

    // Workouts already built for later slots.
    const after = Number.isFinite(body.afterPlanIndex) ? body.afterPlanIndex : null
    let workoutsUpdated = 0
    if (after != null) {
      const built = await listRowsEqual(PROTOCOLS_TABLE, "planId", planId, log)
      for (const w of built) {
        if (!(w.planIndex > after) || w.planPart === "homework") continue
        const blocks = parseJson(w.blocks, null)
        if (!Array.isArray(blocks)) continue
        let changed = false
        const next = blocks.map((b) => {
          if (b?.type !== "strength_conditioning" || !Array.isArray(b.exercises)) return b
          return {
            ...b,
            exercises: b.exercises.map((ex) => {
              if (ex?.exerciseId !== fromId) return ex
              changed = true
              return swapBlockExercise(ex, to)
            }),
          }
        })
        if (changed && await updateProtocolRow(w.$id, { blocks: JSON.stringify(next) }, log)) workoutsUpdated++
      }
    }

    const caller = await getUserRow(userId, log)
    const name = caller?.username || "Your athlete"
    const fromName = clip(body.fromExerciseName, 80) || "an exercise"
    const coaches = (await listCoachRows(log)).filter((c) => c.$id !== userId)
    await pushToUsers(coaches, () => ({
      sound: "default",
      title: "Plan exercise changed",
      body: `${name} replaced ${fromName} with ${clip(to.name, 80)} for the rest of their plan.`,
      data: { type: "plan_swap", athleteId: userId, planId },
    }), log, error)
    return res.json({ ok: true, scPatterns: nextPatterns, workoutsUpdated }, 200)
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    error("ANTHROPIC_API_KEY not set")
    return res.json({ error: "Server is not configured." }, 500)
  }

  // ── Action: summarize a project's session notes (any signed-in athlete) ──────
  if (body.action === "summarizeNotes") {
    const notes = Array.isArray(body.notes)
      ? body.notes.filter((n) => typeof n === "string" && n.trim()).slice(0, 50)
      : []
    if (notes.length === 0) return res.json({ summary: "" }, 200)
    const projectName = typeof body.projectName === "string" ? body.projectName : "this project"
    const anthropic = new Anthropic({ apiKey })
    try {
      const message = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 220,
        system: [{
          type: "text",
          text:
            "You are a bouldering coach. Given an athlete's session notes for ONE project, " +
            "write a 1–2 sentence recap: the key beta that worked, the recurring sticking point, " +
            "and what to focus on next session. Be concrete and encouraging. No preamble, no lists.",
          cache_control: { type: "ephemeral" },
        }],
        messages: [{
          role: "user",
          content: `Project: ${projectName}\n\nNotes from past sessions (oldest first):\n` +
            notes.map((n) => `- ${n}`).join("\n"),
        }],
      })
      const text = message.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join(" ")
        .trim()
      return res.json({ summary: text }, 200)
    } catch (e) {
      const status = e?.status
      if (status === 429) return res.json({ error: "Busy right now." }, 429)
      error(`Notes summary failed: ${e?.message ?? e}`)
      return res.json({ error: "Could not summarize notes." }, 502)
    }
  }

  // ── Protocol generation: coaches only, needs a prompt ────────────────────────
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : ""
  if (!prompt) {
    return res.json({ error: "Missing 'prompt'." }, 400)
  }
  if (prompt.length > 4000) {
    return res.json({ error: "Prompt too long." }, 400)
  }
  if (!(await isCoach(userId, log))) {
    return res.json({ error: "Coach access required." }, 403)
  }

  const anthropic = new Anthropic({ apiKey })

  // One unified call: the model returns a single protocol when no athletes are
  // named, or one protocol per athlete when they are. The roster + optional base
  // are the only volatile context and live in the user message.
  const roster = Array.isArray(body.athletes) ? body.athletes : []
  const base = Array.isArray(body.base) && body.base.length > 0 ? body.base : null
  const library = Array.isArray(body.library) ? body.library.slice(0, 100) : []
  const rosterText = roster.length
    ? roster.map((a) => `- id:${a.id} name:${a.name}`).join("\n")
    : "(no athletes available)"
  const libraryText = library.length
    ? library
        .map((b) => `- id:${b.id} type:${b.type} name:${b.name}${b.description ? ` — ${b.description}` : ""}`)
        .join("\n")
    : "(no saved blocks)"
  const userContent =
    `ROSTER:\n${rosterText}\n\n` +
    `LIBRARY (saved blocks you may reuse by libraryId):\n${libraryText}\n\n` +
    (base ? `BASE protocol blocks (JSON):\n${JSON.stringify(base)}\n\n` : "") +
    `COACH INSTRUCTION:\n${prompt}`

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: [
        { type: "text", text: UNIFIED_PACK, cache_control: { type: "ephemeral" } },
      ],
      tools: [PLAN_TOOL],
      // Force the model to answer through the tool → guaranteed structured JSON.
      tool_choice: { type: "tool", name: PLAN_TOOL.name },
      messages: [{ role: "user", content: userContent }],
    })

    const toolUse = message.content.find((b) => b.type === "tool_use")
    if (!toolUse || toolUse.name !== PLAN_TOOL.name) {
      error("Model did not return the expected tool call")
      return res.json({ error: "Could not generate. Try rephrasing." }, 502)
    }

    const result = toolUse.input // { unassigned?, groups?, unresolved? }
    const hasGroups = Array.isArray(result?.groups) && result.groups.length > 0
    const hasSingle = result?.unassigned && Array.isArray(result.unassigned.blocks) && result.unassigned.blocks.length > 0
    if (!hasGroups && !hasSingle) {
      return res.json({ error: "Couldn't produce a protocol. Try adding detail." }, 502)
    }
    log(hasGroups ? `Planned ${result.groups.length} group(s)` : "Generated one protocol")
    return res.json(result, 200)
  } catch (e) {
    // Typed Anthropic errors expose a numeric .status.
    const status = e?.status
    if (status === 429) {
      return res.json({ error: "Busy right now — please try again in a moment." }, 429)
    }
    if (status === 401 || status === 403) {
      error(`Anthropic auth error: ${e?.message}`)
      return res.json({ error: "Server is not configured." }, 500)
    }
    error(`Generation failed: ${e?.message ?? e}`)
    return res.json({ error: "Could not generate a protocol. Please try again." }, 502)
  }
}
