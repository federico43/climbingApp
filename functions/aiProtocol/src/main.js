import Anthropic from "@anthropic-ai/sdk"
import { KNOWLEDGE_PACK, PROTOCOL_TOOL, ASSIGN_PACK, ASSIGN_TOOL } from "./knowledgePack.js"

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

  // ── Build the request for the requested mode ────────────────────────────────
  // "generate": one prompt → one protocol.
  // "assign":   one prompt + roster (+ optional base) → one protocol per athlete.
  const mode = body.mode === "assign" ? "assign" : "generate"

  let system, tool, userContent
  if (mode === "assign") {
    const roster = Array.isArray(body.athletes) ? body.athletes : []
    if (roster.length === 0) {
      return res.json({ error: "No athletes provided." }, 400)
    }
    const base = Array.isArray(body.base) && body.base.length > 0 ? body.base : null
    const rosterText = roster
      .map((a) => `- id:${a.id} name:${a.name}`)
      .join("\n")
    system = ASSIGN_PACK
    tool = ASSIGN_TOOL
    userContent =
      `ROSTER:\n${rosterText}\n\n` +
      (base ? `BASE protocol blocks (JSON):\n${JSON.stringify(base)}\n\n` : "") +
      `COACH INSTRUCTION:\n${prompt}`
  } else {
    system = KNOWLEDGE_PACK
    tool = PROTOCOL_TOOL
    userContent = prompt
  }

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: mode === "assign" ? 8000 : 6000,
      // System prompt is the cacheable prefix; the volatile parts (prompt,
      // roster, base) live in the user message after the breakpoint.
      system: [
        { type: "text", text: system, cache_control: { type: "ephemeral" } },
      ],
      tools: [tool],
      // Force the model to answer through the tool → guaranteed structured JSON.
      tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content: userContent }],
    })

    const toolUse = message.content.find((b) => b.type === "tool_use")
    if (!toolUse || toolUse.name !== tool.name) {
      error("Model did not return the expected tool call")
      return res.json({ error: "Could not generate. Try rephrasing." }, 502)
    }

    const result = toolUse.input
    if (mode === "assign") {
      if (!result || !Array.isArray(result.athletes) || result.athletes.length === 0) {
        return res.json({ error: "No athletes could be planned. Name them and try again." }, 502)
      }
      log(`Planned ${result.athletes.length} athlete protocol(s)`)
    } else {
      if (!result || !Array.isArray(result.blocks) || result.blocks.length === 0) {
        return res.json({ error: "The model returned an empty protocol. Try adding detail." }, 502)
      }
      log(`Generated protocol "${result.name}" with ${result.blocks.length} blocks`)
    }
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
