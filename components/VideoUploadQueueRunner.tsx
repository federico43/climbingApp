import { useAuth } from "@/components/auth-context"
import { processUploadQueue } from "@/services/videoUploadQueue"
import { useEffect } from "react"
import { AppState } from "react-native"

// Drives the clip upload queue: once signed in, on app start and every time
// the app comes back to the foreground (where interrupted uploads resume).
export function VideoUploadQueueRunner() {
  const { User } = useAuth()

  useEffect(() => {
    if (!User) return
    processUploadQueue({ ignoreBackoff: true })
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") processUploadQueue({ ignoreBackoff: true })
    })
    return () => sub.remove()
  }, [User])

  return null
}
