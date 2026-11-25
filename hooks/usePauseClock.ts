import { clockNow, pauseAt, PauseState, realTime, resumeAt, RUNNING } from "@/utils/pauseClock"
import { useCallback, useMemo, useRef, useState } from "react"

export type PauseClock = {
  paused: boolean
  /** Use instead of Date.now() in a timer: stands still while paused. */
  now: () => number
  pause: () => void
  resume: () => void
  toggle: () => void
  /** Back to running with no paused time (a new timer). */
  reset: () => void
  /** Real time a clock time will be reached; null while paused. */
  real: (t: number | null) => number | null
}

/** A pausable clock for one timer (see utils/pauseClock.ts). */
export function usePauseClock(): PauseClock {
  const ref = useRef<PauseState>(RUNNING)
  const [paused, setPaused] = useState(false)
  // `version` re-renders so `real()` reflects the latest offset.
  const [, setVersion] = useState(0)
  const set = useCallback((s: PauseState) => {
    ref.current = s
    setPaused(s.pausedAt != null)
    setVersion((v) => v + 1)
  }, [])
  const now = useCallback(() => clockNow(ref.current, Date.now()), [])
  const pause = useCallback(() => set(pauseAt(ref.current, Date.now())), [set])
  const resume = useCallback(() => set(resumeAt(ref.current, Date.now())), [set])
  const toggle = useCallback(() => (ref.current.pausedAt != null ? resume() : pause()), [pause, resume])
  const reset = useCallback(() => set(RUNNING), [set])
  const real = useCallback((t: number | null) => realTime(ref.current, t), [])
  return useMemo(() => ({ paused, now, pause, resume, toggle, reset, real }), [paused, now, pause, resume, toggle, reset, real])
}
