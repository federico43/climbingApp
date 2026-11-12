import { playTimerEndIfLive, preloadTimerSound } from "@/services/timerSound"
import { useEffect } from "react"

// Fired a hair early so it beats the timers' own 200–500 ms polls, which
// usually clear `endsAt` the moment they see zero.
const LEAD_MS = 150

/**
 * Beeps (and vibrates) when the timer ending at `endsAt` (ms since the epoch;
 * null when none) runs out while the app is open. A timer stopped, skipped or
 * replaced early stays quiet; one whose `endsAt` is cleared right as it ends
 * still beeps.
 */
export function useTimerEndSound(endsAt: number | null) {
  useEffect(() => {
    if (endsAt == null) return
    preloadTimerSound()
    let played = false
    const id = setTimeout(() => { played = playTimerEndIfLive(endsAt) }, Math.max(0, endsAt - Date.now() - LEAD_MS))
    return () => {
      clearTimeout(id)
      if (!played) playTimerEndIfLive(endsAt)
    }
  }, [endsAt])
}
