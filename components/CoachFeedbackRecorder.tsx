import { C } from "@/utils/theme"
import { DebugLogOverlay } from "@/components/DebugLogOverlay"
import { DrawingCanvas } from "@/components/DrawingCanvas"
import { useFeedbackReplay } from "@/hooks/useFeedbackReplay"
import { createVideoFeedback, Stroke, TimelineEvent, uploadBubbleVideo, VideoRow } from "@/services/videoStorage"
import { getCachedVideoAspect, loadVideoAspect, VideoAspectSize } from "@/services/videoAspect"
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av"
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera"
import { useVideoPlayer, VideoPlayer, VideoView } from "expo-video"
import { useEffect, useRef, useState } from "react"
import { ActivityIndicator, Alert, PanResponder, Pressable, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

// Deliberately not gated on __DEV__: DebugLogOverlay (rendered below) is how
// these get read back on a real device with no Metro/Xcode console attached
// (e.g. a standalone/ad-hoc build, where __DEV__ is false and these would
// otherwise never be captured anywhere).
function dbg(...args: any[]) {
  console.log("[feedback]", ...args)
}

// Re-wins the AVAudioSession category against expo-video's VideoManager,
// which force-reassigns it to `.playback` (see the mount-effect comment
// below for why) any time a VideoPlayer's play/pause/mute state changes —
// which happens constantly in this flow (the coach playing/pausing/seeking
// `player` while narrating, and bubblePlayer's own creation). Called at the
// moments that most need `.playAndRecord` to have actually won: right after
// we change player state ourselves, and right before the camera is asked to
// (re)start recording.
function reassertRecordingAudioMode() {
  Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
    interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
    shouldDuckAndroid: true,
  }).catch((e: any) => console.warn("[feedback] setAudioModeAsync failed:", e?.message ?? e))
}

// How long "reviewing" is allowed to sit without a bubbleUri before we give
// the coach an escape hatch instead of leaving them on an unexplained spinner
// forever (see the CameraView-mount comment on handleStop below for why this
// can happen).
const FINALIZE_TIMEOUT_MS = 12_000

// How long "recording" is allowed to sit without the camera ever reporting
// onCameraReady before we give up and tell the coach, instead of silently
// never calling recordAsync() at all.
const CAMERA_READY_TIMEOUT_MS = 5_000

// ready → recording → reviewing → sending → sent. "reviewing" (preview the
// take, discard-and-retry or send) exists so a botched recording doesn't
// force sending garbage or fully closing the modal — mirrors the old
// single-frame flow's re-record affordance.
type RecPhase = "ready" | "recording" | "reviewing" | "sending" | "sent"
type InteractionMode = "control" | "draw"

const MAX_RECORDING_MS = 180_000

interface Props {
  player: VideoPlayer
  video: VideoRow
  positionMs: number
  durationMs: number
  onClose: () => void
  onSent: () => void
}

// The coach's narrated review: their camera+mic bubble records while they
// play/pause/seek the reference clip (rendered here, wrapped in
// DrawingCanvas) and draw over it. Every action gets timestamped into a
// TimelineEvent log, which — together with the bubble recording — is all the
// athlete's replay needs to reconstruct the session (see
// hooks/useFeedbackReplay.ts). No flattened video is ever produced.
export function CoachFeedbackRecorder({ player, video, positionMs, durationMs, onClose, onSent }: Props) {
  const [recPhase, setRecPhase] = useState<RecPhase>("ready")
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("control")
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [bubbleUri, setBubbleUri] = useState<string | null>(null)
  const [videoAspect, setVideoAspect] = useState<VideoAspectSize | null>(() => getCachedVideoAspect(video.$id))
  const [finalizeTimedOut, setFinalizeTimedOut] = useState(false)
  // Surfaced on the "Finalizing recording…" screen so a stuck finalize is
  // visibly a stuck finalize (a climbing counter, not a frozen spinner) even
  // without device console access — see the effect below.
  const [finalizeElapsedSec, setFinalizeElapsedSec] = useState(0)
  // Frozen snapshot of timelineRef.current taken the moment recording stops.
  // The live timelineRef mutates on every draw/seek during "recording"
  // without triggering a re-render (that's the point — see logEvent), so it
  // can't be handed to useFeedbackReplay directly: the hook would only ever
  // see whatever stale array happened to be current on the last unrelated
  // re-render. This copy is what "reviewing" replays from instead.
  const [reviewTimeline, setReviewTimeline] = useState<TimelineEvent[]>([])
  const [replayStrokes, setReplayStrokes] = useState<Stroke[]>([])
  // A non-null cameraRef only proves the JS ref object exists — on Android
  // the native view is registered with the UIManager asynchronously over the
  // bridge, and can still lag behind that. onCameraReady (set on <CameraView>
  // below) is expo-camera's own signal that the native view + hardware are
  // actually ready for calls like recordAsync(); gating on it too is what
  // fixes the "Unable to find the class ExpoCameraView view with tag N"
  // native rejection.
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
  const [micPermission, requestMicPermission] = useMicrophonePermissions()

  const cameraRef = useRef<CameraView>(null)
  const timelineRef = useRef<TimelineEvent[]>([])

  // On iOS, the reference clip's AVPlayer (`player`, muted but still
  // actively playing) and the camera's AVCaptureSession end up competing for
  // the same audio session — unlike VideoRecorder.tsx (the athlete's own
  // camera recorder), which only ever has the mic active, never a
  // simultaneous AVPlayer too. Without explicitly allowing them to coexist,
  // iOS's default audio session behavior can leave the capture session
  // unable to properly finalize, which looks exactly like recordAsync()'s
  // promise never resolving after stopRecording() — stuck on "Finalizing
  // recording…" with no error, because the failure never reaches JS at all.
  // Same fix VideoRecorder.tsx already needed for its own (simpler) case.
  //
  // This alone isn't durable, though: expo-video's native VideoManager (see
  // its ios/VideoManager.swift) recomputes and force-reassigns the shared
  // AVAudioSession category to `.playback` — never `.playAndRecord` — every
  // single time *any* VideoPlayer's isPlaying/isMuted changes, anywhere in
  // the app, on its own async dispatch queue (up to ~70ms later). `player`
  // gets played/paused/seeked constantly while the coach narrates, and each
  // one silently reasserts `.playback`, clobbering the `.playAndRecord`
  // session the camera's still-active AVCaptureSession needs. That's a
  // plausible cause of both the stuck-finalizing hang above and a
  // transparent bubble immediately after Stop (bubblePlayer's own creation
  // triggers the same clobber right as its VideoView is first attaching to
  // the window). We can't stop expo-video from doing this, so
  // reassertRecordingAudioMode (below) re-wins the race at the moments that
  // matter most instead.
  useEffect(() => {
    reassertRecordingAudioMode()
  }, [])

  // `player` autoplays as soon as its source loads (see VideoPlayerModal),
  // and when this screen is entered directly — tapping the pencil icon on a
  // clip card skips the normal "watch" phase, which is the only place that
  // otherwise calls player.pause() (enterCoachRecording) — nothing stops it.
  // Left alone, the clip keeps playing behind the "ready" screen (whose
  // tap-to-play is disabled until recPhase === "recording") for however long
  // the coach takes to read the hint and tap Start, and *that* elapsed
  // position — not 0, not wherever the coach actually meant to start — became
  // the recording's first "play" event. Pausing here catches it as soon as
  // "ready" mounts/returns to, freezing it wherever it happens to be instead.
  useEffect(() => {
    if (recPhase === "ready") player.pause()
  }, [recPhase, player])

  const recordingStartedAtRef = useRef(0)
  const recordedDurationMsRef = useRef(0)
  const progressBarWidthRef = useRef(0)
  // Only flips true on genuine component teardown — guards the recordAsync
  // effect below from updating state after unmount, without being tripped by
  // the recPhase change (Stop) that happens well before that promise settles.
  const unmountedRef = useRef(false)
  useEffect(() => () => { unmountedRef.current = true }, [])

  // handleStart mutes `player` (the shared reference-clip player — see the
  // Props comment on why it's shared with the "watch" phase) so the bubble's
  // mic doesn't pick up the clip's own audio, and it stays muted through
  // "reviewing" so the composited preview doesn't double up audio with the
  // narration. Restoring it is scoped to this component's lifetime, not to
  // any particular recPhase, so it can't get skipped by discarding out
  // partway through instead of sending.
  useEffect(() => () => {
    try {
      player.muted = false
    } catch (e) {
      // `player` is a native shared object owned by VideoPlayerModal
      // (useVideoPlayer there). Closing the whole modal mid-flow unmounts
      // that and this component together with no ordering guarantee between
      // them, so the player can already be released by the time this cleanup
      // runs — nothing to restore on a released player, so just swallow it.
      if (__DEV__) console.log("[feedback] player already released on cleanup, skipping unmute:", (e as any)?.message ?? e)
    }
  }, [player])

  // Preview of the just-recorded bubble during "reviewing"/"sending"/"sent" —
  // autoplay + loop, same convention as VideoRecorder.tsx's own preview.
  // timeUpdateEventInterval defaults to effectively never firing — without
  // it, useFeedbackReplay below (which drives the whole composited preview
  // off this player's timeUpdate) never gets a tick, so the reference clip
  // just sits frozen wherever it was when Stop was tapped. Matches
  // FeedbackViewer.tsx's bubblePlayer, which needs the same thing.
  const bubblePlayer = useVideoPlayer(bubbleUri ? { uri: bubbleUri } : null, (p) => {
    p.loop = true
    p.timeUpdateEventInterval = 0.1
    // Deliberately not calling p.play() here — see the statusChange effect
    // below, which is now the only place that starts playback.
  })

  // The bubble sometimes renders blank (not black, not frozen — genuinely
  // transparent). Calling .play() synchronously in the setup callback above
  // used to flip this player's isPlaying to true in the very same commit
  // that its <VideoView> (an AVPlayerViewController on iOS) first attaches
  // to the window — which is also exactly when expo-video's VideoManager
  // reassigns the shared AVAudioSession (see reassertRecordingAudioMode's
  // comment). That reassignment lands on an async dispatch queue up to
  // ~70ms later, so it can arrive mid-attach, and a session reconfiguration
  // landing while an AVPlayerViewController's view is still attaching is a
  // plausible way to get a transient blank/transparent render. Waiting for
  // an actual statusChange → "readyToPlay" event (this listener's other
  // job: catching a .play() that fired before the player had loaded enough
  // data and got silently dropped, since expo-video never surfaces that as
  // a thrown error) pushes our own .play() call — and its session
  // clobber — a beat later than the view's initial attach instead of
  // exactly concurrent with it.
  useEffect(() => {
    const sub = bubblePlayer.addListener("statusChange", ({ status, error }) => {
      console.log("[feedback] bubblePlayer status:", status, error ? `error: ${error.message}` : "")
      if (status === "readyToPlay" && !bubblePlayer.playing) {
        console.log("[feedback] bubblePlayer ready but not playing — retrying play()")
        bubblePlayer.play()
      }
    })
    return () => sub.remove()
  }, [bubblePlayer])

  // Drives the reference clip + drawing overlay during "reviewing" off the
  // bubble's own clock — the same engine FeedbackViewer.tsx uses for the
  // athlete's replay — so the coach previews the actual composited "screen
  // recording" illusion the athlete will see (reference clip + strokes, with
  // the coach's talking-head bubble small in the corner) instead of just a
  // fullscreen selfie video. No-ops harmlessly before Stop, since
  // reviewTimeline is empty and bubblePlayer has no source yet.
  useFeedbackReplay(reviewTimeline, bubblePlayer, player, setReplayStrokes)

  // DrawingCanvas needs the reference clip's actual displayed aspect ratio.
  // player.videoTrack.size looked like the obvious source, but it reports
  // raw encoded dimensions — phone-recorded portrait clips carry a rotation
  // transform, so the encoded track is often landscape even though the clip
  // displays portrait, which threw off DrawingCanvas's letterboxing.
  // expo-video-thumbnails' width/height reflect the actual visual frame
  // (rotation already applied), matching what the old single-frame capture
  // flow used — same fix documented in the expo-video maintainers' own
  // guidance for getting a clip's intrinsic aspect ratio.
  //
  // This used to render immediately with a hardcoded 16:9 guess while the
  // lookup was in flight, which visibly stretched portrait clips for the
  // first moment then snapped to the right shape once it resolved. Render is
  // now gated on videoAspect below instead — a beat of spinner instead of a
  // visible aspect-ratio jump.
  useEffect(() => {
    const cached = getCachedVideoAspect(video.$id)
    if (cached) { setVideoAspect(cached); return }
    let cancelled = false
    loadVideoAspect(video.$id, video.url).then((size) => {
      if (!cancelled) setVideoAspect(size)
    })
    return () => { cancelled = true }
  }, [video.$id, video.url])

  // recPhase flips to "reviewing" as soon as Stop is tapped, but bubbleUri
  // only lands once recordAsync()'s promise resolves. That's normally near-
  // instant, but if the camera view gets torn down before the native
  // recorder finishes flushing the file, that promise can sit pending
  // indefinitely (see the CameraView render below) — leaving the coach
  // parked on "Finalizing recording…" with no way out. This is the backstop:
  // surface an escape hatch rather than assume it'll always resolve.
  useEffect(() => {
    if (recPhase !== "reviewing" || bubbleUri) {
      setFinalizeTimedOut(false)
      return
    }
    const t = setTimeout(() => {
      console.warn("[feedback] bubble recording did not finalize within", FINALIZE_TIMEOUT_MS, "ms")
      setFinalizeTimedOut(true)
    }, FINALIZE_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [recPhase, bubbleUri])

  // Ticks once a second alongside the timeout above, purely for the on-screen
  // counter — see finalizeElapsedSec.
  useEffect(() => {
    if (recPhase !== "reviewing" || bubbleUri) {
      setFinalizeElapsedSec(0)
      return
    }
    const start = Date.now()
    const id = setInterval(() => setFinalizeElapsedSec(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(id)
  }, [recPhase, bubbleUri])

  // Backstop for the stage *before* the one above: if onCameraReady never
  // fires (e.g. no camera hardware — the iOS Simulator hits this — or some
  // other native-side failure to initialize), recPhase would otherwise sit
  // on "recording" forever with recordAsync() never even attempted and
  // nothing telling the coach why. This turns that silent hang into a
  // visible alert instead, and its wording tells us which stage actually
  // failed even without console access.
  useEffect(() => {
    if (recPhase !== "recording" || cameraReady) return
    const t = setTimeout(() => {
      console.warn("[feedback] camera did not report ready within", CAMERA_READY_TIMEOUT_MS, "ms")
      Alert.alert(
        "Camera didn't start",
        "The camera never became ready to record. If you're on a simulator, this feature needs a real device. Otherwise, try again — if it keeps happening, this points at a different issue."
      )
      setRecPhase("ready")
    }, CAMERA_READY_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [recPhase, cameraReady])

  function elapsedMs() {
    return Date.now() - recordingStartedAtRef.current
  }

  function logEvent(ev: TimelineEvent) {
    timelineRef.current = [...timelineRef.current, ev]
  }

  async function handleStart() {
    const cam = cameraPermission?.granted ? cameraPermission : await requestCameraPermission()
    const mic = micPermission?.granted ? micPermission : await requestMicPermission()
    if (!cam.granted || !mic.granted) {
      Alert.alert("Camera & microphone access needed", "Enable camera and microphone access to record feedback.")
      return
    }
    // Silences the clip's own audio so the bubble's mic doesn't pick it up —
    // the coach's narration is the only audio track that matters here.
    player.muted = true
    timelineRef.current = []
    setStrokes([])
    setInteractionMode("control")
    setCameraReady(false)
    setRecPhase("recording")
    // Deliberately NOT calling player.play() here — the clip stays paused
    // (wherever the "ready" phase's own pause effect left it, normally 0)
    // until the coach explicitly taps the Control play button. It used to
    // autoplay the instant recording started, which meant a coach who went
    // straight to drawing (never touching play/pause) would see the clip
    // start moving on its own underneath their strokes — surprising, and
    // not something they asked for. recordingStartedAtRef and the initial
    // timeline event are stamped in the effect below instead, once
    // <CameraView> has actually mounted and recordAsync() has actually
    // succeeded (it can transiently reject a few times first; see that
    // effect) — that event now records the clip's real state (playing or
    // paused) at that moment rather than assuming "play".
  }

  // Fires recordAsync() once <CameraView> has committed, cameraRef is
  // attached, AND the native side has confirmed onCameraReady. This can't
  // happen inline in handleStart: when permissions are already granted (true
  // on any retry), handleStart runs start-to-finish in one synchronous burst
  // with no `await`, so calling cameraRef.current?.recordAsync(...) right
  // after setRecPhase("recording") reads cameraRef.current from the
  // *previous* render — still null, since <CameraView> only mounts once
  // recPhase === "recording" commits. Optional-chaining then silently
  // short-circuits the whole `.recordAsync(...).then().catch()` chain: no
  // call, no resolve, no reject, nothing — while the camera's native preview
  // still renders fine regardless (it doesn't depend on our ref), so nothing
  // looks wrong until the coach hits Stop and bubbleUri never arrives.
  // Waiting for this effect (which runs after the commit) fixes that part —
  // but on Android, a non-null cameraRef still only proves the JS ref object
  // exists; the native view gets registered with the UIManager
  // asynchronously over the bridge and can lag behind, so recordAsync() can
  // still be rejected with "Unable to find the class ExpoCameraView view
  // with tag N". onCameraReady (see <CameraView> below) is expo-camera's own
  // signal that the native view + hardware are truly ready, which is what
  // actually closes that gap for Android.
  //
  // On iOS there's a *further* gap onCameraReady doesn't cover: for
  // mode="video", expo-camera's own native code sets up the
  // AVCaptureMovieFileOutput recordAsync() actually needs via a separate
  // async dispatch (triggered by the `mode` prop's didSet, not by
  // startSession()'s ready callback) — so recordAsync() can transiently
  // reject with "Camera is not ready yet. Wait for 'onCameraReady' callback"
  // even though onCameraReady already fired, for a brief window while that
  // output is still being set up. It resolves itself within a beat (a manual
  // re-tap moments later works), so this retries automatically instead of
  // surfacing it as a user-facing error.
  useEffect(() => {
    if (recPhase !== "recording" || !cameraReady) return
    if (!cameraRef.current) {
      console.warn("[feedback] recPhase is 'recording' and camera reported ready, but cameraRef is still null — recording will not start")
      return
    }
    const camera = cameraRef.current

    async function startWithRetry() {
      // player.muted = true in handleStart triggers expo-video's own
      // audio-session recalculation (VideoManager.setAppropriateAudioSessionOrWarn,
      // see reassertRecordingAudioMode's comment — any isMuted/isPlaying
      // transition on any registered player does, muting included) on an
      // async native queue — it isn't guaranteed to land before this runs.
      // If it lands *after*
      // camera.recordAsync() has already committed the capture session's
      // audio input instead of before, the session gets silently switched
      // out from under an already-recording session — which matches what
      // was actually observed: recordAsync() hanging forever on Stop
      // specifically on the attempts where the camera was ready
      // immediately (no "not ready yet" retry, so no natural gap for
      // expo-video's clobber to land and settle first), never on the ones
      // that needed a retry. This waits it out deliberately, then
      // reasserts once more so our setting is unambiguously the last one
      // applied before recordAsync() actually starts.
      await new Promise((resolve) => setTimeout(resolve, 300))
      reassertRecordingAudioMode()

      const maxAttempts = 8
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // Re-stamped on every attempt, not just the first: whichever attempt
        // actually succeeds is the recording's true t=0, and every later
        // event's atMs is measured against this. A stale stamp from an
        // earlier failed attempt would drift the whole timeline by however
        // long the retries took. Same reasoning for re-reading
        // player.currentTime here rather than trusting whatever handleStart
        // saw before any of these retries happened.
        recordingStartedAtRef.current = Date.now()
        // type reflects player's actual state at t=0, not assumed "play" —
        // handleStart no longer autoplays the clip (see its comment), so a
        // coach who goes straight to drawing without touching Control has a
        // genuinely paused clip at this point, and the replay needs to
        // reproduce that rather than starting the clip moving on its own.
        timelineRef.current = [{ type: player.playing ? "play" : "pause", atMs: 0, videoPositionMs: player.currentTime * 1000 }]
        // player.muted = true in handleStart already re-triggered expo-video's
        // audio-session clobber once (see reassertRecordingAudioMode) — make
        // sure `.playAndRecord` has actually won by the time we ask the
        // camera to start.
        reassertRecordingAudioMode()
        dbg("recordAsync: starting (attempt", attempt, "of", maxAttempts, ")")
        try {
          const result = await camera.recordAsync({ maxDuration: MAX_RECORDING_MS / 1000 })
          dbg("recordAsync: resolved after", elapsedMs(), "ms, uri:", result?.uri)
          if (unmountedRef.current) return
          if (result) setBubbleUri(result.uri)
          else console.warn("[feedback] recordAsync resolved with no result")
          return
        } catch (e: any) {
          const notReadyYet = typeof e?.message === "string" && e.message.toLowerCase().includes("not ready yet")
          if (notReadyYet && attempt < maxAttempts) {
            dbg("recordAsync: camera output not ready yet, retrying in 250ms")
            await new Promise((resolve) => setTimeout(resolve, 250))
            continue
          }
          if (unmountedRef.current) return
          console.warn("[feedback] recordAsync rejected:", e?.message ?? e)
          Alert.alert("Recording failed", e?.message ?? "Please try again.")
          setRecPhase("ready")
          return
        }
      }
    }

    startWithRetry()
    // Deliberately no cleanup here: recordAsync()'s promise is expected to
    // resolve *after* recPhase has already moved on to "reviewing" — Stop
    // doesn't (and shouldn't) wait for it. A cleanup that fires on every
    // recPhase change would race ahead of that resolve and silently drop the
    // result, which was exactly the previous bug (recordAsync resolved fine,
    // but bubbleUri never got set). unmountedRef is the only thing that
    // should suppress this, and only on genuine component teardown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recPhase, cameraReady])

  function handleTogglePlayPause() {
    if (interactionMode !== "control" || recPhase !== "recording") return
    if (player.playing) {
      player.pause()
      logEvent({ type: "pause", atMs: elapsedMs(), videoPositionMs: player.currentTime * 1000 })
    } else {
      player.play()
      logEvent({ type: "play", atMs: elapsedMs(), videoPositionMs: player.currentTime * 1000 })
    }
    // player.play()/pause() just flipped expo-video's global isPlaying
    // state, which reassigns the shared audio session away from
    // `.playAndRecord` (see reassertRecordingAudioMode) — every play/pause
    // during "recording" is a fresh chance to knock the camera's recording
    // session sideways, so fight back after each one.
    reassertRecordingAudioMode()
  }

  function handleSeek(fraction: number) {
    if (recPhase !== "recording" || durationMs <= 0) return
    const ms = Math.max(0, Math.min(durationMs, fraction * durationMs))
    player.currentTime = ms / 1000
    logEvent({ type: "seek", atMs: elapsedMs(), videoPositionMs: ms })
  }
  // PanResponder below is created once (via useRef) — this ref keeps it
  // seeing the current handleSeek/interactionMode closure instead of the one
  // from whichever render first mounted it.
  const handleSeekRef = useRef(handleSeek)
  handleSeekRef.current = handleSeek
  const interactionModeRef = useRef(interactionMode)
  interactionModeRef.current = interactionMode
  const scrubStartFractionRef = useRef(0)

  const scrubPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => interactionModeRef.current === "control",
      onPanResponderGrant: (e) => {
        if (!progressBarWidthRef.current) return
        const fraction = e.nativeEvent.locationX / progressBarWidthRef.current
        scrubStartFractionRef.current = fraction
        handleSeekRef.current(fraction)
      },
      onPanResponderMove: (_, { dx }) => {
        if (!progressBarWidthRef.current) return
        handleSeekRef.current(scrubStartFractionRef.current + dx / progressBarWidthRef.current)
      },
    })
  ).current

  function handleStrokesChange(next: Stroke[]) {
    if (recPhase !== "recording") return
    if (next.length > strokes.length) {
      logEvent({ type: "stroke", atMs: elapsedMs(), stroke: next[next.length - 1] })
    } else if (next.length < strokes.length) {
      logEvent({ type: "undo", atMs: elapsedMs() })
    }
    setStrokes(next)
  }

  function handleClear() {
    if (strokes.length === 0) return
    setStrokes([])
    logEvent({ type: "clear", atMs: elapsedMs() })
  }

  function handleStop() {
    // Captured before "reviewing"/"sending" elapses further wall-clock time —
    // this is the coach's actual recording length, not however long they
    // spend deciding whether to send it.
    recordedDurationMsRef.current = elapsedMs()
    dbg("stop: recorded", recordedDurationMsRef.current, "ms, stopping camera")
    dbg("stop: timeline (", timelineRef.current.length, "events):", JSON.stringify(timelineRef.current))
    setRecPhase("reviewing")
    // Freeze the timeline for useFeedbackReplay to drive the "reviewing"
    // preview from — see the reviewTimeline declaration above for why this
    // can't just be timelineRef.current directly.
    setReviewTimeline(timelineRef.current)
    // Seek `player` to the timeline's real starting position and freeze it
    // there, right away, synchronously — both matter. Seeking alone isn't
    // enough: if `player` was still playing when Stop was tapped, it just
    // keeps playing from the new (correct) position, drifts forward during
    // the gap before bubbleUri arrives, and then visibly snaps *backward*
    // once useFeedbackReplay's replay engine catches up and re-applies this
    // same starting event (seek-then-play) a beat later — a played-then-
    // rewound glitch. Pausing here too means it's simply frozen at the
    // right frame the whole time; useFeedbackReplay's later seek is then a
    // no-op and its play() is what actually starts it moving, with no jump
    // either way. startWithRetry seeds index 0 with the clip's real state
    // (play or pause — see its comment), hence checking for both rather
    // than a plain array-index read.
    const firstEvent = timelineRef.current[0]
    if (firstEvent?.type === "play" || firstEvent?.type === "pause") {
      player.currentTime = firstEvent.videoPositionMs / 1000
      player.pause()
    }
    cameraRef.current?.stopRecording()
    // Stays muted through "reviewing" — the composited preview plays the
    // reference clip back (see useFeedbackReplay above), and only the
    // coach's narration should be audible, same as the athlete's eventual
    // replay. Restored on unmount below, once the coach actually leaves the
    // feedback flow (discarding back out or finishing a send).
  }

  function handleDiscard() {
    dbg("discard")
    setBubbleUri(null)
    timelineRef.current = []
    setStrokes([])
    setReviewTimeline([])
    setReplayStrokes([])
    player.pause()
    player.currentTime = 0
    setRecPhase("ready")
  }

  async function handleSend() {
    if (!bubbleUri) return
    setRecPhase("sending")
    const startedAt = Date.now()
    try {
      dbg("send: uploading bubble video")
      const bubble = await uploadBubbleVideo(bubbleUri)
      dbg("send: bubble uploaded after", Date.now() - startedAt, "ms")
      // The player's own measured duration (once loaded) is more accurate
      // than our wall-clock approximation, but that approximation is a
      // reasonable fallback if playback metadata isn't ready yet.
      const bubbleDurationMs = bubblePlayer.duration > 0
        ? Math.round(bubblePlayer.duration * 1000)
        : recordedDurationMsRef.current
      dbg("send: creating feedback row, timeline events:", timelineRef.current.length)
      await createVideoFeedback({
        video,
        bubbleVideoUrl: bubble.url,
        bubbleVideoKey: bubble.key,
        bubbleDurationMs,
        timeline: timelineRef.current,
      })
      dbg("send: done after", Date.now() - startedAt, "ms total")
      setRecPhase("sent")
      onSent()
    } catch (e: any) {
      console.warn("[feedback] send failed after", Date.now() - startedAt, "ms:", e?.message ?? e)
      Alert.alert("Couldn't send feedback", e?.message ?? "Please try again.")
      setRecPhase("reviewing")
    }
  }

  const displayProgress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0
  const progressPct = `${(displayProgress * 100).toFixed(1)}%` as any
  // The camera has to stay mounted until bubbleUri actually lands, not just
  // while recPhase === "recording" — recordAsync()'s promise resolves when
  // the native recorder finishes flushing the file, which can trail Stop by
  // a beat. Unmounting <CameraView> before that happens risks that promise
  // never settling (see handleStop), which is what left the coach stuck on
  // "Finalizing recording…" indefinitely. It's kept invisible once we've
  // left "recording" so it doesn't reappear as a floating bubble.
  const cameraShouldBeMounted = recPhase === "recording" || (recPhase === "reviewing" && !bubbleUri)

  return (
    <View style={styles.root}>
      <DebugLogOverlay />
      {(recPhase === "ready" || recPhase === "recording") && (
        <>
          {/* Tap-to-play only in control mode — DrawingCanvas below owns
              touches in draw mode. */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={handleTogglePlayPause}
            disabled={interactionMode !== "control" || recPhase !== "recording"}
          />
          {videoAspect ? (
            // DrawingCanvas always renders the video (its children) — only its
            // gesture layer is conditional. The wrapping pointerEvents toggle
            // is what actually routes touches to draw-mode vs. the
            // tap-to-play Pressable / scrub bar underneath.
            <View
              style={StyleSheet.absoluteFill}
              pointerEvents={interactionMode === "draw" && recPhase === "recording" ? "auto" : "none"}
            >
              <DrawingCanvas
                naturalSize={videoAspect}
                strokes={strokes}
                onStrokesChange={handleStrokesChange}
                editable={interactionMode === "draw" && recPhase === "recording"}
                style={styles.canvasFill}
                debugLabel="recording"
              >
                <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="fill" nativeControls={false} pointerEvents="none" />
              </DrawingCanvas>
            </View>
          ) : (
            // Waiting on the clip's real aspect ratio (see loadVideoAspect
            // above) — a beat of spinner beats rendering into a wrong-shaped
            // box and visibly snapping once it resolves.
            <View style={[StyleSheet.absoluteFill, styles.centerFill]} pointerEvents="none">
              <ActivityIndicator color={C.green} size="large" />
            </View>
          )}
        </>
      )}

      {cameraPermission?.granted && micPermission?.granted && cameraShouldBeMounted && (
        <CameraView
          ref={cameraRef}
          style={recPhase === "recording" ? styles.bubble : styles.bubbleHidden}
          facing="front"
          mode="video"
          videoQuality="720p"
          pointerEvents="none"
          onCameraReady={() => { dbg("camera ready"); setCameraReady(true) }}
        />
      )}

      {recPhase === "reviewing" && (
        bubbleUri ? (
          // Same composited "screen recording" illusion the athlete gets in
          // FeedbackViewer.tsx — reference clip + drawn strokes as the main
          // view, coach's talking-head bubble small in the corner, both
          // driven by the timeline off the bubble's own clock (see
          // useFeedbackReplay above). This is what the coach is actually
          // sending, so it's what they should preview here — not just a
          // fullscreen selfie video.
          <View style={StyleSheet.absoluteFill}>
            {videoAspect ? (
              <DrawingCanvas naturalSize={videoAspect} strokes={replayStrokes} editable={false} style={styles.canvasFill} debugLabel="reviewing">
                <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="fill" nativeControls={false} pointerEvents="none" />
              </DrawingCanvas>
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.centerFill]} pointerEvents="none">
                <ActivityIndicator color={C.green} size="large" />
              </View>
            )}
            <View style={styles.bubble} pointerEvents="none">
              {/* Android's default SurfaceView rendering doesn't composite
                  normally with the rest of the view hierarchy when two
                  VideoViews overlap on screen (this one + the fullscreen
                  reference clip above) — the non-frontmost one can render
                  fully transparent while its container View (this border)
                  still shows fine. textureView is expo-video's documented
                  fix for exactly this "overlapping video views" case. */}
              <VideoView player={bubblePlayer} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} surfaceType="textureView" />
            </View>
          </View>
        ) : (
          // recPhase flips to "reviewing" immediately on Stop, but bubbleUri
          // only lands once recordAsync()'s promise resolves — the camera
          // needs a moment to finalize the file. Without this, that gap was
          // just a black screen.
          <View style={[StyleSheet.absoluteFill, styles.centerFill]}>
            <ActivityIndicator color={C.green} size="large" />
            <Text style={styles.hint}>Finalizing recording{finalizeElapsedSec > 0 ? ` (${finalizeElapsedSec}s)` : "…"}</Text>
            {finalizeTimedOut && (
              <Pressable style={styles.secondaryBtn} onPress={handleDiscard}>
                <Text style={styles.secondaryBtnText}>Taking too long — discard &amp; retry</Text>
              </Pressable>
            )}
          </View>
        )
      )}

      {(recPhase === "sending" || recPhase === "sent") && (
        <View style={[StyleSheet.absoluteFill, styles.centerFill]}>
          <ActivityIndicator color={C.green} size="large" />
        </View>
      )}

      <SafeAreaView style={styles.chrome} edges={["top", "bottom"]} pointerEvents="box-none">
        <View style={styles.header} pointerEvents="box-none">
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8}>
            <Text style={styles.closeBtnText}>✕</Text>
          </Pressable>
          <Text style={styles.headerTitle}>
            {recPhase === "ready" && "Record feedback"}
            {recPhase === "recording" && "Recording…"}
            {recPhase === "reviewing" && "Review"}
            {recPhase === "sending" && "Sending…"}
            {recPhase === "sent" && "Sent"}
          </Text>
          <View style={{ width: 40 }} />
        </View>

        {recPhase === "ready" && (
          <View style={styles.centerFill} pointerEvents="box-none">
            <Text style={styles.hint}>
              Play the clip, talk through what you see, pause to draw whenever you want.
            </Text>
            <Pressable style={styles.primaryBtn} onPress={handleStart}>
              <Text style={styles.primaryBtnText}>Start recording</Text>
            </Pressable>
          </View>
        )}

        {recPhase === "recording" && (
          <View style={styles.recordingChrome} pointerEvents="box-none">
            <View style={styles.scrubRow}>
              <Text style={styles.timeText}>{formatTime(positionMs)}</Text>
              <View
                style={styles.progressTrack}
                onLayout={(e) => { progressBarWidthRef.current = e.nativeEvent.layout.width }}
                {...scrubPanResponder.panHandlers}
              >
                <View style={styles.progressBg} pointerEvents="none" />
                <View style={[styles.progressFilled, { width: progressPct }]} pointerEvents="none" />
              </View>
              <Text style={styles.timeText}>{formatTime(durationMs)}</Text>
            </View>

            <View style={styles.modeRow}>
              <Pressable
                style={[styles.modeBtn, interactionMode === "control" && styles.modeBtnActive]}
                onPress={() => setInteractionMode("control")}
              >
                <Text style={styles.modeBtnText}>{player.playing ? "⏸" : "▶"} Control</Text>
              </Pressable>
              <Pressable
                style={[styles.modeBtn, interactionMode === "draw" && styles.modeBtnActive]}
                onPress={() => setInteractionMode("draw")}
              >
                <Text style={styles.modeBtnText}>✏️ Draw</Text>
              </Pressable>
              {interactionMode === "draw" && (
                <Pressable style={styles.clearBtn} onPress={handleClear} disabled={strokes.length === 0}>
                  <Text style={[styles.modeBtnText, strokes.length === 0 && styles.disabledText]}>Clear</Text>
                </Pressable>
              )}
            </View>

            <Pressable style={styles.stopBtn} onPress={handleStop}>
              <View style={styles.stopSquare} />
            </Pressable>
          </View>
        )}

        {recPhase === "reviewing" && (
          <View style={styles.reviewChrome} pointerEvents="box-none">
            <Pressable style={[styles.secondaryBtn, styles.reviewBtnFlex]} onPress={handleDiscard}>
              <Text style={styles.secondaryBtnText}>Discard & retry</Text>
            </Pressable>
            <Pressable style={[styles.primaryBtn, styles.reviewBtnFlex]} onPress={handleSend}>
              <Text style={styles.primaryBtnText}>Send feedback</Text>
            </Pressable>
          </View>
        )}

        {recPhase === "sent" && (
          <View style={styles.centerFill} pointerEvents="box-none">
            <Text style={{ fontSize: 40 }}>✓</Text>
            <Text style={styles.headerTitle}>Feedback sent</Text>
            <Pressable style={styles.primaryBtn} onPress={onClose}>
              <Text style={styles.primaryBtnText}>Done</Text>
            </Pressable>
          </View>
        )}
      </SafeAreaView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  chrome: { flex: 1, justifyContent: "space-between" },
  canvasFill: { flex: 1, backgroundColor: "transparent" },

  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12,
  },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center",
  },
  closeBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  headerTitle: { color: "#fff", fontSize: 15, fontWeight: "700" },

  centerFill: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 32 },
  hint: { color: "rgba(255,255,255,0.75)", fontSize: 15, textAlign: "center", lineHeight: 22 },

  bubble: {
    position: "absolute", bottom: 100, right: 16,
    width: 100, height: 140, borderRadius: 16, overflow: "hidden",
    borderWidth: 2, borderColor: "rgba(255,255,255,0.5)",
  },
  // Same layout as bubble, just invisible — used to keep <CameraView> mounted
  // (rather than unmounted) while waiting on recordAsync() to resolve after
  // Stop. See the cameraShouldBeMounted comment above.
  bubbleHidden: {
    position: "absolute", bottom: 100, right: 16,
    width: 100, height: 140, opacity: 0,
  },

  recordingChrome: { paddingBottom: 16, gap: 12 },
  scrubRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 20 },
  timeText: { color: "rgba(255,255,255,0.75)", fontSize: 12, fontWeight: "600", width: 38, textAlign: "center" },
  progressTrack: { flex: 1, height: 28, justifyContent: "center" },
  progressBg: { position: "absolute", left: 0, right: 0, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.3)" },
  progressFilled: { position: "absolute", left: 0, height: 3, borderRadius: 2, backgroundColor: "white" },

  modeRow: { flexDirection: "row", justifyContent: "center", gap: 10, paddingHorizontal: 20 },
  modeBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.1)" },
  modeBtnActive: { backgroundColor: C.green },
  modeBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  clearBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.1)" },
  disabledText: { opacity: 0.4 },

  stopBtn: {
    alignSelf: "center", width: 64, height: 64, borderRadius: 32,
    backgroundColor: C.red, alignItems: "center", justifyContent: "center",
  },
  stopSquare: { width: 22, height: 22, borderRadius: 4, backgroundColor: "#fff" },

  reviewChrome: { flexDirection: "row", gap: 12, padding: 16 },
  // primaryBtn/secondaryBtn are shared across "ready"/"sent" (inside a
  // centered column, where flex:1 would stretch them to fill all remaining
  // vertical space) and "reviewing" (a row that should split space evenly) —
  // reviewBtnFlex opts a button into the latter only.
  reviewBtnFlex: { flex: 1 },
  primaryBtn: { backgroundColor: C.green, borderRadius: 16, paddingVertical: 16, paddingHorizontal: 24, alignItems: "center" },
  primaryBtnText: { color: C.bg, fontSize: 16, fontWeight: "700" },
  secondaryBtn: { backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 16, paddingVertical: 16, paddingHorizontal: 24, alignItems: "center" },
  secondaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
})
