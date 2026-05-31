import Anthropic from "@anthropic-ai/sdk"
import { KNOWLEDGE_PACK, PROTOCOL_TOOL } from "./knowledgePack.js"

// Model. Per Anthropic guidance this defaults to the most capable model; swap to
// "claude-sonnet-4-6" to roughly halve cost at slightly lower quality.
const MODEL = "claude-opus-4-8"

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
  try {
    const url = `${ENDPOINT}/databases/${DATABASE_ID}/collections/${USERS_TABLE}/documents/${encodeURIComponent(userId)}`
    const r = await fetch(url, {
      headers: { "X-Appwrite-Project": PROJECT, "X-Appwrite-Key": apiKey },
    })
    if (!r.ok) return false
    const doc = await r.json()
    return doc?.role === "coach"
  } catch {
    return false
  }
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

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 6000,
      // Knowledge pack is the cacheable prefix; the coach's prompt is the only
      // volatile part and lives in the user message after the breakpoint.
      system: [
        { type: "text", text: KNOWLEDGE_PACK, cache_control: { type: "ephemeral" } },
      ],
      tools: [PROTOCOL_TOOL],
      // Force the model to answer through the tool → guaranteed structured JSON.
      tool_choice: { type: "tool", name: "propose_protocol" },
      messages: [{ role: "user", content: prompt }],
    })

    const toolUse = message.content.find((b) => b.type === "tool_use")
    if (!toolUse || toolUse.name !== "propose_protocol") {
      error("Model did not return the expected tool call")
      return res.json({ error: "Could not generate a protocol. Try rephrasing." }, 502)
    }

    const result = toolUse.input // { name, blocks }
    if (!result || !Array.isArray(result.blocks) || result.blocks.length === 0) {
      return res.json({ error: "The model returned an empty protocol. Try adding detail." }, 502)
    }

    log(`Generated protocol "${result.name}" with ${result.blocks.length} blocks`)
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
