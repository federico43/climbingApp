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
  // The plan's Benchmark (utils/benchmark.ts): a sequence at the limit,
  // tried at the start of the plan and again at its end.
  { name: "Benchmark", type: "sequence", routeType: "max_bouldering", mode: "attempts" },
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
    // Attempts blocks with a time limit too (Max bouldering in the plan:
    // 15 min) end at whichever comes first. null = no time limit.
    timeCap: mode === "attempts" && (block.timeLimit ?? 0) > 0 ? block.timeLimit! : null,
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
// `current` — the workout in progress (not saved yet), so a sequence added
// on the first Power boulders shows up on the second one.
export function routeRecords(sessions: SessionRow[], current: Attempt[] = [], now = new Date().toISOString()): Map<string, RouteRecord> {
  const map = new Map<string, RouteRecord>()
  const add = (attempts: Attempt[], at: string) => {
    for (const a of attempts) {
      if (!a?.routeId) continue
      const r = map.get(a.routeId) ?? { routeId: a.routeId, tries: 0, sends: 0, lastAt: "" }
      r.tries++
      if (a.success) r.sends++
      if (at > r.lastAt) r.lastAt = at
      map.set(a.routeId, r)
    }
  }
  for (const s of sessions) {
    let attempts: Attempt[] = []
    try { attempts = JSON.parse(s.attempts || "[]") } catch { continue }
    if (Array.isArray(attempts)) add(attempts, s.$createdAt)
  }
  add(current, now)
  return map
}

// ─── Level from the athlete's flash (coach 2026-11-10) ───────────────────────

// The sequence level (1–8) that matches each flash colour. Red and black
// span two levels each (red 5–6, black 7–8); the lower one is the target.
export const FLASH_SEQUENCE_LEVEL: Record<string, number> = {
  orange: 1, blue: 2, green: 3, yellow: 4, red: 5, black: 7,
}

// The other way round: the flash colour a sequence level (1–8) belongs to —
// 1 orange, 2 blue, 3 green, 4 yellow, 5–6 red, 7–8 black. Shown next to the
// number wherever the level is picked, so the 1–8 scale reads as the gym's
// colours (coach 2026-11-10). null for a level off the scale.
export function sequenceLevelColour(level: number | null | undefined): string | null {
  if (level == null || !Number.isFinite(level) || level < 1 || level > 8) return null
  let colour: string | null = null
  for (const [c, l] of Object.entries(FLASH_SEQUENCE_LEVEL)) if (l <= level) colour = c
  return colour
}

// Levels above (+) or below (−) the flash level, per route type: Base and
// Coordination a level easier (volume, technique), Power at the flash level,
// Max bouldering a level harder (at the limit). To be tuned with use.
export const SPRAY_LEVEL_OFFSET: Record<RouteType, number> = {
  base: -1, coordination: -1, power: 0, max_bouldering: 1,
}

// The level to suggest sequences at for a block of `routeType`, from the
// athlete's flash colour. null without a (known) flash colour.
export function sprayTargetLevel(flash: string | null | undefined, routeType: RouteType): number | null {
  const base = flash ? FLASH_SEQUENCE_LEVEL[flash] : undefined
  if (base == null) return null
  return Math.max(1, Math.min(8, base + (SPRAY_LEVEL_OFFSET[routeType] ?? 0)))
}

// The sequences to suggest for a block of `routeType`. `routes` is what the
// athlete can see (routesVisibleTo); `exclude` the ones already picked in
// this block.
// · No target level (no flash colour): ones of that type the athlete has
//   already logged, fewest sends first (ties: the one climbed longest ago
//   first, so they rotate).
// · With a target level: every sequence of that type, closest level first
//   (no level set → last), then fewest sends — so ones they've never tried
//   come first — then climbed longest ago.
// `pinned` — a sequence the coach set on the block (its routeId): listed
// first whatever its type, level or record, as long as the athlete can see it.
export function suggestSprayRoutes(
  records: Map<string, RouteRecord>,
  routes: Map<string, { id: string; type?: string; level?: number | null }>,
  routeType: RouteType,
  exclude: Iterable<string> = [],
  limit = SPRAY_SUGGESTION_COUNT,
  targetLevel: number | null = null,
  pinned: string | null = null,
): RouteRecord[] {
  const skip = new Set(exclude)
  const first = pinned && !skip.has(pinned) && routes.has(pinned)
    ? [records.get(pinned) ?? { routeId: pinned, tries: 0, sends: 0, lastAt: "" }]
    : []
  const bySends = (a: RouteRecord, b: RouteRecord) =>
    a.sends - b.sends || a.lastAt.localeCompare(b.lastAt) || a.routeId.localeCompare(b.routeId)
  let rest: RouteRecord[]
  if (targetLevel == null) {
    rest = [...records.values()]
      .filter((r) => !skip.has(r.routeId) && r.routeId !== pinned && routes.get(r.routeId)?.type === routeType)
      .sort(bySends)
  } else {
    const distance = (id: string) => {
      const level = routes.get(id)?.level
      return typeof level === "number" ? Math.abs(level - targetLevel) : Infinity
    }
    rest = [...routes.values()]
      .filter((r) => r.type === routeType && !skip.has(r.id) && r.id !== pinned)
      .map((r) => records.get(r.id) ?? { routeId: r.id, tries: 0, sends: 0, lastAt: "" })
      .sort((a, b) => {
        const da = distance(a.routeId), db = distance(b.routeId)
        return (da === db ? 0 : da < db ? -1 : 1) || bySends(a, b)
      })
  }
  return [...first, ...rest].slice(0, limit)
}

// ─── Sequences on the shared wall (coach 2026-11-11) ─────────────────────────

// The spray wall is the gym's: a sequence one athlete adds in a spray block
// is for everyone doing that kind of block, not only for them. (A sequence's
// athleteId still says who built it — My sequences, edit / delete.)

// Sequences of `routeType` the athlete hasn't climbed yet, newest first, so
// one a teammate just added is on the choose screen right away — whatever
// its level, and even without a flash colour (the suggestions then only
// list ones already climbed). `exclude`: already listed or picked.
export function newSprayRoutes(
  routes: Iterable<{ $id: string; $createdAt?: string; type?: string | null }>,
  records: Map<string, RouteRecord>,
  routeType: RouteType,
  exclude: Iterable<string> = [],
  limit = 10,
): string[] {
  const skip = new Set(exclude)
  return [...routes]
    .filter((r) => r.type === routeType && !skip.has(r.$id) && !records.has(r.$id))
    .sort((a, b) => (b.$createdAt ?? "").localeCompare(a.$createdAt ?? "") || a.$id.localeCompare(b.$id))
    .slice(0, limit)
    .map((r) => r.$id)
}

// ── Instructions (to-do 2026-11-11: better instructions for every spray block) ──
// What the intro of each spray block tells the athlete, one short line per
// step: the goal, which sequence to pick, how to climb it, how to rest.
// Coach's own description (block.description) still shows above it.

export interface SprayStep { title: string; text: string }

interface SprayCopy { goal: string; choose: string; climb: string; rest: string }

const SPRAY_COPY: Record<string, SprayCopy> = {
  max_bouldering: {
    goal: "Your hardest moves. Every attempt at 100%.",
    choose: "One you can't flash, but could top in about 5 tries.",
    climb: "Full effort from the first move. Stop if your attempts get sloppy.",
    rest: "Rest fully. A tired attempt doesn't count as max.",
  },
  base: {
    goal: "Clean, precise climbing below your limit.",
    choose: "One you can top in 1–3 tries.",
    climb: "Quiet feet, no readjusting, the same way every time.",
    rest: "Short rests are fine. Keep the quality.",
  },
  power: {
    goal: "Fast, explosive moves.",
    choose: "Short (3–6 moves) with at least one big move.",
    climb: "Move fast and commit. Push with the legs, don't lock off.",
    rest: "Rest enough that every attempt is fast.",
  },
  coordination: {
    goal: "Timing: deadpoints, jumps, paddles, double-clutches.",
    choose: "One with a move that needs timing, not strength.",
    climb: "Commit to the timing. Falling is part of it. Change one thing each try.",
    rest: "Rest enough to stay sharp.",
  },
}

const BENCHMARK_COPY: SprayCopy = {
  goal: "Your test at the start and at the end of the plan.",
  choose: "Week 1: one at your limit. Last week: the same one, already set.",
  climb: "Full effort every attempt, like a max day.",
  rest: "Rest fully between attempts.",
}

// The sequence legend on the wall: S start, numbers = hand moves in order,
// F feet, ★ finish, B hand bounce (tap it and keep moving with the same hand).
export const SPRAY_LEGEND = "S start · 1, 2, 3 hands in order · F foot · ★ top · B hand bounce"

export function sprayBlockSteps(
  block: { type?: string; blockName?: string },
  settings: { mode: SprayMode; minutes: number; attempts: number; timeCap: number | null },
): SprayStep[] {
  const ref = sprayBlockFor(block)
  const copy = ref?.name === "Benchmark" ? BENCHMARK_COPY : SPRAY_COPY[ref?.routeType ?? ""]
  const count = settings.mode === "time"
    ? `As many attempts as you can in ${settings.minutes} min.`
    : `${settings.attempts} attempts${settings.timeCap != null ? ` in ${settings.timeCap} min` : ""}.`
  const steps: SprayStep[] = []
  if (copy) steps.push({ title: "Goal", text: copy.goal })
  steps.push({ title: "Choose a sequence", text: copy ? copy.choose : "A new one, or one of the suggested ones." })
  steps.push({ title: "Climb it", text: `${count} ${copy ? copy.climb + " " : ""}Tap Top or Fell after each one.` })
  steps.push({ title: "Rest", text: `The timer starts on its own. ${copy ? copy.rest : ""}`.trim() })
  return steps
}
