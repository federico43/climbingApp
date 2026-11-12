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
// block's time limit (Max bouldering, Power, Coordination — Max by time since
// coach 2026-11-12); "attempts" — a number of attempts (Base 1, Benchmark).
export type SprayMode = "time" | "attempts"

export interface SprayBlockRef {
  name: string
  type: string // the block type (sequence / free_session)
  routeType: RouteType
  mode: SprayMode
}

export const SPRAY_BLOCKS: SprayBlockRef[] = [
  { name: "Max bouldering", type: "sequence", routeType: "max_bouldering", mode: "time" },
  { name: "Base 1", type: "sequence", routeType: "base", mode: "attempts" },
  { name: "Power boulders", type: "free_session", routeType: "power", mode: "time" },
  { name: "Coordination boulders", type: "free_session", routeType: "coordination", mode: "time" },
  // The plan's Benchmark (utils/benchmark.ts): a sequence at the limit,
  // tried at the start of the plan and again at its end.
  { name: "Benchmark", type: "sequence", routeType: "max_bouldering", mode: "attempts" },
]

// Defaults when the block doesn't set them.
export const SPRAY_DEFAULT_MINUTES = 20
// Power and Coordination boulders: 15 min (coach 2026-11-12).
export const SPRAY_TIME_BLOCK_MINUTES = 15
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
    minutes: (block.timeLimit ?? 0) > 0 ? block.timeLimit! : mode === "time" ? SPRAY_TIME_BLOCK_MINUTES : SPRAY_DEFAULT_MINUTES,
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

// ── Instructions (to-do 2026-11-11, coach feedback 2026-11-12) ──
// What the intro of each spray block tells the athlete: only what's needed to
// understand the exercise (no technique). Base 1 keeps the plain steps, the
// coach's notes explain it better. The others say the time limit, never the
// number of attempts. The coach's description (block.description) shows above.

export interface SprayStep { title: string; text: string }

interface SprayCopy {
  goal: string
  choose: string
  // Hide the coach's description on the intro (Power, Max: coach 2026-11-12).
  hideCoachNotes?: boolean
}

// Power and Max bouldering (coach 2026-11-12): no coach notes, and the
// sequence comes from the wall or is made with the coach or alone.
const CHOOSE_OR_CREATE = "Pick one of the available sequences, or create a new one with your coach or on your own."

const SPRAY_COPY: Partial<Record<RouteType, SprayCopy>> = {
  max_bouldering: {
    goal: "A 4–5 move boulder problem at your limit.",
    choose: CHOOSE_OR_CREATE,
    hideCoachNotes: true,
  },
  power: {
    goal: "Short, explosive sequences.",
    choose: CHOOSE_OR_CREATE,
    hideCoachNotes: true,
  },
  coordination: {
    goal: "Moves that need timing: jumps, paddles.",
    choose: "One with a move that needs timing. A new one, or one of the suggested ones.",
  },
}

const BENCHMARK_COPY: SprayCopy = {
  goal: "Your test at the start and at the end of the plan.",
  choose: "Week 1: one at your limit. Last week: the same one, already set.",
}

function sprayCopyFor(block: { type?: string; blockName?: string }): SprayCopy | undefined {
  const ref = sprayBlockFor(block)
  return ref?.name === "Benchmark" ? BENCHMARK_COPY : ref ? SPRAY_COPY[ref.routeType] : undefined
}

// Whether the intro shows the coach's description above the steps.
export const sprayShowsCoachNotes = (block: { type?: string; blockName?: string }) =>
  !sprayCopyFor(block)?.hideCoachNotes

// Base 1 and blocks that aren't spray blocks: the plain steps.
function plainSteps(settings: { mode: SprayMode; minutes: number; attempts: number; timeCap: number | null }): SprayStep[] {
  return [
    { title: "Choose a sequence", text: "A new one, or one of the suggested ones." },
    {
      title: "Climb it",
      text: settings.mode === "time"
        ? `As many attempts as you can in ${settings.minutes} min. Tap Top or Fell after each one.`
        : `${settings.attempts} attempts${settings.timeCap != null ? ` in ${settings.timeCap} min` : ""}. Tap Top or Fell after each one.`,
    },
    { title: "Rest", text: "The rest timer starts on its own." },
  ]
}

// The block's time limit in minutes, if it has one (time mode, or a time cap).
export function sprayMinutes(settings: { mode: SprayMode; minutes: number; timeCap: number | null }): number | null {
  return settings.mode === "time" ? settings.minutes : settings.timeCap
}

export function sprayBlockSteps(
  block: { type?: string; blockName?: string },
  settings: { mode: SprayMode; minutes: number; attempts: number; timeCap: number | null },
): SprayStep[] {
  const copy = sprayCopyFor(block)
  if (!copy) return plainSteps(settings)
  const minutes = sprayMinutes(settings)
  return [
    { title: "Goal", text: copy.goal },
    { title: "Choose a sequence", text: copy.choose },
    {
      title: "Climb it",
      text: minutes != null
        ? `${minutes} min. Tap Top or Fell after each attempt.`
        : "Tap Top or Fell after each attempt.",
    },
    { title: "Rest", text: "The rest timer starts on its own." },
  ]
}

// Whether the intro shows the attempt count: only Base 1 (and blocks with no
// time limit), the others go by time (coach 2026-11-12).
export function sprayShowsAttempts(
  block: { type?: string; blockName?: string },
  settings: { mode: SprayMode; minutes: number; timeCap: number | null },
): boolean {
  const ref = sprayBlockFor(block)
  return settings.mode !== "time" && (ref?.routeType === "base" || sprayMinutes(settings) == null)
}
