import { Stroke, TimelineEvent } from "@/services/videoStorage"
import type { VideoPlayer } from "expo-video"
import { useEffect, useRef } from "react"

export interface DerivedReplayState {
  videoPositionMs: number
  isPlaying: boolean
  activeStrokes: Stroke[]
}

// Reconstructs full state (reference-clip position/playing, active strokes)
// at any point in the timeline — used for scrubbing, where playback can jump
// to an arbitrary time rather than crossing events in order.
//
// videoPositionMs isn't just "whatever the last play/pause/seek event
// recorded" — if the clip was still playing when it crossed atMs, real
// playback time has elapsed since that event, and the clip would have kept
// advancing during it (1x speed, since both the reference clip and the
// narration run in real time). playStartedAtMs/playStartedAtVideoMs track
// where the *current* playing streak began (narration-clock and video-clock)
// so that elapsed time can be extrapolated forward instead of reading a
// stale position frozen at whenever "play" last fired.
export function deriveStateAtMs(timeline: TimelineEvent[], atMs: number): DerivedReplayState {
  let videoPositionMs = 0
  let isPlaying = false
  let playStartedAtMs = 0
  let playStartedAtVideoMs = 0
  let strokes: Stroke[] = []
  for (const ev of timeline) {
    if (ev.atMs > atMs) break
    if (ev.type === "play") {
      isPlaying = true
      videoPositionMs = ev.videoPositionMs
      playStartedAtMs = ev.atMs
      playStartedAtVideoMs = ev.videoPositionMs
    } else if (ev.type === "pause") {
      isPlaying = false
      videoPositionMs = ev.videoPositionMs
    } else if (ev.type === "seek") {
      videoPositionMs = ev.videoPositionMs
      // A seek while playing restarts the extrapolation baseline from the
      // new position — otherwise a seek mid-play would still extrapolate
      // forward from the *pre-seek* position.
      if (isPlaying) { playStartedAtMs = ev.atMs; playStartedAtVideoMs = ev.videoPositionMs }
    } else if (ev.type === "stroke") { strokes = [...strokes, ev.stroke] }
    else if (ev.type === "clear") { strokes = [] }
    else if (ev.type === "undo") { strokes = strokes.slice(0, -1) }
  }
  if (isPlaying) videoPositionMs = playStartedAtVideoMs + (atMs - playStartedAtMs)
  return { videoPositionMs, isPlaying, activeStrokes: strokes }
}

// Drives the reference clip + drawing overlay off the bubble recording's own
// playback clock. Rather than recomputing a full snapshot on every tick
// (which would fight the reference player's own clock with redundant
// currentTime writes), this walks the timeline forward and applies each
// event exactly once as the bubble's elapsed time crosses its `atMs`.
export function useFeedbackReplay(
  timeline: TimelineEvent[],
  bubblePlayer: VideoPlayer,
  referencePlayer: VideoPlayer,
  onStrokesChange: (strokes: Stroke[]) => void
) {
  const nextIdxRef = useRef(0)
  const activeStrokesRef = useRef<Stroke[]>([])
  // Tracks the bubble's own clock so a backward jump (see below) can be told
  // apart from ordinary forward playback.
  const lastAtMsRef = useRef(0)

  function applyEvent(ev: TimelineEvent) {
    // play/pause seek to the event's recorded position before changing
    // playback state, same as deriveStateAtMs below — `referencePlayer` is
    // the same player object used live during "recording", so at replay
    // start it's sitting wherever the coach last left it (e.g. paused
    // partway through), not at this timeline's actual start. Calling
    // .play() alone would just resume from that stale position instead of
    // where the recording actually began.
    if (ev.type === "play") { referencePlayer.currentTime = ev.videoPositionMs / 1000; referencePlayer.play() }
    else if (ev.type === "pause") { referencePlayer.currentTime = ev.videoPositionMs / 1000; referencePlayer.pause() }
    else if (ev.type === "seek") referencePlayer.currentTime = ev.videoPositionMs / 1000
    else if (ev.type === "stroke") {
      activeStrokesRef.current = [...activeStrokesRef.current, ev.stroke]
      onStrokesChange(activeStrokesRef.current)
    } else if (ev.type === "clear") {
      activeStrokesRef.current = []
      onStrokesChange(activeStrokesRef.current)
    } else if (ev.type === "undo") {
      activeStrokesRef.current = activeStrokesRef.current.slice(0, -1)
      onStrokesChange(activeStrokesRef.current)
    }
  }

  // Derives full state at atMs and applies it directly, then resyncs the
  // forward-walk index so subsequent playback doesn't re-apply or skip
  // events. Used both by the exported seekTo (dragging the bubble's scrub
  // bar) and internally when the bubble's clock jumps backward on its own
  // (e.g. a looping preview restarting) — a plain forward-walk would just
  // stop applying events forever once nextIdxRef has run past the end.
  function resyncTo(atMs: number) {
    const state = deriveStateAtMs(timeline, atMs)
    referencePlayer.currentTime = state.videoPositionMs / 1000
    if (state.isPlaying) referencePlayer.play()
    else referencePlayer.pause()
    activeStrokesRef.current = state.activeStrokes
    onStrokesChange(state.activeStrokes)
    const idx = timeline.findIndex((e) => e.atMs > atMs)
    nextIdxRef.current = idx === -1 ? timeline.length : idx
  }

  useEffect(() => {
    nextIdxRef.current = 0
    activeStrokesRef.current = []
    lastAtMsRef.current = 0
    const sub = bubblePlayer.addListener("timeUpdate", ({ currentTime }) => {
      const atMs = currentTime * 1000
      if (atMs < lastAtMsRef.current - 250) resyncTo(atMs)
      lastAtMsRef.current = atMs
      while (nextIdxRef.current < timeline.length && timeline[nextIdxRef.current].atMs <= atMs) {
        applyEvent(timeline[nextIdxRef.current])
        nextIdxRef.current++
      }
    })
    return () => sub.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bubblePlayer, timeline])

  function seekTo(atMs: number) {
    resyncTo(atMs)
    bubblePlayer.currentTime = atMs / 1000
  }

  return { seekTo }
}
