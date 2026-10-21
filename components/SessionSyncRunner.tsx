import { useAuth } from "@/components/auth-context"
import { syncPendingSessions } from "@/services/sessionSyncQueue"
import { useEffect } from "react"
import { AppState } from "react-native"

// Sends workouts finished without a connection: on app start, on sign-in and
// every time the app comes back to the foreground (the queue also retries on
// its own every minute while something is waiting). Not gated on `User`: an
// offline launch has no user yet, and the queue checks the session itself.
export function SessionSyncRunner() {
  const { User } = useAuth()

  useEffect(() => {
    syncPendingSessions()
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") syncPendingSessions()
    })
    return () => sub.remove()
  }, [User])

  return null
}
