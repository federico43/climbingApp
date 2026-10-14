import type { BlockType } from "@/components/workoutBlocks"

// How every block type progresses session to session — the coach-approved
// spec in docs/progression-spec.md, one entry per BlockType so no type is
// ever left undefined. The rules themselves live in one pure module per
// block (utils/progression/<block>.ts, plus utils/scProgression.ts for S&C);
// this table is the single place that says which kind each block is and
// holds the numbers those rules read, so a tuning change is a one-line edit
// here rather than a hunt through logic.
//
// Rules are fixed per block type (coach's call), not configurable per saved
// template. Everything here is a *suggestion* — shown to the athlete as a
// persistent, overridable banner and flagged in the coach editor; nothing is
// ever written to a block automatically.

export type ProgressionKind =
  | "progress"  // next session gets harder/easier based on the last one
  | "rotate"    // varies (e.g. swap the constraint) but never gets harder
  | "test"      // assessment — never progresses
  | "none"      // no suggestion; the coach decides

export interface ProgressionProfile {
  kind: ProgressionKind
  signals: string    // what the rule reads from the athlete's log
  lever: string      // what the rule changes
  built: boolean     // whether the rule module exists yet (Phase 2 progress)
}

export const PROGRESSION_PROFILES: Record<BlockType, ProgressionProfile> = {
  strength_conditioning: {
    kind: "progress", built: true,
    signals: "Reps completed and RPE per exercise",
    lever: "Weight (±5 %) or the exercise's level chain",
  },
  sequence: {
    kind: "progress", built: true,
    signals: "Sends vs attempts, variation finished on, fall point on the first attempts",
    lever: "Route level (same type); starting variation as a sub-step",
  },
  four_by_four: {
    kind: "progress", built: true,
    signals: "Tops per set",
    lever: "One boulder slot one colour, first → last",
  },
  intervals: {
    kind: "progress", built: true,
    signals: "Fall (round), end-of-block answer: very pumped in the last two rounds (warm-up) / felt very easy (power endurance)",
    lever: "Work time ±10 s (30–90 s), rest fixed",
  },
  constraint_warmup: {
    kind: "rotate", built: true,
    signals: "Last constraints used, the training plan's focus, athlete flash level",
    lever: "Which 3 constraints, ramped easiest → hardest colour, 3 → 1 attempts",
  },
  project_bouldering: {
    kind: "none", built: true,
    signals: "Sends and sessions per project (tracked, not acted on)",
    lever: "—",
  },
  free_session: {
    kind: "none", built: true,
    signals: "—",
    lever: "—",
  },
  exploration_session: {
    kind: "test", built: true,
    signals: "Results recorded only",
    lever: "—",
  },
}

// ─── Sequence ────────────────────────────────────────────────────────────────

export const SEQUENCE_RULES = {
  // Send rate (rounded to the nearest 10 %) needed for a session to count as
  // passed — on Original or Harder only.
  passSendRate: 0.8,
  // Passed routes at one level (same type) before moving up a level.
  passesToLevelUp: 4,
  // In-session: a fall at or below this fraction of the sequence's moves on
  // the first attempt counts as "fell on the first moves".
  earlyFallFraction: 1 / 3,
  minLevel: 1,
  maxLevel: 8,
} as const

// ─── 4×4 ─────────────────────────────────────────────────────────────────────

export const FOUR_BY_FOUR_RULES = {
  // A fall (tops < boulders per set) in sets 1…earlyFallSets undoes the last
  // upgrade; falls only in later sets hold the boulders as they are.
  earlyFallSets: 2,
  // First session on a block with no coach-set colours: every boulder this
  // many colours below the athlete's flash level (floor orange).
  startBelowFlash: 1,
  // Each step moves one boulder slot by this many colours.
  colourStep: 1,
} as const

// ─── Intervals ───────────────────────────────────────────────────────────────

// Two kinds, picked by the coach on the block (IntervalsBlock.kind).
//   warm-up:          fall or "very pumped in the last two rounds" → −step;
//                     not pumped → +step.
//   power endurance:  fall in the first `earlyFallFraction` of the rounds →
//                     −step; no fall and "felt very easy" → +step; else hold.
export const INTERVALS_RULES = {
  workStep: 10,     // seconds per change
  minWork: 30,
  maxWork: 90,
  // Power endurance: a fall in rounds 1…floor(series × this) is "too much
  // time on the wall" (8 rounds → rounds 1–5).
  earlyFallFraction: 2 / 3,
  // Picking "Warm-up" on a block sets its rounds to this (coach 2026-10-03).
  warmupSeries: 4,
} as const

// ─── Constraint warmup ───────────────────────────────────────────────────────

export const CONSTRAINT_WARMUP_RULES = {
  // Constraints per warm-up, each its own block.
  count: 3,
  // Attempts per slot, easiest colour first.
  attempts: [3, 2, 1],
  // Colour ramp: slot 1 is this many colours below flash, the last slot is
  // flash itself ([flash − 2, flash − 1, flash], floor orange).
  rampBelowFlash: 2,
} as const

// Rotation groups a constraint can warm up for — one per training-plan
// focus, except strength and power endurance, which share their constraints
// (coach 2026-10-03, docs/training-plan.md §9.9b).
export type WarmupPillar = "strength_power_endurance" | "power" | "technique" | "fear_management"
// Which colours a constraint may be done on, relative to the athlete's flash.
export type ColourRange = "below_flash" | "up_to_flash" | "two_below_flash" | "any"
export interface ConstraintRotation { pillars: WarmupPillar[]; colours: ColourRange }

// The coach's table (docs/training-plan.md §9.9b), keyed by constraint name
// (lowercase, letters/digits only). Each constraint's own settings (edited in
// the block editor and saved on its library block as `rotation`) override
// this.
export const DEFAULT_CONSTRAINT_ROTATION: Record<string, ConstraintRotation> = {
  ghostholds:                { pillars: ["power"], colours: "below_flash" },
  doublehands:               { pillars: ["power", "fear_management"], colours: "below_flash" },
  onehandonly:               { pillars: ["power", "fear_management"], colours: "two_below_flash" },
  fallingpractice:           { pillars: ["fear_management"], colours: "two_below_flash" },
  feetonair:                 { pillars: ["strength_power_endurance"], colours: "up_to_flash" },
  hoverhands:                { pillars: ["strength_power_endurance"], colours: "up_to_flash" },
  sloth:                     { pillars: ["strength_power_endurance"], colours: "up_to_flash" },
  noreadjustment:            { pillars: ["technique"], colours: "any" },
  silentfeet:                { pillars: ["technique"], colours: "below_flash" },
  relaxthehand:              { pillars: ["technique"], colours: "two_below_flash" },
  silentfeetnoreadjustment:  { pillars: ["technique"], colours: "below_flash" },
  footmoves:                 { pillars: ["technique"], colours: "below_flash" },
  onefootonly:               { pillars: ["technique"], colours: "any" },
}

// Colours a constraint must never be done on, whatever its colour range or
// the coach's own settings say — keyed like the table above. When the
// rotation would put one of these on an excluded colour, another constraint
// takes its place: same group first, then any other group (see
// suggestWarmup). Add a line here for each new rule.
export const CONSTRAINT_COLOUR_EXCLUSIONS: Record<string, string[]> = {
  feetonair: ["orange"], // orange routes are too easy to need feet — coach 2026-10-14
}
