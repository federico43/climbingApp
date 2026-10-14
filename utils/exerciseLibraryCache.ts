import { listExercises, type ExerciseRow } from "@/services/BoulderGraphService"

// One exercise-library fetch shared by every S&C block in a workout (and the
// coach's editor flag), instead of one per block. Level chains are resolved
// from it at workout time (see resolveExerciseChain in levelChain.ts).
// ExerciseForm invalidates it on save so a chain edit shows up right away.

const TTL_MS = 5 * 60_000

let cache: { at: number; promise: Promise<ExerciseRow[]> } | null = null

export function getExerciseLibrary(): Promise<ExerciseRow[]> {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    const promise = listExercises()
    cache = { at: Date.now(), promise }
    // A failed fetch (offline) shouldn't stick — the next caller retries.
    promise.catch(() => { if (cache?.promise === promise) cache = null })
  }
  return cache.promise
}

export function invalidateExerciseLibrary() {
  cache = null
}
