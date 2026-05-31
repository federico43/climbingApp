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

/**
 * Confirm the caller exists and has the coach role. Returns true/false; never
 * throws. Reads the user's row through the stable Databases REST endpoint using
 * the server API key (so the client can't spoof a role).
 */
async function isCoach(userId, log) {
  const apiKey = process.env.APPWRITE_API_KEY
  if (!apiKey) {
    log?.("APPWRITE_API_KEY not set — cannot verify coach role")
    return false
  }
  const headers = { "X-Appwrite-Project": PROJECT, "X-Appwrite-Key": apiKey }
  const id = encodeURIComponent(userId)
  // Try both REST shapes: the newer TablesDB rows path and the classic
  // Databases documents path, so this works regardless of Appwrite version.
  const urls = [
    `${ENDPOINT}/tablesdb/${DATABASE_ID}/tables/${USERS_TABLE}/rows/${id}`,
    `${ENDPOINT}/databases/${DATABASE_ID}/collections/${USERS_TABLE}/documents/${id}`,
  ]
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers })
      if (!r.ok) continue
      const row = await r.json()
      return row?.role === "coach"
    } catch {
      // try the next shape
    }
  }
  log?.(`Could not read user row for ${userId} on either REST path`)
  return false
}

export default async ({ req, res, log, error }) => {
  // ── Parse input ─────────────────────────────────────────────────────────────
  let body = {}
  try {
    body = req.bodyJson ?? (req.body ? JSON.parse(req.body) : {})
  } catch {
    return res.json({ error: "Invalid JSON body." }, 400)
  }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : ""
  if (!prompt) {
    return res.json({ error: "Missing 'prompt'." }, 400)
  }
  if (prompt.length > 4000) {
    return res.json({ error: "Prompt too long." }, 400)
  }

  // ── Auth: coaches only ──────────────────────────────────────────────────────
  const userId = req.headers["x-appwrite-user-id"]
  if (!userId) {
    return res.json({ error: "Not authenticated." }, 401)
  }
  if (!(await isCoach(userId, log))) {
    return res.json({ error: "Coach access required." }, 403)
  }

  // ── Generate ────────────────────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    error("ANTHROPIC_API_KEY not set")
    return res.json({ error: "Server is not configured." }, 500)
  }

  const anthropic = new Anthropic({ apiKey })

  // One unified call: the model returns a single protocol when no athletes are
  // named, or one protocol per athlete when they are. The roster + optional base
  // are the only volatile context and live in the user message.
  const roster = Array.isArray(body.athletes) ? body.athletes : []
  const base = Array.isArray(body.base) && body.base.length > 0 ? body.base : null
  const rosterText = roster.length
    ? roster.map((a) => `- id:${a.id} name:${a.name}`).join("\n")
    : "(no athletes available)"
  const userContent =
    `ROSTER:\n${rosterText}\n\n` +
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

    const result = toolUse.input // { unassigned?, athletes?, unresolved? }
    const hasAthletes = Array.isArray(result?.athletes) && result.athletes.length > 0
    const hasSingle = result?.unassigned && Array.isArray(result.unassigned.blocks) && result.unassigned.blocks.length > 0
    if (!hasAthletes && !hasSingle) {
      return res.json({ error: "Couldn't produce a protocol. Try adding detail." }, 502)
    }
    log(hasAthletes ? `Planned ${result.athletes.length} athlete protocol(s)` : "Generated one protocol")
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
