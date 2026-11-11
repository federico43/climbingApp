// What the rest-timer notifications say when the athlete leaves the app mid-rest
// (see services/restNotification.ts). Pure, so it can be tested in plain Node.
//
// A notification can't tick down on its own without native code (an iOS Live
// Activity / an Android chronometer), so the first one states when the rest
// ends on the clock — that stays true — and a second one fires at the end.

export type RestNotificationText = { title: string; body: string }

export type RestNotificationPlan = {
  // Shown right away, silently, when the app goes to the background.
  countdown: RestNotificationText
  // Fires (with sound) when the rest is over. Same identifier, so it replaces
  // the countdown instead of stacking under it.
  done: RestNotificationText
  // When `done` fires, in ms since the epoch.
  fireAt: number
}

// Rests ending sooner than this aren't worth a notification.
export const MIN_REST_NOTIFICATION_SECS = 3

export function formatRestLeft(secs: number): string {
  const s = Math.max(0, Math.ceil(secs))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

export function formatClockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })
}

/**
 * The notifications for a rest ending at `endsAt`, as seen at `now`, or null
 * when there's no rest worth notifying about (none running, or nearly over).
 */
export function restNotificationPlan(
  endsAt: number | null,
  now: number,
  clock: (ms: number) => string = formatClockTime,
): RestNotificationPlan | null {
  if (endsAt == null) return null
  const left = (endsAt - now) / 1000
  if (left < MIN_REST_NOTIFICATION_SECS) return null
  return {
    countdown: {
      title: `Resting · ends at ${clock(endsAt)}`,
      body: `${formatRestLeft(left)} left. We'll let you know when it's over.`,
    },
    done: {
      title: "Rest's over",
      body: "Time to get back to it.",
    },
    fireAt: endsAt,
  }
}

/**
 * The same, for a block's time limit (`label` is the block's name, or a part
 * of it such as "Flash part"). Null under the same conditions.
 */
export function blockTimerNotificationPlan(
  endsAt: number | null,
  now: number,
  label: string,
  clock: (ms: number) => string = formatClockTime,
): RestNotificationPlan | null {
  if (endsAt == null) return null
  const left = (endsAt - now) / 1000
  if (left < MIN_REST_NOTIFICATION_SECS) return null
  const name = label.trim() || "Block"
  return {
    countdown: {
      title: `${name} · ends at ${clock(endsAt)}`,
      body: `${formatRestLeft(left)} left. We'll let you know when time's up.`,
    },
    done: {
      title: `Time's up · ${name}`,
      body: "Open the app to keep going.",
    },
    fireAt: endsAt,
  }
}

// A timer whose end we only notice this late was ticking while the app slept;
// its notification already rang, so coming back shouldn't beep again.
const LATE_MS = 2500

/**
 * Whether a timer ending at `endsAt` should beep now: the app is in front and
 * the end is happening (not long past).
 */
export function shouldPlayTimerEnd(endsAt: number, now: number, appActive: boolean): boolean {
  return appActive && now >= endsAt - 1000 && now - endsAt < LATE_MS
}
