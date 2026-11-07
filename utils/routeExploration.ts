import { BoulderLevelOptions, colourIndex, colourLabel } from "@/utils/boulderColours"

// Route exploration (coach 2026-11-05): the week's new routes, set every
// Monday, in two timed parts.
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
  "Warm up first with *4 routes below your flash level*.",
  "*Don't read the routes before the timer starts.*",
  "Part 1 · Flash (25 min): try every new route of the week at your flash level: *{colour}*.",
  "*3 goes max* per route. Sent or not, move on to the next one.",
  "*No trying single moves*: every go starts from the start holds.",
  "Sent every {colour}? Go up one colour and try every route of that colour until time runs out.",
  "Tried every {colour} and there's still time left? Go on to part 2.",
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
  routes: ExplorationRoute[]
  // Sent / tried per colour, easiest first.
  byColour: { colour: string; sent: number; tried: number }[]
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
  const counts = new Map<string, { sent: number; tried: number }>()
  for (const r of routes) {
    const c = counts.get(r.colour) ?? { sent: 0, tried: 0 }
    c.tried++
    if (r.sent) c.sent++
    counts.set(r.colour, c)
  }
  const byColour = [...counts.entries()]
    .map(([colour, c]) => ({ colour, ...c }))
    .sort((a, b) => colourIndex(a.colour) - colourIndex(b.colour))
  const sentColours = byColour.filter((c) => c.sent > 0)
  const part2 = attempts.find((a) => a.part === 2)
  return {
    goes: explorationGoes(routes),
    routes,
    byColour,
    topSent: sentColours.length ? sentColours[sentColours.length - 1].colour : null,
    answered: !!part2,
    reasons: part2?.fallReasons ?? [],
    notes: part2?.notes ?? "",
  }
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
