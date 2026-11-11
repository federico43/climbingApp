import { useTimerEndSound } from "@/hooks/useTimerEndSound"
import {
  clearBlockTimerNotifications,
  ensureRestNotificationPermission,
  showBlockTimerNotifications,
} from "@/services/restNotification"
import { blockTimerNotificationPlan } from "@/utils/restNotification"
import { useEffect, useRef } from "react"
import { AppState } from "react-native"

/**
 * A block's time limit running out at `endsAt` (ms since the epoch; null when
 * not running). With the app open it beeps at the end. Leaving the app posts
 * a silent "<label> · ends at …" notification and schedules a loud "Time's up"
 * one for the end; coming back, or the timer stopping early, clears them.
 */
export function useBlockTimerAlert(endsAt: number | null, label: string) {
  const latest = useRef({ endsAt, label })
  latest.current = { endsAt, label }
  useTimerEndSound(endsAt)

  useEffect(() => {
    if (endsAt != null) ensureRestNotificationPermission()
    // Stopped, left or replaced early: whatever was posted is stale. One that
    // simply ran out keeps its "Time's up"; returning to the app clears it.
    return () => {
      if (endsAt != null && endsAt > Date.now()) clearBlockTimerNotifications()
    }
  }, [endsAt])

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        const { endsAt: end, label: name } = latest.current
        showBlockTimerNotifications((now) => blockTimerNotificationPlan(end, now, name))
      } else if (state === "active") clearBlockTimerNotifications()
    })
    return () => sub.remove()
  }, [])
}
