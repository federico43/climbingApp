import { functions } from "@/components/AppWrite"
import { AI_PROTOCOL_FUNCTION_ID } from "@/services/aiProtocol"
import { planReminders, type ScheduledSlot } from "@/utils/planSchedule"
import { ExecutionMethod } from "appwrite"
import * as Notifications from "expo-notifications"
import { Platform } from "react-native"

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

// ─── Local reminders ─────────────────────────────────────────────────────────

const ID_PREFIX = "plan:"

// Cancels this device's plan-workout reminders and schedules them again from
// the schedule — run whenever the Plan page works it out, so reminders follow
// moved days, finished workouts and changed training days. Only the next
// week's workouts get one (planReminders). Best-effort; never throws.
export async function reconcilePlanReminders(
  slots: ScheduledSlot[],
  trainingTime: string | null,
  labels: Record<number, string>,
  now = new Date(),
): Promise<void> {
  if (Platform.OS === "web") return
  try {
    const { status } = await Notifications.getPermissionsAsync()
    if (status !== "granted") return
    const scheduled = await Notifications.getAllScheduledNotificationsAsync()
    await Promise.all(scheduled
      .filter((n) => n.identifier.startsWith(ID_PREFIX))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)))
    for (const r of planReminders(slots, trainingTime, now, labels)) {
      await Notifications.scheduleNotificationAsync({
        identifier: `${ID_PREFIX}${r.index}`,
        content: { title: r.title, body: r.body, sound: "default", data: { type: "plan_reminder", index: r.index } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.at },
      })
    }
  } catch (e) {
    console.log("Plan reminders failed", e)
  }
}
