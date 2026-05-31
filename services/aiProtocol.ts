import { functions } from "@/components/AppWrite"
import { ExecutionMethod } from "appwrite"

// Paste the deployed Appwrite Function ID here (see functions/aiProtocol/README.md).
export const AI_PROTOCOL_FUNCTION_ID = ""

// ─── Shapes ─────────────────────────────────────────────────────────────────────

export type AiBlockType =
  | "project_bouldering"
  | "constraint_warmup"
  | "exploration_session"
  | "free_session"

export interface AiBlock {
  type: AiBlockType
  blockName: string
  description: string
  adaptation?: string
  targetAttempts?: number
  restTime?: number
  level?: string
  timeLimit?: number
}

export interface AiProtocol {
  name: string
  blocks: AiBlock[]
}

// Mirror of the app's valid values — used to reject anything the model drifts on.
const BLOCK_TYPES: AiBlockType[] = [
  "project_bouldering",
  "constraint_warmup",
  "exploration_session",
  "free_session",
]
const ADAPTATIONS = [
  "technique", "strength", "power", "power_endurance",
  "endurance", "conditioning", "mobility", "general", "test",
]
const GRADES = ["orange", "blue", "green", "yellow", "red", "black"]

function clampInt(v: any, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

// Defensive normalization: the function already forces structured output, but we
// never trust the model blindly — drop bad blocks, clamp ranges, strip invalid
// enums so the editor only ever receives well-formed data.
function normalize(raw: any): AiProtocol {
  const name = typeof raw?.name === "string" && raw.name.trim() ? raw.name.trim() : "AI session"
  const blocksIn = Array.isArray(raw?.blocks) ? raw.blocks : []

  const blocks: AiBlock[] = []
  for (const b of blocksIn) {
    if (!b || !BLOCK_TYPES.includes(b.type)) continue
    const blockName = typeof b.blockName === "string" ? b.blockName.trim() : ""
    const description = typeof b.description === "string" ? b.description.trim() : ""
    const adaptation = ADAPTATIONS.includes(b.adaptation) ? b.adaptation : undefined

    const block: AiBlock = { type: b.type, blockName, description, adaptation }

    if (b.type === "project_bouldering") {
      block.targetAttempts = clampInt(b.targetAttempts, 1, 20, 5)
      block.restTime = clampInt(b.restTime, 30, 600, 120)
    } else if (b.type === "constraint_warmup") {
      block.targetAttempts = clampInt(b.targetAttempts, 1, 10, 1)
      block.level = GRADES.includes(b.level) ? b.level : ""
    } else if (b.type === "exploration_session") {
      block.timeLimit = clampInt(b.timeLimit, 0, 240, 0)
    }

    blocks.push(block)
  }

  return { name, blocks }
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Ask the AI to draft a protocol from a coach's natural-language description.
 * Returns a normalized protocol ready to load into the editor for review.
 */
export async function generateProtocol(prompt: string): Promise<AiProtocol> {
  if (!AI_PROTOCOL_FUNCTION_ID) {
    throw new Error("AI is not set up yet (missing function ID).")
  }

  const execution = await functions.createExecution({
    functionId: AI_PROTOCOL_FUNCTION_ID,
    body: JSON.stringify({ prompt }),
    async: false,
    method: ExecutionMethod.POST,
  })

  let payload: any = {}
  try {
    payload = execution.responseBody ? JSON.parse(execution.responseBody) : {}
  } catch {
    throw new Error("Unexpected response from the AI service.")
  }

  if (execution.responseStatusCode < 200 || execution.responseStatusCode >= 300) {
    throw new Error(payload?.error ?? "The AI service could not generate a protocol.")
  }

  const result = normalize(payload)
  if (result.blocks.length === 0) {
    throw new Error("The AI didn't produce any usable blocks. Try adding more detail.")
  }
  return result
}
