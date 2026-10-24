import { restNotificationPlan } from "@/utils/restNotification"
import * as Notifications from "expo-notifications"
import { Platform } from "react-native"

// Local notifications for a rest timer while the app is in the background:
// a silent one saying when the rest ends, replaced by an alert when it does.
// Both share one identifier, so there's never more than one on screen. Local
// notifications need no push token, so this also works on the simulator.

const REST_ID = "rest-timer"
const COUNTDOWN_CHANNEL = "rest-countdown"
const DONE_CHANNEL = "rest-done"

let channelsReady: Promise<void> | null = null
function ensureChannels(): Promise<void> {
  if (Platform.OS !== "android") return Promise.resolve()
  channelsReady ??= Promise.all([
    Notifications.setNotificationChannelAsync(COUNTDOWN_CHANNEL, {
      name: "Rest timer",
      importance: Notifications.AndroidImportance.LOW,
      sound: null,
    }),
    Notifications.setNotificationChannelAsync(DONE_CHANNEL, {
      name: "Rest over",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
      vibrationPattern: [0, 250, 250, 250],
    }),
  ]).then(() => {})
  return channelsReady
}

// Calls run one after another, so a quick leave-and-return can't leave the
// countdown behind (show finishing after the clear that followed it).
let queue: Promise<void> = Promise.resolve()
function enqueue(task: () => Promise<void>): Promise<void> {
  queue = queue.then(task).catch((e) => console.log("Rest notification failed", e))
  return queue
}

/**
 * Asks for notification permission if it was never asked (the push sign-up
 * skips the simulator, and an athlete may start a workout before it runs).
 * Called when a rest starts, while the app is in front. Best-effort.
 */
export async function ensureRestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false
  try {
    const current = await Notifications.getPermissionsAsync()
    if (current.granted) return true
    if (!current.canAskAgain) return false
    return (await Notifications.requestPermissionsAsync()).granted
  } catch (e) {
    console.log("Rest notification permission failed", e)
    return false
  }
}

/** The app is going to the background with a rest ending at `endsAt`. */
export function showRestNotifications(endsAt: number | null): Promise<void> {
  if (Platform.OS === "web") return Promise.resolve()
  return enqueue(async () => {
    const plan = restNotificationPlan(endsAt, Date.now())
    if (!plan) return
    if (!(await Notifications.getPermissionsAsync()).granted) return
    await ensureChannels()
    await Notifications.scheduleNotificationAsync({
      identifier: REST_ID,
      content: { ...plan.countdown, sound: false, data: { type: "rest_timer" } },
      trigger: Platform.OS === "android" ? { channelId: COUNTDOWN_CHANNEL } : null,
    })
    await Notifications.scheduleNotificationAsync({
      identifier: REST_ID,
      content: { ...plan.done, sound: "default", data: { type: "rest_timer" } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: plan.fireAt, channelId: DONE_CHANNEL },
    })
  })
}

/** Back in the app, rest skipped or over, or the workout closed. */
export function clearRestNotifications(): Promise<void> {
  if (Platform.OS === "web") return Promise.resolve()
  return enqueue(async () => {
    await Notifications.cancelScheduledNotificationAsync(REST_ID)
    await Notifications.dismissNotificationAsync(REST_ID)
  })
}
