import { ensureRestNotificationPermission } from "@/services/restNotification"
import { reminderDates, type CardioPlan } from "@/utils/cardio"
import * as Notifications from "expo-notifications"
import { Platform } from "react-native"

// Local reminders on cardio days (docs/cardio-rope.md): one-shot notifications
// for the next two weeks, rebuilt every time the plan screen loads or the plan
// changes — so a day already done never rings and a changed day or time
// takes effect at once. Local, so they work on the simulator too.

const PREFIX = "cardio-reminder-"
const CHANNEL = "cardio-reminder"

let queue: Promise<void> = Promise.resolve()

export function syncCardioReminders(plan: CardioPlan | null, today: string, sessionDates: string[]): Promise<void> {
  if (Platform.OS === "web") return Promise.resolve()
  queue = queue.then(async () => {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync()
    await Promise.all(scheduled
      .filter((n) => n.identifier.startsWith(PREFIX))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)))
    if (!plan?.committedAt) return
    if (!(await ensureRestNotificationPermission())) return
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: "Cardio reminders", importance: Notifications.AndroidImportance.DEFAULT, sound: "default",
      })
    }
    const now = new Date()
    const dates = reminderDates(plan, today, now.getHours() * 60 + now.getMinutes(), sessionDates)
    for (const r of dates) {
      const [y, m, d] = r.date.split("-").map(Number)
      await Notifications.scheduleNotificationAsync({
        identifier: PREFIX + r.date,
        content: {
          title: "Jump rope today",
          body: "Your cardio session is waiting — about 15 minutes.",
          sound: "default",
          data: { type: "cardio_reminder" },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(y, m - 1, d, r.hour, r.minute),
          channelId: CHANNEL,
        },
      })
    }
  }).catch((e) => console.log("Cardio reminders failed", e))
  return queue
}
