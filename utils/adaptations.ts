// Training adaptation taxonomy.
//
// Every workout block can be tagged with a target adaptation (the quality
// the athlete is training). Used for:
//   - Pie chart of how a session was split between adaptations
//   - Per-athlete day-timeline dashboard
//   - Future: trends, weekly volume by adaptation, recommendations

export type Adaptation =
  | "technique"
  | "strength"
  | "power"
  | "power_endurance"
  | "endurance"
  | "conditioning"
  | "mobility"
  | "general"
  | "test"

export const ADAPTATIONS: Adaptation[] = [
  "technique",
  "strength",
  "power",
  "power_endurance",
  "endurance",
  "conditioning",
  "mobility",
  "general",
  "test",
]

export const ADAPTATION_LABEL: Record<Adaptation, string> = {
  technique:        "Technique",
  strength:         "Strength",
  power:            "Power",
  power_endurance:  "Power endurance",
  endurance:        "Endurance",
  conditioning:     "Conditioning",
  mobility:         "Mobility",
  general:          "General",
  test:             "Test",
}

// One color per adaptation — used consistently across pie chart, timeline
// bars, and any future visualizations.
export const ADAPTATION_COLOR: Record<Adaptation, string> = {
  technique:        "#4FA3E0",  // blue
  strength:         "#DB504A",  // red
  power:            "#FED766",  // yellow
  power_endurance:  "#E07A4F",  // orange
  endurance:        "#62C99A",  // green
  conditioning:     "#9D7CD6",  // purple
  mobility:         "#5DBDB3",  // teal
  general:          "#888888",  // gray
  test:             "#E0568A",  // pink
}

// Fallback adaptation when a block doesn't have one explicitly set.
// `sequence` must be coach-picked (strength or power endurance), but we
// default it to `strength` for graceful rendering of legacy blocks.
const DEFAULT_BY_TYPE: Record<string, Adaptation> = {
  project_bouldering:     "strength",
  constraint_warmup:      "technique",
  strength_conditioning:  "conditioning",
  exploration_session:    "general",
  sequence:               "strength",
  free_session:           "general",
  four_by_four:           "power_endurance",
}

export function resolveAdaptation(block: { type?: string; adaptation?: string }): Adaptation {
  if (block.adaptation && (ADAPTATIONS as string[]).includes(block.adaptation)) {
    return block.adaptation as Adaptation
  }
  return DEFAULT_BY_TYPE[block.type ?? ""] ?? "general"
}

export function adaptationColor(block: { type?: string; adaptation?: string }): string {
  return ADAPTATION_COLOR[resolveAdaptation(block)]
}

export function adaptationLabel(block: { type?: string; adaptation?: string }): string {
  return ADAPTATION_LABEL[resolveAdaptation(block)]
}
