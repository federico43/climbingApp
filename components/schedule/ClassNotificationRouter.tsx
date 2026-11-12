import { refreshClassSchedule } from "@/utils/classScheduleStore"
import * as Notifications from "expo-notifications"
import { useRouter } from "expo-router"
import { useEffect, useRef } from "react"
import { Platform } from "react-native"

// Class pushes (types class_*: joins, requests, answers, roster changes,
// packages, reminders). Before this, tapping one just opened the app wherever
// it was, and one that arrived with the app open left the calendar stale
// until a manual refresh.
// - Arrives with the app open → reload the class calendar.
// - Tapped (also from a cold start) → open the calendar: Classes for the
//   coach, My week for an athlete.
const isClass = (data: unknown) => {
  const t = (data as { type?: unknown } | undefined)?.type
  return typeof t === "string" && t.startsWith("class_")
}

export function ClassNotificationRouter({ role }: { role?: string | null }) {
  if (Platform.OS === "web") return null
  return <Router role={role} />
}

function Router({ role }: { role?: string | null }) {
  const response = Notifications.useLastNotificationResponse()
  const router = useRouter()
  const handled = useRef<string | null>(null)

  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((n) => {
      if (isClass(n.request.content.data)) refreshClassSchedule()
    })
    return () => sub.remove()
  }, [])

  useEffect(() => {
    if (!response || !isClass(response.notification.request.content.data)) return
    const key = `${response.notification.request.identifier}|${response.notification.date}`
    if (handled.current === key) return
    handled.current = key
    refreshClassSchedule()
    router.navigate((role === "coach" ? "/(tabs)/(buttonTabs)/classes" : "/(tabs)/(buttonTabs)/schedule") as any)
  }, [response, role, router])

  return null
}
