import { restNotificationPlan, type RestNotificationPlan } from "@/utils/restNotification"
import * as Notifications from "expo-notifications"
import { Platform } from "react-native"

// Local notifications for a rest timer (or a block's time limit) while the app is in the background:
// a silent one saying when the rest ends, replaced by an alert when it does.
// Both share one identifier, so there's never more than one on screen. Local
// notifications need no push token, so this also works on the simulator.

const REST_ID = "rest-timer"
const COUNTDOWN_CHANNEL = "rest-countdown"
const DONE_CHANNEL = "rest-done"

// Block timers (a block's time limit) get their own channels, so an athlete
// can tune them apart from the rest timer in Android's settings.
const BLOCK_ID = "block-timer"
const BLOCK_COUNTDOWN_CHANNEL = "block-timer-countdown"
const BLOCK_DONE_CHANNEL = "block-timer-done"

type Channels = { countdown: string; done: string }
const REST_CHANNELS: Channels = { countdown: COUNTDOWN_CHANNEL, done: DONE_CHANNEL }
const BLOCK_CHANNELS: Channels = { countdown: BLOCK_COUNTDOWN_CHANNEL, done: BLOCK_DONE_CHANNEL }

let channelsReady: Promise<void> | null = null
function ensureChannels(): Promise<void> {
  if (Platform.OS !== "android") return Promise.resolve()
  const quiet = (id: string, name: string) =>
    Notifications.setNotificationChannelAsync(id, {
      name,
      importance: Notifications.AndroidImportance.LOW,
      sound: null,
    })
  const loud = (id: string, name: string) =>
    Notifications.setNotificationChannelAsync(id, {
      name,
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
      vibrationPattern: [0, 250, 250, 250],
    })
  channelsReady ??= Promise.all([
    quiet(COUNTDOWN_CHANNEL, "Rest timer"),
    loud(DONE_CHANNEL, "Rest over"),
    quiet(BLOCK_COUNTDOWN_CHANNEL, "Block timer"),
    loud(BLOCK_DONE_CHANNEL, "Block time's up"),
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

// Posts the silent countdown now and schedules the loud one for the end,
// both under `id` so the second replaces the first.
function showTimerNotifications(
  id: string,
  channels: Channels,
  type: string,
  makePlan: (now: number) => RestNotificationPlan | null,
): Promise<void> {
  if (Platform.OS === "web") return Promise.resolve()
  return enqueue(async () => {
    const plan = makePlan(Date.now())
    if (!plan) return
    if (!(await Notifications.getPermissionsAsync()).granted) return
    await ensureChannels()
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: { ...plan.countdown, sound: false, data: { type } },
      trigger: Platform.OS === "android" ? { channelId: channels.countdown } : null,
    })
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: { ...plan.done, sound: "default", data: { type } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: plan.fireAt, channelId: channels.done },
    })
  })
}

function clearTimerNotifications(id: string): Promise<void> {
  if (Platform.OS === "web") return Promise.resolve()
  return enqueue(async () => {
    await Notifications.cancelScheduledNotificationAsync(id)
    await Notifications.dismissNotificationAsync(id)
  })
}

/** The app is going to the background with a rest ending at `endsAt`. */
export function showRestNotifications(endsAt: number | null): Promise<void> {
  return showTimerNotifications(REST_ID, REST_CHANNELS, "rest_timer", (now) => restNotificationPlan(endsAt, now))
}

/** Back in the app, rest skipped or over, or the workout closed. */
export function clearRestNotifications(): Promise<void> {
  return clearTimerNotifications(REST_ID)
}

/** The app is going to the background with a block's time limit running. */
export function showBlockTimerNotifications(
  makePlan: (now: number) => RestNotificationPlan | null,
): Promise<void> {
  return showTimerNotifications(BLOCK_ID, BLOCK_CHANNELS, "block_timer", makePlan)
}

/** Back in the app, or the block's timer stopped, ended or was left. */
export function clearBlockTimerNotifications(): Promise<void> {
  return clearTimerNotifications(BLOCK_ID)
}
