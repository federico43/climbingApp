// Technique modules (docs/technique-modules.md): a ~6-week course that a
// Technique-focus plan can run in its warm-up slot. Each module has levels the
// athlete unlocks one at a time. Pure data, no React Native imports, so the
// rules in utils/techniqueProgress.ts and their Node tests can read it.
//
// Text follows the instruction types (Coach notes / How it works / Cue):
//   level.rule      → Coach notes on the block intro. Never names a technique:
//                     the athlete finds the solution first (Experiment).
//   module.howItWorks → How it works: app mechanics only, ≤ 4 steps.
//   level.cue       → Cue: one line on the running screen.
//   technique.note  → Coach notes on the reveal card (Identify), shown only
//                     after the athlete's answer points to it.

export type TechniqueModuleId = "footwork"

export type TechniqueId = "smear" | "flag" | "leg_tension" | "pogo"

export interface TechniqueCard {
  id: TechniqueId
  name: string
  note: string
}

export interface ModuleLevel {
  number: number        // 1-based, in unlock order
  name: string
  rule: string
  cue: string
  // What the coach usually sees appear at this level. Coach-only (plan card,
  // session history), never shown to the athlete before Identify.
  expected: TechniqueId[]
}

export interface ReflectionChip {
  id: string
  label: string
  technique: TechniqueId | null // null = no card (e.g. "Not sure")
}

export interface PassRule {
  routesInARow: number           // passing routes in a row, across sessions
  maxBreaks: number              // rule breaks allowed on a passing route
  passFeels: RouteFeel[]         // feels that count as a pass
  maxColourStep: number          // colours above the level's base colour
}

export type RouteFeel = "hard" | "ok" | "easy"

export interface TechniqueModule {
  id: TechniqueModuleId
  name: string
  goal: string
  levels: ModuleLevel[]
  techniques: TechniqueCard[]
  howItWorks: string[]
  reflection: { question: string; chips: ReflectionChip[]; maxPicks: number }
  startCheck: string
  retest: string
  sprayMinutes: number
  routesPerSession: number
  // The whole module block, start to reveal (the plan's warm-up slot).
  sessionMinutes: number
  passRule: PassRule
}

// Highest value of the "rule breaks" tap: 3 means "3 or more".
export const MAX_BREAKS_TAP = 3

export const FOOTWORK: TechniqueModule = {
  id: "footwork",
  name: "Footwork",
  goal: "Use your feet to climb with less effort.",
  levels: [
    {
      number: 1,
      name: "Free foot",
      rule: "Every time you move a hand, one foot presses flat on the bare wall, not on a hold. You pick which foot. Between hand moves, place your feet however you like.",
      cue: "Hand moves → one foot on the bare wall",
      expected: ["smear"],
    },
    {
      number: 2,
      name: "Opposite foot",
      rule: "Every time you move a hand, the foot on the other side presses flat on the bare wall. Left hand moves, right foot on the wall. Right hand moves, left foot. Between hand moves, place your feet however you like.",
      cue: "Left hand → right foot on the wall",
      expected: ["smear", "leg_tension"],
    },
    {
      number: 3,
      name: "Same foot",
      rule: "Every time you move a hand, the foot on the same side presses flat on the bare wall. Left hand moves, left foot on the wall. Right hand moves, right foot. Between hand moves, place your feet however you like.",
      cue: "Left hand → left foot on the wall",
      expected: ["flag", "pogo"],
    },
  ],
  techniques: [
    {
      id: "smear",
      name: "Smearing",
      note: "Pressing the sole flat on the wall where there's no hold. Heel low, weight over the toes, push into the wall rather than down.",
    },
    {
      id: "flag",
      name: "Flagging",
      note: "Putting the free leg out to the side or behind you to balance instead of on a hold. It stops you swinging open when both contact points are on one side.",
    },
    {
      id: "leg_tension",
      name: "Leg tension",
      note: "Pushing with the leg to keep your hips close to the wall, so your arms do less of the work.",
    },
    {
      id: "pogo",
      name: "Pogo",
      note: "Swinging the free leg to build momentum, then driving off the standing foot to reach the next hold.",
    },
  ],
  howItWorks: [
    "Spray wall: pick a sequence and climb it with the rule. Find two ways to do the hardest move.",
    "Route: climb it once normally, then again with the rule.",
    "After each route, tap how many times you broke the rule and how it felt.",
    "Answer one question to see what you found.",
  ],
  reflection: {
    question: "What did your free leg do most?",
    maxPicks: 2,
    chips: [
      { id: "wall", label: "Pressed on the bare wall", technique: "smear" },
      { id: "side", label: "Went out to the side for balance", technique: "flag" },
      { id: "push", label: "Pushed hard to keep me close", technique: "leg_tension" },
      { id: "swing", label: "Swung to give me a push", technique: "pogo" },
      { id: "unsure", label: "Not sure", technique: null },
    ],
  },
  startCheck: "This is your starting point. Climb the route once normally, then again with the Level 1 rule.",
  retest: "Same colour as your first session. Climb a route once normally, then again with your level's rule, and compare with your start.",
  sprayMinutes: 10,
  routesPerSession: 2,
  sessionMinutes: 20,
  passRule: { routesInARow: 2, maxBreaks: 1, passFeels: ["ok", "easy"], maxColourStep: 1 },
}

export const TECHNIQUE_MODULES: Record<TechniqueModuleId, TechniqueModule> = {
  footwork: FOOTWORK,
}

export const TECHNIQUE_MODULE_IDS = Object.keys(TECHNIQUE_MODULES) as TechniqueModuleId[]

export function isTechniqueModuleId(v: unknown): v is TechniqueModuleId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(TECHNIQUE_MODULES, v)
}

// null for anything unknown (an old or mistyped id on a plan).
export function getTechniqueModule(id: string | null | undefined): TechniqueModule | null {
  return isTechniqueModuleId(id) ? TECHNIQUE_MODULES[id] : null
}

export function moduleLevel(module: TechniqueModule, level: number): ModuleLevel {
  const i = Math.max(1, Math.min(module.levels.length, Math.round(level))) - 1
  return module.levels[i]
}

// Until the module screen exists (PR 4 of docs/technique-modules.md), the
// block runs as a free session: the goal and the Level 1 rule, the session's
// minutes, and the chip question as the notes prompt.
export function moduleStandIn(module: TechniqueModule, blockName?: string) {
  const level = module.levels[0]
  return {
    type: "free_session" as const,
    blockName: blockName || moduleBlockName(module),
    description: `${module.goal}\n\nLevel ${level.number} · ${level.name}: ${level.rule}`,
    timeLimit: module.sessionMinutes,
    notePrompt: module.reflection.question,
  }
}

// The block's name in workouts and summaries: "Footwork module".
export function moduleBlockName(module: TechniqueModule): string {
  return `${module.name} module`
}

export function techniqueCard(module: TechniqueModule, id: TechniqueId): TechniqueCard | null {
  return module.techniques.find((t) => t.id === id) ?? null
}
