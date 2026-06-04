// Exercises are measured either in repetitions or in seconds (timed holds,
// planks, hangs, …). The unit is independent of the exercise type, so it lives
// on its own field. Undefined defaults to "reps" for backward compatibility.
export type ExerciseUnit = "reps" | "seconds"

// Compact value + unit, e.g. "4-6 reps" or "30s".
export function amountLabel(value: string | number | null | undefined, unit?: ExerciseUnit): string {
  const v = value == null ? "" : String(value)
  return unit === "seconds" ? `${v}s` : `${v} reps`
}

// Plain noun for labels/units, e.g. "reps" | "seconds".
export function unitNoun(unit?: ExerciseUnit): string {
  return unit === "seconds" ? "seconds" : "reps"
}
