import { Audio } from "expo-av"
import * as Haptics from "expo-haptics"
import { shouldPlayTimerEnd } from "@/utils/restNotification"
import { useEffect } from "react"
import { AppState, Platform } from "react-native"

// The "time's up" cue for rest and block timers while the app is open: the
// same beep the interval and hang timers use, plus a vibration (heard even
// with the ringer off on Android, felt with headphones in). In the background
// the scheduled notification rings instead (services/restNotification.ts).

let sound: Audio.Sound | null = null
let loading: Promise<Audio.Sound | null> | null = null

/** Loads the beep ahead of time so it plays on the dot. Best-effort. */
export function preloadTimerSound(): Promise<Audio.Sound | null> {
  if (Platform.OS === "web") return Promise.resolve(null)
  loading ??= (async () => {
    try {
      // Rings with the iPhone's silent switch on, mixing with any music.
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true })
      const { sound: s } = await Audio.Sound.createAsync(require("@/assets/images/sounds/beepExercise.mp3"))
      sound = s
      return s
    } catch (e) {
      console.log("Timer sound failed to load", e)
      loading = null
      return null
    }
  })()
  return loading
}

// While the video camera is open it holds the microphone. Playing the beep
// then makes expo-av set the shared iOS audio session again (category and
// options), which can interrupt the camera's capture session: the preview
// freezes and the clip never finishes saving. Whoever opens the camera holds
// the sound, and the cue is vibration only until the last hold lifts.
let soundHolds = 0

/** Keeps the timer beep silent (vibration only) while `active` (default: while mounted). */
export function useHoldTimerSound(active: boolean = true) {
  useEffect(() => {
    if (!active) return
    soundHolds++
    return () => { soundHolds-- }
  }, [active])
}

/** Plays the cue now. */
export function playTimerEnd(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
  if (soundHolds > 0) {
    console.log("Timer sound skipped: the camera is open (vibration only)")
    return
  }
  if (sound) sound.replayAsync().catch(() => {})
  else preloadTimerSound().then((s) => s?.replayAsync().catch(() => {}))
}

export function playTimerEndIfLive(endsAt: number): boolean {
  if (!shouldPlayTimerEnd(endsAt, Date.now(), AppState.currentState === "active")) return false
  playTimerEnd()
  return true
}
