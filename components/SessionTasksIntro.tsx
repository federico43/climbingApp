import { useAuth } from "@/components/auth-context"
import { Slides, type Slide } from "@/components/paper"
import { useWorkoutContext } from "@/contexts/WorkoutContext"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { useEffect, useRef, useState } from "react"

// The intro to next-session tasks (docs/session-tasks.md): full-screen slides
// (components/paper/Slides.tsx, the Conditioning basics look). Shown once per
// phone, the first time the "Next session" card is on Plan or Home
// (useTasksIntroFirstTime), never over a running workout; the card's
// "How it works" opens it again. One instance, in the tabs layout, so Plan
// and Home can't both open it.

const SEEN_KEY = "feature-intro-seen:session-tasks"

export const TASKS_INTRO: Slide[] = [
  {
    poster: "One thing",
    icon: "flag",
    title: "A few minutes, every session",
    text: "Spend a moment on your project, or on a movement you haven't figured out yet. Up to 2 tasks at a time.",
  },
  {
    poster: "Set it",
    icon: "create",
    title: "Write it at the end",
    text: "On the workout summary, add a task and pick a number of tries or a time limit. You can change it later from the Next session card.",
  },
  {
    poster: "Next session",
    icon: "play",
    title: "Right after the warm-up",
    text: "Each task comes as its own block, right after the warm-up. That includes the sessions you do on your own.",
  },
  {
    poster: "Your call",
    icon: "checkmark-done",
    title: "It stays until you close it",
    text: "At the end of the block, keep it for next session or close it. Not today? Skip it, and it stays for next time.",
  },
]

const openers = new Set<(firstTime: boolean) => void>()
// A card asked before the slides were mounted (effects run children first).
let firstTimeAsked = false

// "How it works" on the card.
export function openTasksIntro() {
  openers.forEach((o) => o(false))
}

// The card on Plan / Home: shows the slides if this phone hasn't seen them.
// `ready` holds it back while another pop-up on the page needs the screen.
export function useTasksIntroFirstTime(ready: boolean) {
  useEffect(() => {
    if (!ready) return
    firstTimeAsked = true
    openers.forEach((o) => o(true))
  }, [ready])
}

export function SessionTasksIntro() {
  const { role } = useAuth()
  const workout = useWorkoutContext()
  const [show, setShow] = useState(false)
  const [wantFirst, setWantFirst] = useState(false)
  const inWorkout = workout.modalVisible && !workout.workoutMinimized

  useEffect(() => {
    const open = (firstTime: boolean) => (firstTime ? setWantFirst(true) : setShow(true))
    openers.add(open)
    if (firstTimeAsked) setWantFirst(true)
    return () => { openers.delete(open) }
  }, [])

  // The first showing: athletes only, not over a workout, once per phone
  // (checked once per app run).
  const checked = useRef(false)
  useEffect(() => {
    if (!wantFirst || checked.current || role !== "athlete" || inWorkout) return
    checked.current = true
    AsyncStorage.getItem(SEEN_KEY).then((v) => { if (v !== "1") setShow(true) }).catch(() => {})
  }, [wantFirst, role, inWorkout])

  const close = () => {
    setShow(false)
    AsyncStorage.setItem(SEEN_KEY, "1").catch(() => {})
  }

  return <Slides visible={show} label="Next-session tasks" slides={TASKS_INTRO} finishLabel="Got it" onClose={close} />
}
