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

// "30s", "20-30 sec", "45 seconds", "30 seg", "30″" — a target written in
// seconds even though the exercise is stored as reps (mobility added by hand
// before holds could be picked in the block editor).
const SECONDS_TARGET = /^\s*\d+(\s*[-–]\s*\d+)?\s*(s|secs?|seconds?|seg|segs|segundos?|"|″)\s*$/i

// Whether an exercise is done against the clock: unit "seconds", or a
// mobility exercise whose target is written in seconds. Mobility has no
// rep-range logic, so reading its text is safe; strength exercises go by
// unit only.
export function isTimedExercise(ex: { unit?: ExerciseUnit; reps?: string; movementType?: string }): boolean {
  if (ex.unit === "seconds") return true
  return ex.movementType === "mobility" && SECONDS_TARGET.test(ex.reps ?? "")
}
