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

export type MovementType =
  | "pull_vertical"
  | "pull_horizontal"
  | "push"
  | "hinge"
  | "squat"
  | "core"
  | "carry_grip"
  | "rotational"
  | "wrist"
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
  "wrist",
  "mobility",
]

export const MOVEMENT_TYPE_LABEL: Record<MovementType, string> = {
  pull_vertical:    "Pull (vertical)",
  pull_horizontal:  "Pull (horizontal)",
  push:             "Push",
  hinge:            "Hinge",
  squat:            "Squat",
  core:             "Core",
  carry_grip:       "Fingers / grip",
  rotational:       "Rotational",
  wrist:            "Wrist",
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
  wrist:            "#D68C4F",  // amber — sibling of carry/grip, distinct from it
  mobility:         "#D67AB1",  // pink — distinct from every other pattern's color
}
