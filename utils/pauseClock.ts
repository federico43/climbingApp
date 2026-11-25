// A clock that can stop. Every timer in the app must be pausable
// (Federico, 2026-11-25), and most of them count against Date.now(): a block
// stores when it started or when it ends and reads the time left on each
// tick. Reading "now" from this clock instead keeps that code as it is and
// makes it pausable: while paused "now" stands still, and after a resume it
// runs again minus the time spent paused.

export type PauseState = {
  /** Real time (ms) the clock was paused at; null while running. */
  pausedAt: number | null
  /** Total ms spent paused before the current pause. */
  offset: number
}

export const RUNNING: PauseState = { pausedAt: null, offset: 0 }

/** The clock's "now" for a real time `real` (ms). */
export function clockNow(s: PauseState, real: number): number {
  return (s.pausedAt ?? real) - s.offset
}

export function pauseAt(s: PauseState, real: number): PauseState {
  return s.pausedAt != null ? s : { ...s, pausedAt: real }
}

export function resumeAt(s: PauseState, real: number): PauseState {
  return s.pausedAt == null ? s : { pausedAt: null, offset: s.offset + Math.max(0, real - s.pausedAt) }
}

/** Real time a clock time `t` will be reached (for notifications and the end
 *  beep); null while paused, since nothing should fire then. */
export function realTime(s: PauseState, t: number | null): number | null {
  if (t == null || s.pausedAt != null) return null
  return t + s.offset
}
