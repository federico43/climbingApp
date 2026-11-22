import { Slides, type Slide } from "@/components/paper"
import { useEffect, useState } from "react"

// The intro to next-session tasks (docs/session-tasks.md): full-screen slides
// (components/paper/Slides.tsx, the Conditioning basics look). The first time
// is inside a workout: the first-task block (TaskIntroStep in
// components/SessionTasks.tsx) shows them, then lets the athlete write the
// task. This pop-up is the way back in: "How it works" on the Next session
// card. One instance, in the tabs layout.

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
    title: "Write it down",
    text: "Write the task and pick a number of tries or a time limit. Change it any time on the Next session card, at the end of a workout or on your Plan.",
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

const openers = new Set<() => void>()

// "How it works" on the card.
export function openTasksIntro() {
  openers.forEach((o) => o())
}

export function SessionTasksIntro() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const open = () => setShow(true)
    openers.add(open)
    return () => { openers.delete(open) }
  }, [])
  return <Slides visible={show} label="Next-session tasks" slides={TASKS_INTRO} finishLabel="Got it" onClose={() => setShow(false)} />
}
