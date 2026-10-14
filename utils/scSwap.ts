import type { ExerciseRow } from "@/services/BoulderGraphService"
import { exerciseDraftFromLibrary, type ExerciseDraft } from "@/utils/scPlanBuilder"
import { FOCUS_REP_RANGE, type Focus } from "@/utils/scProgression"

// Swapping an S&C exercise mid-workout for another library exercise. The
// swap lives only in the athlete's session — the coach's block is never
// edited — and the rounds are logged under the new exercise (its id and
// name), with `swappedFrom` pointing back at what the block prescribed and
// `swapReason` saying why. Pure — the UI is in StrengthConditioningBlock.

// "easier": the app offered it after the athlete missed the minimum with
// nothing left to lower (RoundDrop.pickEasier) — the coach is told to add
// an easier version to the ladder. "choice": the athlete replaced it
// themselves (machine taken, injury, preference…). Logs written before the
// reason existed are easier swaps (it was the only kind).
export type SwapReason = "easier" | "choice"

export function swapReasonOf(scData: { swappedFrom?: unknown; swapReason?: string } | null | undefined): SwapReason | null {
  if (!scData?.swappedFrom) return null
  return scData.swapReason === "choice" ? "choice" : "easier"
}

// The block exercise fields a swap reads (RepExercise / BothSidesExercise
// in StrengthConditioningBlock, Exercise in workoutBlocks).
export interface SwappableExercise {
  type: "reps" | "both_sides" | "7/3s"
  name: string
  exerciseId?: string
  reps?: string
  unit?: "reps" | "seconds"
  focus?: Focus
  movementType?: string
}

const isMobility = (movementType?: string) => movementType === "mobility"

// The exercise as it's done after the swap. It takes the picked exercise's
// identity, photo, notes, pattern, ladder and setting hints. The target
// stays the block's (same reps / seconds, same focus) when the two are
// measured the same way — both rep-counted or both timed, both mobility or
// both not. Otherwise the picked exercise's own default is used, set to the
// block's focus when it's rep-counted (as the block editor would).
export function swappedExercise<T extends SwappableExercise>(original: T, row: ExerciseRow): T & ExerciseDraft {
  const draft = exerciseDraftFromLibrary(row) as ExerciseDraft & SwappableExercise
  const sameMeasure = original.type !== "7/3s" && row.type !== "7/3s"
    && (original.unit ?? "reps") === (row.unit ?? "reps")
    && isMobility(original.movementType) === isMobility(row.movementType)
  if (sameMeasure) {
    return { ...original, ...draft, reps: original.reps ?? draft.reps, unit: original.unit ?? draft.unit, focus: original.focus } as T & ExerciseDraft
  }
  const focus = isMobility(row.movementType) || row.type === "7/3s" ? undefined : original.focus
  const repCounted = row.type !== "7/3s" && (row.unit ?? "reps") !== "seconds" && !isMobility(row.movementType)
  let reps = draft.reps
  if (repCounted && focus) reps = `${FOCUS_REP_RANGE[focus].low}-${FOCUS_REP_RANGE[focus].high}`
  // A rep-counted exercise with no focus and no default still needs a target.
  if (row.type !== "7/3s" && !reps) reps = row.defaultReps || original.reps
  return { ...original, ...draft, reps, focus } as T & ExerciseDraft
}

export interface SwapFilter {
  query?: string
  movementType?: string | null // null / undefined = all patterns
}

// Library exercises the athlete can swap to: never the exercise itself (or
// the one already swapped in), never 7/3s (its own timer flow, no target to
// carry over). The original's pattern first, then by name. `easierOnly`
// (the drop banner's "Pick an easier exercise") also leaves out mobility.
export function swapCandidates(
  library: ExerciseRow[],
  excludeIds: (string | undefined)[],
  pattern: string | undefined,
  filter: SwapFilter = {},
  easierOnly = false,
): ExerciseRow[] {
  const q = (filter.query ?? "").trim().toLowerCase()
  const exclude = new Set(excludeIds.filter(Boolean))
  return library
    .filter((row) => !exclude.has(row.$id) && row.type !== "7/3s")
    .filter((row) => !easierOnly || !isMobility(row.movementType))
    .filter((row) => !filter.movementType || row.movementType === filter.movementType)
    .filter((row) => !q || row.name.toLowerCase().includes(q))
    .sort((a, b) => Number(b.movementType === pattern) - Number(a.movementType === pattern) || a.name.localeCompare(b.name))
}
