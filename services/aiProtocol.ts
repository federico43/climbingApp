import { functions } from "@/components/AppWrite"
import { ExecutionMethod } from "appwrite"

// Deployed Appwrite Function ID (see functions/aiProtocol/README.md).
export const AI_PROTOCOL_FUNCTION_ID = "6a1c2e850024e1f59fc3"

// ─── Shapes ─────────────────────────────────────────────────────────────────────

export type AiBlockType =
  | "project_bouldering"
  | "constraint_warmup"
  | "exploration_session"
  | "free_session"
  | "sequence"

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
  "sequence",
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
function normalizeBlocks(blocksIn: any): AiBlock[] {
  const list = Array.isArray(blocksIn) ? blocksIn : []
  const blocks: AiBlock[] = []
  for (const b of list) {
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
    } else if (b.type === "sequence") {
      // Route is left empty — the coach attaches it in the editor afterward.
      block.targetAttempts = clampInt(b.targetAttempts, 1, 20, 5)
      block.restTime = clampInt(b.restTime, 30, 600, 120)
    }

    blocks.push(block)
  }
  return blocks
}

function normalize(raw: any): AiProtocol {
  const name = typeof raw?.name === "string" && raw.name.trim() ? raw.name.trim() : "AI session"
  return { name, blocks: normalizeBlocks(raw?.blocks) }
}

// ─── Assignment set (one protocol per athlete) ──────────────────────────────────

// A group of athletes who all receive the same protocol.
export interface PlanGroup {
  athletes: { id: string; name: string }[]
  protocolName: string
  blocks: AiBlock[]
}

export interface AssignmentSet {
  groups: PlanGroup[]
  unresolved: string[] // names the AI couldn't match to a roster athlete
}

// The unified call returns one of two shapes: a single protocol (no athletes
// named) or an assignment set (athletes named).
export type GeneratePlanResult =
  | { kind: "single"; protocol: AiProtocol }
  | { kind: "assign"; set: AssignmentSet }

// Trim editor blocks to just the fields the model cares about (drops local ids,
// route holds, etc.) before sending them as the optional base.
function trimBase(blocks: any[]): any[] {
  return (blocks ?? []).map((b) => {
    const out: any = { type: b.type, blockName: b.blockName, description: b.description }
    if (b.adaptation) out.adaptation = b.adaptation
    if (b.targetAttempts != null) out.targetAttempts = b.targetAttempts
    if (b.restTime != null) out.restTime = b.restTime
    if (b.level) out.level = b.level
    if (b.timeLimit != null) out.timeLimit = b.timeLimit
    return out
  })
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * One call from the "Generate with AI" button. If the prompt names athletes from
 * `athletes` (the roster), returns an assignment set (a protocol per athlete);
 * otherwise returns a single protocol. `baseBlocks` (the editor's current blocks,
 * or null) is sent as an optional starting point the AI varies.
 */
export async function generatePlan(
  prompt: string,
  baseBlocks: any[] | null,
  athletes: { id: string; name: string }[],
): Promise<GeneratePlanResult> {
  if (!AI_PROTOCOL_FUNCTION_ID) {
    throw new Error("AI is not set up yet (missing function ID).")
  }

  const execution = await functions.createExecution({
    functionId: AI_PROTOCOL_FUNCTION_ID,
    body: JSON.stringify({
      prompt,
      athletes,
      base: baseBlocks && baseBlocks.length ? trimBase(baseBlocks) : undefined,
    }),
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
    throw new Error(payload?.error ?? "The AI service could not respond.")
  }

  // Assignment case — one protocol per group of athletes.
  const rawGroups = Array.isArray(payload?.groups) ? payload.groups : []
  if (rawGroups.length > 0) {
    const byId = new Map(athletes.map((a) => [a.id, a]))
    const unresolved: string[] = Array.isArray(payload?.unresolved)
      ? payload.unresolved.filter((s: any) => typeof s === "string")
      : []
    const groups: PlanGroup[] = []
    for (const g of rawGroups) {
      const ids = Array.isArray(g?.athleteIds) ? g.athleteIds : []
      // Resolve each id against the real roster — never trust a model-invented id.
      const resolved = ids
        .map((id: any) => byId.get(id))
        .filter((a: any): a is { id: string; name: string } => !!a)
      if (resolved.length === 0) {
        // Whole group unmatched — surface its names so the coach knows.
        ;(Array.isArray(g?.athleteNames) ? g.athleteNames : []).forEach(
          (n: any) => typeof n === "string" && unresolved.push(n)
        )
        continue
      }
      const blocks = normalizeBlocks(g.blocks)
      if (blocks.length === 0) continue
      groups.push({
        athletes: resolved,
        protocolName:
          typeof g.protocolName === "string" && g.protocolName.trim()
            ? g.protocolName.trim()
            : "AI session",
        blocks,
      })
    }
    if (groups.length === 0) {
      throw new Error("The AI couldn't plan any athletes. Name them clearly and try again.")
    }
    return { kind: "assign", set: { groups, unresolved } }
  }

  // Single-protocol case.
  const protocol = normalize(payload?.unassigned ?? {})
  if (protocol.blocks.length === 0) {
    throw new Error("The AI didn't produce any usable blocks. Try adding more detail.")
  }
  return { kind: "single", protocol }
}
