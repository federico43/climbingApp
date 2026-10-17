import { functions } from "@/components/AppWrite"
import { AI_PROTOCOL_FUNCTION_ID } from "@/services/aiProtocol"
import { ExecutionMethod } from "appwrite"

// The weekly scheduler on the athlete's phone (docs/training-plan.md §11):
// writes go through the aiProtocol function's planSchedule action, since
// athletes can't write their coach's training_plans row. The dates are
// worked out by utils/planSchedule.ts.

async function callSchedule(body: Record<string, any>): Promise<void> {
  const execution = await functions.createExecution({
    functionId: AI_PROTOCOL_FUNCTION_ID,
    body: JSON.stringify({ action: "planSchedule", ...body }),
    async: false,
    method: ExecutionMethod.POST,
  })
  let payload: any = {}
  try { payload = execution.responseBody ? JSON.parse(execution.responseBody) : {} } catch {}
  if (execution.responseStatusCode < 200 || execution.responseStatusCode >= 300) {
    throw new Error(payload?.error ?? "Couldn't reach the server.")
  }
}

// The athlete's own training days (0 = Sunday; empty = the default days) and
// optional training time ("18:00").
export async function saveTrainingDays(planId: string, trainingDays: number[], trainingTime: string | null): Promise<void> {
  await callSchedule({ planId, trainingDays, trainingTime })
}

// Plan workout `index` moved by hand to `day` ("YYYY-MM-DD"); the coach is pushed.
export async function movePlanWorkout(planId: string, index: number, day: string, whenLabel: string): Promise<void> {
  await callSchedule({ planId, move: { index, day, whenLabel } })
}
