// The plan's benchmark (coach 2026-11-11, "agregar el benchmark al plan de
// entrenamiento"): the tests that measure a 6-week block, done at its start
// and again in its last week so the block review compares like with like.
// Today that is the Density test (climbing, sets the flash colour) and the
// Edge lift max test (fingers, sets the Edge Lifts max). They go out
// together as one homework on the plan's test days (workoutSpec.withTest).
// Pure — no fetching or UI.
import type { ExerciseRow } from "@/services/BoulderGraphService"
import { EDGE_WARMUP, isEdgeLift } from "@/utils/edgeWarmup"
import { exerciseDraftFromLibrary } from "@/utils/scPlanBuilder"

export const BENCHMARK_NAME = "Benchmark"
export const MAX_TEST_NAME = "Edge lift max test"

const sameName = (a: string | undefined, b: string) => (a ?? "").trim().toLowerCase() === b.toLowerCase()

// The Edge lift max test as an S&C block: one Edge Lifts exercise flagged
// `maxTest` (the athlete logs the heaviest weight held and it becomes the
// max). Null when the library has no Edge Lifts exercise.
export function edgeLiftMaxTestBlock(exercises: ExerciseRow[]) {
  const row = exercises.find((e) => isEdgeLift(e))
  if (!row) return null
  return {
    type: "strength_conditioning" as const,
    blockName: MAX_TEST_NAME,
    description: `Warm up by feel, then add weight each try (3 min rest) until you can't hold ${EDGE_WARMUP.testHoldSecs} s.`,
    rounds: 1,
    restBetweenRounds: 0,
    exercises: [{ ...exerciseDraftFromLibrary(row), maxTest: true }],
  }
}

// Whether a set of homework blocks is the plan's benchmark: the Density
// test and the Edge lift max test, nothing else. Used for its name.
export function isBenchmark(blocks: { type?: string; blockName?: string }[]): boolean {
  if (blocks.length < 2) return false
  return blocks.every((b) =>
    (b.type === "exploration_session" && sameName(b.blockName, "Density test")) ||
    (b.type === "strength_conditioning" && sameName(b.blockName, MAX_TEST_NAME)))
}
