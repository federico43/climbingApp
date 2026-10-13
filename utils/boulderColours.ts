// The gym's boulder colour scale, easiest → hardest. Used by project grades,
// 4×4 boulder slots, the athlete flash level and constraint warmups. Kept in
// a plain module (no React Native imports) so the pure progression rules —
// and their Node tests — can read the order. `color` is the swatch shown in
// pickers/pills; `on` is the foreground colour when a grade is selected.
export const BoulderLevelOptions = [
  { label: "Orange", value: "orange", color: "#E8833A", on: "#3A2300" },
  { label: "Blue", value: "blue", color: "#4F8EF7", on: "#fff" },
  { label: "Green", value: "green", color: "#3FB950", on: "#06210C" },
  { label: "Yellow", value: "yellow", color: "#E3B341", on: "#3A2E00" },
  { label: "Red", value: "red", color: "#E5484D", on: "#fff" },
  { label: "Black", value: "black", color: "#111111", on: "#fff" },
]

// Position on the scale (0 = orange); -1 for anything not on it.
export function colourIndex(value: string | null | undefined): number {
  return BoulderLevelOptions.findIndex((o) => o.value === value)
}

// `delta` colours up (+) or down (−), clamped to orange…black. Unknown
// colours come back unchanged.
export function shiftColour(value: string, delta: number): string {
  const i = colourIndex(value)
  if (i < 0) return value
  const j = Math.max(0, Math.min(BoulderLevelOptions.length - 1, i + delta))
  return BoulderLevelOptions[j].value
}

export function colourLabel(value: string | null | undefined): string {
  return BoulderLevelOptions.find((o) => o.value === value)?.label ?? (value || "—")
}
