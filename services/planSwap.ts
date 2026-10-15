import { functions, tablesDB } from "@/components/AppWrite"
import { AI_PROTOCOL_FUNCTION_ID } from "@/services/aiProtocol"
import { DATABASE_ID, TRAINING_PLANS_TABLE, getActiveTrainingPlan, type TrainingPlanRow } from "@/services/BoulderGraphService"
import { replacePlanPick } from "@/utils/scSwap"
import { ExecutionMethod } from "appwrite"

// "Change exercise → for the rest of the plan" (utils/scSwap.ts). Written
// through the aiProtocol function's planSwapExercise action — athletes can't
// write the coach's plan / workout rows — which also updates the workouts
// already built for later slots and pushes the coach.

export interface PlanSwapArgs {
  planId: string
  fromExerciseId: string
  fromExerciseName: string
  toExerciseId: string
  afterPlanIndex?: number // this workout's slot: later built workouts follow
}

export async function swapExerciseInPlan(args: PlanSwapArgs): Promise<{ workoutsUpdated: number }> {
  let payload: any = {}
  let status = 0
  try {
    const execution = await functions.createExecution({
      functionId: AI_PROTOCOL_FUNCTION_ID,
      body: JSON.stringify({ action: "planSwapExercise", ...args }),
      async: false,
      method: ExecutionMethod.POST,
    })
    status = execution.responseStatusCode
    try { payload = execution.responseBody ? JSON.parse(execution.responseBody) : {} } catch {}
  } catch (e: any) {
    payload = { error: e?.message }
  }
  if (status >= 200 && status < 300 && payload?.ok) return { workoutsUpdated: payload.workoutsUpdated ?? 0 }
  // A real refusal from the action (not your plan, not a pick…) stands.
  if (status === 403 || status === 404 || status === 409) throw new Error(payload?.error ?? "Couldn't change the plan.")

  // The function may not have the action yet: write the plan directly (works
  // only if the athlete may write it). Built workouts aren't touched then.
  const row: any = await tablesDB.getRow({ databaseId: DATABASE_ID, tableId: TRAINING_PLANS_TABLE, rowId: args.planId }).catch(() => null)
  let patterns: any[] = []
  try { patterns = JSON.parse(row?.scPatterns ?? "[]") } catch {}
  const next = row ? replacePlanPick(patterns, args.fromExerciseId, args.toExerciseId) : null
  if (!next) throw new Error(payload?.error ?? "Couldn't change the plan.")
  await tablesDB.updateRow({
    databaseId: DATABASE_ID, tableId: TRAINING_PLANS_TABLE, rowId: args.planId, data: { scPatterns: JSON.stringify(next) },
  })
  return { workoutsUpdated: 0 }
}

// The plan behind the running workout, if it's the athlete's active one.
export async function planForWorkout(athleteId: string, planId: string): Promise<TrainingPlanRow | null> {
  const plan = await getActiveTrainingPlan(athleteId).catch(() => null)
  return plan?.$id === planId ? plan : null
}
