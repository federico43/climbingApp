import Anthropic from "@anthropic-ai/sdk"
import { UNIFIED_PACK, PLAN_TOOL } from "./knowledgePack.js"

// Model. Haiku is cheap and plenty for turning a sentence into a structured
// protocol. Bump to "claude-sonnet-4-6" or "claude-opus-4-8" for higher quality.
const MODEL = "claude-haiku-4-5"

// Appwrite injects these automatically at runtime; the fallbacks match this app.
const ENDPOINT = process.env.APPWRITE_FUNCTION_API_ENDPOINT || "https://nyc.cloud.appwrite.io/v1"
const PROJECT = process.env.APPWRITE_FUNCTION_PROJECT_ID || "689e515d000c2e1af428"
const DATABASE_ID = process.env.DATABASE_ID || "68bd9dd7003c15f7147e"
const USERS_TABLE = process.env.USERS_TABLE || "users"

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

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
    const caller = await getUserRow(userId, log)
    if (!caller || caller.role !== "athlete") {
      return res.json({ ok: true, notified: 0 }, 200)
    }

    const protocolName = typeof body.protocolName === "string" ? body.protocolName.trim().slice(0, 120) : ""
    const athleteName = caller.username || "An athlete"

    const coaches = (await listCoachRows(log)).filter(
      (c) => c.$id !== userId && typeof c.pushToken === "string" && c.pushToken
    )
    if (coaches.length === 0) return res.json({ ok: true, notified: 0 }, 200)

    const messages = coaches.map((c) => ({
      to: c.pushToken,
      sound: "default",
      title: "Workout completed",
      body: protocolName ? `${athleteName} finished "${protocolName}".` : `${athleteName} finished a workout.`,
      data: { type: "workout_completed", athleteId: userId },
    }))

    try {
      const r = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(messages),
      })
      const result = await r.json().catch(() => null)
      if (!r.ok) {
        error(`Expo push send failed: ${r.status} ${JSON.stringify(result)}`)
        return res.json({ error: "Could not send notification." }, 502)
      }
      log(`Notified ${messages.length} coach(es)`)
      return res.json({ ok: true, notified: messages.length }, 200)
    } catch (e) {
      error(`Expo push send failed: ${e?.message ?? e}`)
      return res.json({ error: "Could not send notification." }, 502)
    }
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
