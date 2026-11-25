import { BoulderLevelOptions, colourIndex, colourLabel } from "@/utils/boulderColours"

// Route exploration (coach 2026-11-05): the week's new routes, set every
// Monday, in two timed parts.
//   Before them (coach 2026-11-12): a 5 min warm-up on easy routes, then
//   2 min of slow breathing to switch on the focus part 1 needs. The first
//   time an athlete gets this version, slides explain why
//   (components/ExplorationFocusSlides.tsx).
//   Part 1, Flash (25 min): new routes from the athlete's flash colour (blue
//   at least), at most 3 goes each. Each route is logged with the go it went
//   on, or "not sent". All sent at a colour → the next colour; any not sent
//   once the colour is tried → straight to part 2. After moving up, the
//   athlete tries every route of the new colour until time runs out.
//   Part 2, Project (25 min): the routes that didn't go, worked with more
//   rest. At the end: did you work something out, and what did you notice
//   (the project bouldering fall reasons).
// Only for Fear management plans, where it takes the constraint warm-up's
// place (utils/planRotation.ts). Pure: no React Native imports.

export const EXPLORATION_BLOCK_TYPE = "route_exploration"
export const EXPLORATION_PART_MIN = 25
export const EXPLORATION_MAX_TRIES = 3
export const EXPLORATION_MIN_COLOUR = "blue"
export const EXPLORATION_WARMUP_MIN = 5
export const EXPLORATION_BREATHING_MIN = 2

export const WALLS = [
  { key: "placa1", label: "Placa 1", hint: "The one with the cave" },
  { key: "placa2", label: "Placa 2" },
  { key: "desplome", label: "Desplome" },
  { key: "slab", label: "Slab" },
] as const
export type WallKey = (typeof WALLS)[number]["key"]

export function wallLabel(key: string | null | undefined): string {
  return WALLS.find((w) => w.key === key)?.label ?? (key || "—")
}

// {colour} is replaced with the athlete's starting colour when shown.
export const EXPLORATION_DEFAULT_DESCRIPTION = [
  "Warm-up (5 min): easy routes *below your flash level*.",
  "Then *2 min of breathing* to get your head on the wall.",
  "*Don't read the routes before the timer starts.*",
  "Part 1 · Flash (25 min): try every new route of the week at your flash level: *{colour}*.",
  "*3 goes max* per route. Sent or not, move on to the next one.",
  "*No trying single moves*: every go starts from the start holds.",
  "Sent every {colour}? Go up one colour and try every route of that colour until time runs out.",
  "Tried every {colour} and there's still time left? Go on to part 2.",
].join("\n")

// Defaults shipped before, saved into workouts built back then. Shown as
// the current default instead, so old workouts get the new notes.
const OLD_EXPLORATION_DESCRIPTIONS = [
  [
    "Warm up first with *4 orange routes* before you start.",
    "Part 1 · Flash (25 min): try every new route of the week at your flash level: *{colour}*.",
    "*3 goes max* per route. Sent or not, move on to the next one.",
    "Sent every {colour}? Go up one colour and try every route of that colour until time runs out.",
    "Tried every {colour} and there's still time left? Go on to part 2.",
  ].join("\n"),
  [
    "Warm up first with *4 routes below your flash level*.",
    "*Don't read the routes before the timer starts.*",
    "Part 1 · Flash (25 min): try every new route of the week at your flash level: *{colour}*.",
    "*3 goes max* per route. Sent or not, move on to the next one.",
    "*No trying single moves*: every go starts from the start holds.",
    "Sent every {colour}? Go up one colour and try every route of that colour until time runs out.",
    "Tried every {colour} and there's still time left? Go on to part 2.",
  ].join("\n"),
]

// The notes to show for a block: its own, unless empty or an old default.
export function explorationDescription(saved: string | null | undefined): string {
  const d = saved?.trim()
  if (!d || OLD_EXPLORATION_DESCRIPTIONS.includes(d)) return EXPLORATION_DEFAULT_DESCRIPTION
  return d
}

export const EXPLORATION_WARMUP_NOTES = [
  "Warm up on *easy routes below your flash level*, a little harder each time.",
  "*Not the new routes*: save them for part 1.",
].join("\n")

export const EXPLORATION_BREATHING_NOTES = [
  "Sit or stand still and follow the circle.",
  "*In through the nose, slow out through the mouth.*",
  "When a thought shows up, let it go and come back to the breath.",
].join("\n")

export const EXPLORATION_PROJECT_NOTES = [
  "Part 2 · Project: go back to the routes that didn't go.",
  "Rest more between goes and work the moves you couldn't do.",
].join("\n")

// The coach's notes with {colour} (the start colour) filled in with its name.
export function explorationNotes(text: string, startColour: string): string {
  return text.split("{colour}").join(colourLabel(startColour))
}

// The colour part 1 starts at: the athlete's flash colour, blue at least.
export function explorationStartColour(flash: string | null | undefined): string {
  const min = colourIndex(EXPLORATION_MIN_COLOUR)
  const i = colourIndex(flash)
  return BoulderLevelOptions[Math.max(min, i)].value
}

// ─── Breathing ───────────────────────────────────────────────────────────────

// One breath: 4 s in, 6 s out. A longer exhale calms the body down.
export const BREATH_IN_MS = 4000
export const BREATH_OUT_MS = 6000

// Where in the breath `elapsedMs` (since breathing started) falls: in or
// out, and how far through that half (0–1).
export function breathAt(elapsedMs: number): { phase: "in" | "out"; progress: number } {
  const cycle = BREATH_IN_MS + BREATH_OUT_MS
  const t = ((Math.max(0, elapsedMs) % cycle) + cycle) % cycle
  return t < BREATH_IN_MS
    ? { phase: "in", progress: t / BREATH_IN_MS }
    : { phase: "out", progress: (t - BREATH_IN_MS) / BREATH_OUT_MS }
}

// ─── Why it's done this way (first-time slides) ──────────────────────────────

export interface ExplorationSlide {
  poster: string
  icon: string // Ionicons name
  title: string
  text: string
}

// The slides shown the first time an athlete does the exploration with the
// warm-up and breathing (coach 2026-11-12), with the block's own minutes.
export function explorationFocusSlides(min: { warmup: number; breathing: number; flash: number; project: number }): ExplorationSlide[] {
  return [
    {
      poster: "Focus",
      icon: "eye",
      title: "Exploration needs focus",
      text: "New routes, three goes each, no reading them first. You only get a few chances, so your head has to be on the wall, not somewhere else.",
    },
    {
      poster: "Breathe",
      icon: "leaf",
      title: "Why breathe first",
      text: `${min.breathing} minutes of slow breathing calm your body and quiet your thoughts. It's the switch from warming up to paying full attention.`,
    },
    {
      poster: "One move",
      icon: "footsteps",
      title: "One move at a time",
      text: "On the wall, focus on each movement: where your feet go, how you hold, where your weight is. Not on the thoughts that show up while you climb.",
    },
    {
      poster: "Remember",
      icon: "bulb",
      title: "Remember your plan",
      text: "A calm head remembers what you are working on. When a thought pulls you away, breathe out and come back to the next move.",
    },
    {
      poster: "Today",
      icon: "list",
      title: "How the session goes",
      text: `Warm-up ${min.warmup} min on easy routes · Breathing ${min.breathing} min · Part 1 Flash ${min.flash} min · Part 2 Project ${min.project} min.`,
    },
  ]
}

// ─── Part 1 ──────────────────────────────────────────────────────────────────

export interface ExplorationRoute {
  colour: string
  wall: string
  // The go it went on (1–3); for a route that didn't go, the goes spent (3).
  tries: number
  sent: boolean
}

// After the athlete says they've tried every new route at `colour`: the next
// colour when all of them went, else null (part 1 is over). Black has no
// next colour.
export function nextExplorationColour(colour: string, routes: ExplorationRoute[]): string | null {
  const here = routes.filter((r) => r.colour === colour)
  if (here.length === 0 || here.some((r) => !r.sent)) return null
  const i = colourIndex(colour)
  return i >= 0 && i < BoulderLevelOptions.length - 1 ? BoulderLevelOptions[i + 1].value : null
}

// Goes ("pegues") in part 1.
export function explorationGoes(routes: ExplorationRoute[]): number {
  return routes.reduce((t, r) => t + (r.sent ? r.tries : Math.max(r.tries, EXPLORATION_MAX_TRIES)), 0)
}

// ─── Points ──────────────────────────────────────────────────────────────────

// Points per colour: the Density test's (`niveles_boulder.difficulty`):
// blue 1, green 2, yellow 3, red 4, black 5. Orange isn't scored there.
export function colourPoints(colour: string): number {
  return Math.max(0, colourIndex(colour))
}

// What each go keeps of the colour's points (coach 2026-11-05: the 2nd go
// takes a tenth off). Not sent = 0, like the Density test only counts tops.
export const GO_FACTOR = [1, 0.9, 0.8] as const

export function routePoints(r: Pick<ExplorationRoute, "colour" | "tries" | "sent">): number {
  if (!r.sent) return 0
  const factor = GO_FACTOR[Math.min(Math.max(r.tries, 1), GO_FACTOR.length) - 1]
  return round1(colourPoints(r.colour) * factor)
}

export function explorationPoints(routes: ExplorationRoute[]): number {
  return round1(routes.reduce((t, r) => t + routePoints(r), 0))
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

// "7", "7.4" — no trailing ".0".
export function formatPoints(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(1)
}

// ─── Saved attempts ──────────────────────────────────────────────────────────

// What the block logs: one attempt per route in part 1 (part 1, level =
// colour, wall, tries, success = sent) and one for part 2 (part 2, what
// they realised they did wrong in part 1: fallReasons, notes).
export interface ExplorationAttemptLike {
  success: boolean
  level?: string
  wall?: string
  tries?: number
  part?: number
  fallReasons?: string[]
  notes?: string
}

export interface ExplorationSummary {
  goes: number
  points: number
  routes: ExplorationRoute[]
  // Sent / tried / points per colour, easiest first.
  byColour: { colour: string; sent: number; tried: number; points: number }[]
  // Same per wall, in WALLS order.
  byWall: { wall: string; sent: number; tried: number; points: number }[]
  topSent: string | null
  // Part 2's question answered (what they realised they did wrong).
  answered: boolean
  reasons: string[]
  notes: string
}

export function summarizeExploration(attempts: ExplorationAttemptLike[]): ExplorationSummary {
  const routes: ExplorationRoute[] = attempts
    .filter((a) => a.part !== 2)
    .map((a) => ({ colour: a.level ?? "", wall: a.wall ?? "", tries: a.tries ?? 1, sent: !!a.success }))
  const byColour = tally(routes, (r) => r.colour)
    .map(({ key, ...c }) => ({ colour: key, ...c }))
    .sort((a, b) => colourIndex(a.colour) - colourIndex(b.colour))
  const wallOrder = (w: string) => { const i = WALLS.findIndex((x) => x.key === w); return i < 0 ? WALLS.length : i }
  const byWall = tally(routes, (r) => r.wall)
    .map(({ key, ...c }) => ({ wall: key, ...c }))
    .sort((a, b) => wallOrder(a.wall) - wallOrder(b.wall))
  const sentColours = byColour.filter((c) => c.sent > 0)
  const part2 = attempts.find((a) => a.part === 2)
  return {
    goes: explorationGoes(routes),
    points: explorationPoints(routes),
    routes,
    byColour,
    byWall,
    topSent: sentColours.length ? sentColours[sentColours.length - 1].colour : null,
    answered: !!part2,
    reasons: part2?.fallReasons ?? [],
    notes: part2?.notes ?? "",
  }
}

function tally(routes: ExplorationRoute[], keyOf: (r: ExplorationRoute) => string) {
  const m = new Map<string, { sent: number; tried: number; points: number }>()
  for (const r of routes) {
    const k = keyOf(r)
    const c = m.get(k) ?? { sent: 0, tried: 0, points: 0 }
    c.tried++
    if (r.sent) c.sent++
    c.points = round1(c.points + routePoints(r))
    m.set(k, c)
  }
  return [...m.entries()].map(([key, c]) => ({ key, ...c }))
}

// ─── Last time ───────────────────────────────────────────────────────────────

export interface ExplorationSessionLike {
  $createdAt: string
  attempts: string // JSON array of the session's attempts
}

// The newest saved session (sessions newest first) with route exploration
// routes in it, summarised, with its date. `skipTimestamps` = this workout's
// own attempts, so a session that is this same workout doesn't count.
export function lastExploration(
  sessions: ExplorationSessionLike[],
  skipTimestamps: number[] = [],
): { date: string; summary: ExplorationSummary } | null {
  const skip = new Set(skipTimestamps)
  for (const s of sessions) {
    let arr: any[] = []
    try { arr = JSON.parse(s.attempts || "[]") } catch { continue }
    if (!Array.isArray(arr)) continue
    const ex = arr.filter((a) => a?.type === EXPLORATION_BLOCK_TYPE)
    if (ex.some((a) => skip.has(a?.timestamp))) continue
    const summary = summarizeExploration(ex)
    if (summary.routes.length > 0) return { date: s.$createdAt, summary }
  }
  return null
}

// ─── When the plan puts it in ────────────────────────────────────────────────

function weekday(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sunday, 1 = Monday
}

// The Monday of the week `dateStr` falls in ("YYYY-MM-DD").
export function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  const back = (weekday(dateStr) + 6) % 7
  return new Date(Date.UTC(y, m - 1, d - back)).toISOString().slice(0, 10)
}

export function isMonday(dateStr: string): boolean {
  return weekday(dateStr) === 1
}

export function hasExplorationBlock(blocksJson: string | undefined): boolean {
  if (!blocksJson) return false
  try {
    const blocks = JSON.parse(blocksJson)
    return Array.isArray(blocks) && blocks.some((b) => b?.type === EXPLORATION_BLOCK_TYPE)
  } catch {
    return false
  }
}

// Whether a workout built on `today` can have the exploration: not on a
// Monday (the routes are being set), and not when a workout built since this
// week's Monday already has it. `built` = the local day each other workout
// was built on, with whether it has the exploration.
export function explorationAllowed(today: string, built: { day: string; hasExploration: boolean }[]): boolean {
  if (isMonday(today)) return false
  const monday = mondayOf(today)
  return !built.some((w) => w.hasExploration && w.day >= monday && w.day <= today)
}
