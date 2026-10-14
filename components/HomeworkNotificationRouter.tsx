import { intentFromResponse, setHomeworkIntent } from "@/services/homework"
import * as Notifications from "expo-notifications"
import { useRouter } from "expo-router"
import { useEffect, useRef } from "react"
import { Platform } from "react-native"

// A tapped homework notification (the coach's "You've got homework" push, or
// a reminder and its I can't attend / Reschedule buttons) → hands the
// homework card an intent and goes to the athlete's home, where the card is.
// useLastNotificationResponse also covers a cold start from the notification.
export function HomeworkNotificationRouter({ hasPlan }: { hasPlan: boolean }) {
  if (Platform.OS === "web") return null
  return <Router hasPlan={hasPlan} />
}

function Router({ hasPlan }: { hasPlan: boolean }) {
  const response = Notifications.useLastNotificationResponse()
  const router = useRouter()
  const handled = useRef<string | null>(null)

  useEffect(() => {
    if (!response) return
    const key = `${response.notification.request.identifier}|${response.actionIdentifier}|${response.notification.date}`
    if (handled.current === key) return
    handled.current = key
    const intent = intentFromResponse(response)
    if (!intent) return
    setHomeworkIntent(intent)
    router.navigate((hasPlan ? "/(tabs)/(buttonTabs)/plan" : "/(tabs)/(buttonTabs)") as any)
  }, [response, hasPlan])

  return null
}
