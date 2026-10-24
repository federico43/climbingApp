import {
  clearRestNotifications,
  ensureRestNotificationPermission,
  showRestNotifications,
} from "@/services/restNotification"
import { useEffect, useRef } from "react"
import { AppState } from "react-native"

/**
 * While a rest is running (`endsAt`, ms since the epoch; null when none),
 * leaving the app posts a notification with when it ends and schedules one
 * for the end. Coming back, or the rest ending/being skipped, clears them.
 */
export function useRestNotification(endsAt: number | null) {
  const endsAtRef = useRef(endsAt)
  endsAtRef.current = endsAt

  useEffect(() => {
    if (endsAt != null) ensureRestNotificationPermission()
    // A rest replaced or skipped early: whatever was posted is stale. One that
    // simply ran out keeps its "Rest's over" alert (on Android the timer can
    // reach 0 in the background, right as it fires); returning clears it.
    return () => {
      if (endsAt != null && endsAt > Date.now()) clearRestNotifications()
    }
  }, [endsAt])

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") showRestNotifications(endsAtRef.current)
      else if (state === "active") clearRestNotifications()
    })
    return () => sub.remove()
  }, [])
}
