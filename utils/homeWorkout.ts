import type { ProtocolRow } from "@/services/BoulderGraphService"

// The workout the coach picked for Home (users.homeWorkoutId), else the
// most recently built coach workout. A split-off S&C workout (same plan
// slot, planPart "sc") rides along as "Also today".
export function pickLatestWorkout(
  templates: ProtocolRow[],
  homeWorkoutId?: string | null,
): { workout: ProtocolRow | null; scPart: ProtocolRow | null; picked: boolean } {
  const coachWorkouts = templates.filter((t) => t.source !== "library" && !t.planPart)
  const pick = homeWorkoutId ? coachWorkouts.find((t) => t.$id === homeWorkoutId) ?? null : null
  const workout = pick ?? coachWorkouts
    .sort((a, b) => b.$createdAt.localeCompare(a.$createdAt))[0] ?? null
  const scPart = workout?.planId
    ? templates.find((t) => t.planPart === "sc" && t.planId === workout.planId && t.planIndex === workout.planIndex) ?? null
    : null
  return { workout, scPart, picked: pick !== null }
}
