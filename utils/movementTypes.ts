// Movement-pattern taxonomy for S&C exercises (climbing-specific, not a
// generic gym split). Lives on the exercise library entry — a given exercise
// always has the same movement pattern regardless of which block it's used
// in — and is copied onto a block's exercise instance the same way
// photoUri/notes already are. Used to warn when a circuit pairs/trios two
// exercises hitting the same pattern.
//
// Pull is split into vertical (pull-ups, lat pulldowns) and horizontal (rows)
// since they load climbing-relevant muscle groups differently enough to
// matter for circuit pairing. Push is kept as one category.
//
// Joint patterns (wrist, elbow, shoulder, ankle) are for keeping a joint
// strong or bringing it back after an injury (coach 2026-11-04). They're
// ordinary movement patterns — tagged, picked and charted like any other —
// with one rule of their own, shared with core: no explosiveness, only
// max force ↔ hypertrophy (focusesFor in utils/scProgression.ts,
// noPowerFocusFor in utils/planRotation.ts).

export type MovementType =
  | "pull_vertical"
  | "pull_horizontal"
  | "push"
  | "hinge"
  | "squat"
  | "core"
  | "carry_grip"
  | "rotational"
  | "balance"
  | "wrist"
  | "elbow"
  | "shoulder"
  | "ankle"
  | "mobility"

export const MOVEMENT_TYPES: MovementType[] = [
  "pull_vertical",
  "pull_horizontal",
  "push",
  "hinge",
  "squat",
  "core",
  "carry_grip",
  "rotational",
  "balance",
  "wrist",
  "elbow",
  "shoulder",
  "ankle",
  "mobility",
]

export const JOINT_PATTERNS: MovementType[] = ["wrist", "elbow", "shoulder", "ankle"]

export function isJointPattern(m?: string | null): boolean {
  return !!m && (JOINT_PATTERNS as string[]).includes(m)
}

// Patterns that never train explosiveness: core (coach 2026-10-21), the
// joints (coach 2026-11-04) and balance (2026-11-09).
export function skipsExplosiveness(m?: string | null): boolean {
  return m === "core" || m === "balance" || isJointPattern(m)
}

export const MOVEMENT_TYPE_LABEL: Record<MovementType, string> = {
  pull_vertical:    "Pull (vertical)",
  pull_horizontal:  "Pull (horizontal)",
  push:             "Push",
  hinge:            "Hinge",
  squat:            "Squat",
  core:             "Core",
  carry_grip:       "Fingers / grip",
  rotational:       "Rotational",
  balance:          "Balance",
  wrist:            "Wrist",
  elbow:            "Elbow",
  shoulder:         "Shoulder",
  ankle:            "Ankle",
  mobility:         "Mobility",
}

export const MOVEMENT_TYPE_COLOR: Record<MovementType, string> = {
  pull_vertical:    "#4F8FE0",  // blue
  pull_horizontal:  "#5DA9E0",  // lighter blue — sibling of vertical pull
  push:             "#E0734F",  // orange-red
  hinge:            "#9D7CD6",  // purple
  squat:            "#62C99A",  // green
  core:             "#FED766",  // yellow
  carry_grip:       "#5DBDB3",  // teal
  rotational:       "#C2577A",  // wine
  balance:          "#C9B79C",  // sand
  wrist:            "#D68C4F",  // amber — sibling of carry/grip, distinct from it
  elbow:            "#B88A5A",  // tan — joint sibling of wrist
  shoulder:         "#8FA35A",  // olive — joint
  ankle:            "#7A8FB0",  // slate blue — joint
  mobility:         "#D67AB1",  // pink — distinct from every other pattern's color
}
