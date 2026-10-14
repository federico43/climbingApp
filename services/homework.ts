import { functions, tablesDB } from "@/components/AppWrite"
import { AI_PROTOCOL_FUNCTION_ID } from "@/services/aiProtocol"
import { DATABASE_ID, PROTOCOLS_TABLE, type ProtocolRow } from "@/services/BoulderGraphService"
import { homeworkReminders, type HomeworkReminder } from "@/utils/homework"
import type { ProgressSession } from "@/utils/planProgress"
import { ExecutionMethod } from "appwrite"
import * as Notifications from "expo-notifications"
import { Platform } from "react-native"

// Homework on the athlete's phone (docs/training-plan-implementation.md
// §9–10): writes through the aiProtocol function (athletes can't write the
// coach's rows), local reminders, and what a tapped notification asks for.

// ─── Server ──────────────────────────────────────────────────────────────────

async function callFunction(body: Record<string, any>): Promise<any> {
  const execution = await functions.createExecution({
    functionId: AI_PROTOCOL_FUNCTION_ID,
    body: JSON.stringify(body),
    async: false,
    method: ExecutionMethod.POST,
  })
  let payload: any = {}
  try { payload = execution.responseBody ? JSON.parse(execution.responseBody) : {} } catch {}
  if (execution.responseStatusCode < 200 || execution.responseStatusCode >= 300) {
    throw new Error(payload?.error ?? "Couldn't reach the server.")
  }
  return payload
}

// Coach side: push the athlete "You've got homework" (or, `extended`, its new
// deadline). Fire-and-forget.
export function notifyHomeworkAssigned(homeworkId: string, dueLabel: string, extended = false): void {
  functions
    .createExecution({
      functionId: AI_PROTOCOL_FUNCTION_ID,
      body: JSON.stringify({ action: "homeworkAssigned", homeworkId, dueLabel, extended }),
      async: true,
      method: ExecutionMethod.POST,
    })
    .catch((e) => console.log("Homework push failed", e))
}

// The function writes the row and pushes the coach. If it isn't deployed yet,
// fall back to writing the row directly (works if the athlete may write it;
// no coach push then).
async function updateHomework(id: string, body: Record<string, any>, data: Record<string, any>): Promise<void> {
  try {
    await callFunction({ action: "homeworkUpdate", homeworkId: id, ...body })
  } catch (e) {
    console.log("homeworkUpdate via function failed — trying a direct write", e)
    try {
      await tablesDB.updateRow({ databaseId: DATABASE_ID, tableId: PROTOCOLS_TABLE, rowId: id, data })
    } catch {
      throw e
    }
  }
}

export async function scheduleHomework(id: string, when: Date, day: string, whenLabel: string): Promise<void> {
  const scheduledFor = when.toISOString()
  await updateHomework(id, { scheduledFor, day, whenLabel }, { scheduledFor, homeworkStatus: null, homeworkNote: null })
}

export async function cantAttendHomework(id: string, note: string): Promise<void> {
  const clean = note.trim().slice(0, 300)
  await updateHomework(id, { cantAttend: true, note: clean },
    { homeworkStatus: "cant_attend", homeworkNote: clean || null, scheduledFor: null })
}

// ─── Local reminders ─────────────────────────────────────────────────────────

const CATEGORY = "homework"
const ID_PREFIX = "homework:"
let categoryReady: Promise<unknown> | null = null

// Buttons on homework reminders. Both open the app — "can't attend" needs the
// message box, "reschedule" the day picker.
function ensureCategory() {
  categoryReady ??= Notifications.setNotificationCategoryAsync(CATEGORY, [
    { identifier: "cant_attend", buttonTitle: "I can't attend", options: { opensAppToForeground: true } },
    { identifier: "reschedule", buttonTitle: "Reschedule", options: { opensAppToForeground: true } },
  ]).catch((e) => console.log("Notification category failed", e))
  return categoryReady
}

// Cancels this device's homework reminders and schedules them again from the
// rows — run whenever homework or sessions are loaded, so reminders follow
// what really happened (a session the coach logged, another device, a
// reinstall, a change of day). Best-effort; never throws.
export async function reconcileHomeworkReminders(
  homework: ProtocolRow[],
  sessions: ProgressSession[],
  now = new Date(),
): Promise<void> {
  if (Platform.OS === "web") return
  try {
    const { status } = await Notifications.getPermissionsAsync()
    if (status !== "granted") return
    await ensureCategory()
    const scheduled = await Notifications.getAllScheduledNotificationsAsync()
    await Promise.all(scheduled
      .filter((n) => n.identifier.startsWith(ID_PREFIX))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)))
    const wanted: HomeworkReminder[] = homework.flatMap((hw) => homeworkReminders(hw, sessions, now))
    for (const r of wanted) {
      await Notifications.scheduleNotificationAsync({
        identifier: `${ID_PREFIX}${r.homeworkId}:${r.kind}`,
        content: {
          title: r.title,
          body: r.body,
          sound: "default",
          data: { type: "homework_reminder", homeworkId: r.homeworkId, kind: r.kind },
          ...(r.withActions ? { categoryIdentifier: CATEGORY } : {}),
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.at },
      })
    }
  } catch (e) {
    console.log("Homework reminders failed", e)
  }
}

// ─── What a tapped notification asks for ─────────────────────────────────────

export type HomeworkIntent = { homeworkId: string; action: "open" | "reschedule" | "cant_attend" }

let pending: HomeworkIntent | null = null
const listeners = new Set<(i: HomeworkIntent) => void>()

export function setHomeworkIntent(intent: HomeworkIntent) {
  pending = intent
  listeners.forEach((l) => l(intent))
}

// The homework card listens; an intent set before it mounted is handed over
// on subscribe. Call `take` once it's been acted on.
export function subscribeHomeworkIntent(cb: (i: HomeworkIntent) => void): () => void {
  listeners.add(cb)
  if (pending) cb(pending)
  return () => { listeners.delete(cb) }
}

export function takeHomeworkIntent() {
  pending = null
}

// A notification response → an intent, or null when it isn't about homework.
export function intentFromResponse(r: Notifications.NotificationResponse): HomeworkIntent | null {
  const data: any = r.notification.request.content.data ?? {}
  if (typeof data.homeworkId !== "string") return null
  if (data.type !== "homework_assigned" && data.type !== "homework_reminder") return null
  const action = r.actionIdentifier === "cant_attend" ? "cant_attend"
    : r.actionIdentifier === "reschedule" ? "reschedule"
    : "open"
  return { homeworkId: data.homeworkId, action }
}
