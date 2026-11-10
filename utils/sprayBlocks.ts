import type { Attempt } from "@/hooks/WorkoutHook"
import type { SessionRow } from "@/services/BoulderGraphService"
import type { RouteType } from "@/utils/sequenceVariations"

// The spray-wall blocks (coach 2026-11-09): Max bouldering, Base 1, Power
// boulders and Coordination boulders. Each one trains one route type (the
// `type` tag on spray_routes). In the workout they all run the same way,
// like Project bouldering (coach 2026-11-10): instructions → choose a
// sequence (add a new one, or one of the suggested ones — sequences of the
// block's type they've already logged, fewest sends first) → work on it
// (Top / Fell, rest timer) until the time or the attempts run out. No
// "Coach is here?" switch on them.
// Pure: no fetching or UI (components/SprayBlock.tsx is the screen).

// How a spray block ends (coach 2026-11-10): "time" — a countdown from the
// block's time limit (Power, Coordination); "attempts" — a number of
// attempts (Max bouldering, Base 1).
export type SprayMode = "time" | "attempts"

export interface SprayBlockRef {
  name: string
  type: string // the block type (sequence / free_session)
  routeType: RouteType
  mode: SprayMode
}

export const SPRAY_BLOCKS: SprayBlockRef[] = [
  { name: "Max bouldering", type: "sequence", routeType: "max_bouldering", mode: "attempts" },
  { name: "Base 1", type: "sequence", routeType: "base", mode: "attempts" },
  { name: "Power boulders", type: "free_session", routeType: "power", mode: "time" },
  { name: "Coordination boulders", type: "free_session", routeType: "coordination", mode: "time" },
]

// Defaults when the block doesn't set them.
export const SPRAY_DEFAULT_MINUTES = 20
export const SPRAY_DEFAULT_ATTEMPTS = 5
export const SPRAY_DEFAULT_REST_S = 120
// The rest lengths the athlete can switch to between attempts.
export const SPRAY_REST_OPTIONS_S = [60, 120, 180]

// How many suggested sequences the block lists.
export const SPRAY_SUGGESTION_COUNT = 5

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

// The route type a block trains, if it's one of the spray blocks (matched by
// name AND type, like the plan's main blocks). null otherwise.
export function sprayRouteTypeFor(block: { type?: string; blockName?: string } | null | undefined): RouteType | null {
  return sprayBlockFor(block)?.routeType ?? null
}

export function sprayBlockFor(block: { type?: string; blockName?: string } | null | undefined): SprayBlockRef | null {
  if (!block || typeof block.type !== "string" || typeof block.blockName !== "string") return null
  return SPRAY_BLOCKS.find((r) => r.type === block.type && sameName(r.name, block.blockName!)) ?? null
}

// What a spray block runs with: its mode, and the time limit (time mode) or
// attempt target (attempts mode), and the rest between attempts.
export function spraySettings(block: { type?: string; blockName?: string; timeLimit?: number; targetAttempts?: number; restTime?: number }) {
  const ref = sprayBlockFor(block)
  const mode: SprayMode = ref?.mode ?? "attempts"
  return {
    mode,
    routeType: ref?.routeType ?? null,
    minutes: (block.timeLimit ?? 0) > 0 ? block.timeLimit! : SPRAY_DEFAULT_MINUTES,
    attempts: (block.targetAttempts ?? 0) > 0 ? block.targetAttempts! : SPRAY_DEFAULT_ATTEMPTS,
    rest: (block.restTime ?? 0) > 0 ? block.restTime! : SPRAY_DEFAULT_REST_S,
  }
}

export const isSprayBlock = (block: { type?: string; blockName?: string } | null | undefined) =>
  sprayRouteTypeFor(block) !== null

// What the athlete has logged on one sequence, across all their sessions.
export interface RouteRecord {
  routeId: string
  tries: number
  sends: number
  lastAt: string // ISO time of the latest session it was climbed in
}

// Every sequence the athlete has logged attempts on (any block), with totals.
export function routeRecords(sessions: SessionRow[]): Map<string, RouteRecord> {
  const map = new Map<string, RouteRecord>()
  for (const s of sessions) {
    let attempts: Attempt[] = []
    try { attempts = JSON.parse(s.attempts || "[]") } catch { continue }
    if (!Array.isArray(attempts)) continue
    for (const a of attempts) {
      if (!a?.routeId) continue
      const r = map.get(a.routeId) ?? { routeId: a.routeId, tries: 0, sends: 0, lastAt: "" }
      r.tries++
      if (a.success) r.sends++
      if (s.$createdAt > r.lastAt) r.lastAt = s.$createdAt
      map.set(a.routeId, r)
    }
  }
  return map
}

// The sequences to suggest for a block of `routeType`: ones of that type the
// athlete has already logged, fewest sends first (ties: the one climbed
// longest ago first, so they rotate). `routes` is what the athlete can see
// (routesVisibleTo); `exclude` the ones already picked in this block.
export function suggestSprayRoutes(
  records: Map<string, RouteRecord>,
  routes: Map<string, { id: string; type?: string }>,
  routeType: RouteType,
  exclude: Iterable<string> = [],
  limit = SPRAY_SUGGESTION_COUNT,
): RouteRecord[] {
  const skip = new Set(exclude)
  return [...records.values()]
    .filter((r) => !skip.has(r.routeId) && routes.get(r.routeId)?.type === routeType)
    .sort((a, b) => a.sends - b.sends || a.lastAt.localeCompare(b.lastAt) || a.routeId.localeCompare(b.routeId))
    .slice(0, limit)
}
