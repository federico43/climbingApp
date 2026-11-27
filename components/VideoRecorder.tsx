import { useHoldUpdates } from "@/utils/updateHold"
import { DebugLogOverlay } from '@/components/DebugLogOverlay';
import { useHoldTimerSound } from "@/services/timerSound"
import {
  elapsedLabel,
  failureKind,
  formatBytes,
  RECORDING_STOP_TIMEOUT_MS,
  recorderContextLine,
  type RecordingFailureKind,
} from "@/utils/recordingAttempt"
import { Ionicons } from '@expo/vector-icons';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { CameraType, CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import Constants from "expo-constants"
import * as Device from "expo-device"
import * as FileSystem from 'expo-file-system/legacy';
import * as Updates from "expo-updates"
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

const RING_SIZE   = 84
const RING_BORDER = 4
const INNER_IDLE  = 64
const INNER_REC   = 28

// Same settings on mount and right before every recording: other screens
// (expo-video players, the Intervals / S&C timers) switch the shared iOS
// audio session to playback-only, and recording needs it in record mode.
// MixWithOthers keeps music already playing in another app going.
function setRecordingAudioMode() {
  return Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
    interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
    shouldDuckAndroid: true,
  })
}

// iOS reports lenses as localized device names (e.g. "Back Ultra Wide Camera"),
// not stable IDs, and lumps in virtual multi-lens devices ("Dual", "Triple")
// that auto-switch on their own — we only want the single-lens ones a user
// can explicitly pick, mapped to the familiar .5×/1×/2× labels.
const LENS_LABEL_ORDER = ["0.5×", "1×", "2×"]

function classifyLens(name: string): { id: string; label: string } | null {
  const n = name.toLowerCase()
  if (n.includes("dual") || n.includes("triple") || n.includes("depth") || n.includes("lidar") || n.includes("continuity")) return null
  if (n.includes("ultra wide")) return { id: name, label: "0.5×" }
  if (n.includes("telephoto")) return { id: name, label: "2×" }
  if (n.includes("wide") || n.includes("camera")) return { id: name, label: "1×" }
  return null
}

// One tap of the record button. Its result only counts while it is still
// `attemptRef.current`: "Try again" / "Close" abandon it, and a recordAsync
// that settles after that is logged and ignored.
type Attempt = { id: number; startedAt: number; stoppedAt: number | null }
type Failure = { kind: RecordingFailureKind; message: string }

// Module-level so attempt numbers keep counting across camera remounts in one
// app session, which keeps the debug logs readable.
let attemptCounter = 0

const FAILURE_TEXT: Record<RecordingFailureKind, string> = {
  stuck: "The camera got stuck while recording. This can happen during a phone or WhatsApp call, or when another app is using the microphone.",
  mic: "The phone didn't let the camera use the microphone. A call or another app may be using it.",
  other: "Something went wrong while recording.",
}
const FAILURE_TEXT_MUTED = "It didn't work without sound either. Close the camera and try again. If it keeps happening, share the debug logs (🐞) with your coach."

export default function VideoRecorder({ onFinish, onClose }: any) {
  // A reload here would lose unsaved work — see utils/updateHold.ts.
  useHoldUpdates()
  // The camera holds the microphone while it's open; a timer beep now would
  // reset the iOS audio session under it (see services/timerSound.ts).
  useHoldTimerSound()
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
  const [micPermission, requestMicPermission] = useMicrophonePermissions()
  const cameraRef = useRef<any>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null)
  // "Record without sound": the camera is remounted with `mute`, so the
  // capture session never asks for the microphone (works during a call).
  const [muted, setMuted] = useState(false)
  // Bumped to throw away the native camera (and whatever state a stuck
  // recording left in it) and mount a fresh one.
  const [cameraKey, setCameraKey] = useState(0)
  const attemptRef = useRef<Attempt | null>(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [facing, setFacing] = useState<CameraType>("back")
  const [elapsed, setElapsed] = useState(0)
  const [availableLenses, setAvailableLenses] = useState<string[]>([])
  const [selectedLens, setSelectedLens] = useState<string | undefined>(undefined)

  useEffect(() => {
    // Which phone, iOS version, native build and EAS update these logs come
    // from: the native build says whether the patched expo-camera is in it.
    console.log("VideoRecorder: component mounted ·", recorderContextLine({
      model: Device.modelName,
      os: Platform.OS,
      osVersion: Platform.Version,
      nativeBuild: Platform.OS === "ios" ? Constants.platform?.ios?.buildNumber : null,
      updateId: Updates.updateId,
      updateCreatedAt: Updates.createdAt,
      channel: Updates.channel,
    }))
    // An incoming call or Control Center turns the app "inactive"; going to
    // the background stops the camera session.
    const sub = AppState.addEventListener("change", (state) => console.log("VideoRecorder: app state", state))
    return () => {
      sub.remove()
      console.log("VideoRecorder: component unmounted")
    }
  }, [])

  // Lens set differs between front/back cameras — drop the previous pick
  // whenever the active camera changes so we don't apply a stale lens id.
  useEffect(() => {
    setSelectedLens(undefined)
  }, [facing])

  const lensOptions = LENS_LABEL_ORDER
    .map((label) => {
      const match = availableLenses.map(classifyLens).find((l) => l?.label === label)
      return match ?? null
    })
    .filter((l): l is { id: string; label: string } => l !== null)

  // Leaving `selectedLens` unset doesn't mean the hardware opens on 1× — on
  // iOS 17+ AVFoundation can boot the *system-wide* last-used lens (e.g. if
  // 0.5× was picked in the Camera app or a prior session), which silently
  // mismatched our "1× is active" default highlight. Force it explicitly the
  // moment we know the options, so displayed state always matches hardware.
  useEffect(() => {
    if (selectedLens || lensOptions.length === 0) return
    const defaultLens = lensOptions.find((l) => l.label === "1×") ?? lensOptions[0]
    setSelectedLens(defaultLens.id)
  }, [lensOptions, selectedLens])

  const activeLensId = selectedLens

  // Let the camera's mic activate without cutting off music/podcasts already
  // playing in another app (e.g. Spotify) — default iOS/Android behavior
  // otherwise stops other audio the moment recording starts.
  useEffect(() => {
    console.log("VideoRecorder: mounted, setting audio mode")
    setRecordingAudioMode()
      .then(() => console.log("VideoRecorder: audio mode set"))
      .catch((err) => console.error("VideoRecorder: setAudioModeAsync failed:", err))
  }, [])

  // The CameraView unmounts while previewing, so a later remount has to wait
  // for its own onCameraReady again (a fresh camera after a failure resets
  // this itself, see newCamera).
  useEffect(() => {
    if (previewUri) setCameraReady(false)
  }, [previewUri])

  // After stop, give the native side RECORDING_STOP_TIMEOUT_MS to hand back
  // the clip. Past that, show what happened and how to go on. The attempt
  // stays current, so a clip that still arrives late is shown as normal.
  useEffect(() => {
    if (!isSaving) return
    const attempt = attemptRef.current
    const id = setTimeout(() => {
      if (!attempt || attemptRef.current !== attempt) return
      console.error(`rec#${attempt.id} recording still not saved ${RECORDING_STOP_TIMEOUT_MS / 1000}s after stop, showing the failure screen`)
      setIsSaving(false)
      setIsRecording(false)
      setFailure({ kind: "stuck", message: `recordAsync didn't finish ${RECORDING_STOP_TIMEOUT_MS / 1000}s after stop` })
    }, RECORDING_STOP_TIMEOUT_MS)
    return () => clearTimeout(id)
  }, [isSaving])

  // ── Recording timer ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isRecording) { setElapsed(0); return }
    const start = Date.now()
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 250)
    return () => clearInterval(id)
  }, [isRecording])

  // ── Animations ──────────────────────────────────────────────────────────────
  const innerSize   = useSharedValue(INNER_IDLE)
  const innerRadius = useSharedValue(INNER_IDLE / 2)
  const ringScale   = useSharedValue(1)
  const recDotOpacity = useSharedValue(1)

  useEffect(() => {
    if (isRecording) {
      innerSize.value   = withTiming(INNER_REC,     { duration: 220, easing: Easing.out(Easing.quad) })
      innerRadius.value = withTiming(6,             { duration: 220, easing: Easing.out(Easing.quad) })
      ringScale.value   = withRepeat(
        withTiming(1.08, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        -1, true
      )
      recDotOpacity.value = withRepeat(
        withTiming(0.25, { duration: 600, easing: Easing.inOut(Easing.quad) }),
        -1, true
      )
    } else {
      innerSize.value   = withTiming(INNER_IDLE,    { duration: 220, easing: Easing.out(Easing.quad) })
      innerRadius.value = withTiming(INNER_IDLE / 2, { duration: 220, easing: Easing.out(Easing.quad) })
      cancelAnimation(ringScale);   ringScale.value   = withTiming(1, { duration: 150 })
      cancelAnimation(recDotOpacity); recDotOpacity.value = withTiming(1, { duration: 150 })
    }
  }, [isRecording, innerSize, innerRadius, ringScale, recDotOpacity])

  const innerStyle = useAnimatedStyle(() => ({
    width: innerSize.value,
    height: innerSize.value,
    borderRadius: innerRadius.value,
  }))
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
  }))
  const recDotStyle = useAnimatedStyle(() => ({
    opacity: recDotOpacity.value,
  }))

  useEffect(() => {
    if (!cameraPermission || !micPermission) return
    if (!cameraPermission.granted || !micPermission.granted) {
      console.warn("VideoRecorder: missing permission", {
        camera: cameraPermission.status,
        mic: micPermission.status,
      })
    }
  }, [cameraPermission, micPermission])

  if (!cameraPermission || !micPermission) return <View style={{ flex: 1, backgroundColor: "black" }}><DebugLogOverlay /></View>

  if (!cameraPermission.granted || !micPermission.granted) {
    return (
      <View style={styles.permWrap}>
        <Text style={{ fontSize: 48 }}>📷</Text>
        <Text style={styles.permTitle}>Camera & microphone access needed</Text>
        <Text style={styles.permText}>
          To record your attempts, allow access to your camera and microphone.
        </Text>
        <TouchableOpacity
          onPress={async () => {
            const cam = await requestCameraPermission()
            const mic = await requestMicPermission()
            console.log("VideoRecorder: permission request result", { cam: cam.status, mic: mic.status })
          }}
          style={styles.permBtn}
        >
          <Text style={styles.permBtnText}>Grant permissions</Text>
        </TouchableOpacity>
        <DebugLogOverlay />
      </View>
    )
  }

  const startRecording = async () => {
    const camera = cameraRef.current
    // The iOS simulator has no camera, so onCameraReady never fires there.
    // Letting the tap through makes recordAsync fail at once, which shows the
    // failure screen: the only part of this flow a simulator can show.
    if (!camera || (!cameraReady && Device.isDevice)) {
      console.warn("startRecording: camera not ready yet")
      return;
    }
    const attempt: Attempt = { id: ++attemptCounter, startedAt: Date.now(), stoppedAt: null }
    attemptRef.current = attempt
    const tag = () => `rec#${attempt.id} ${elapsedLabel(attempt.startedAt, Date.now())}`
    const isCurrent = () => attemptRef.current === attempt
    // How long the native side took to finish (or fail) after the stop tap.
    const sinceStop = () =>
      attempt.stoppedAt == null ? "before stop" : `${elapsedLabel(attempt.stoppedAt, Date.now()).slice(1)} after stop`
    const lens = lensOptions.find((l) => l.id === selectedLens)?.label ?? "default lens"
    console.log(`${tag()} record tapped · ${muted ? "no sound" : "with sound"} · ${facing} · ${lens}`)
    setIsRecording(true);
    try {
      const freeBytes = await FileSystem.getFreeDiskStorageAsync().catch(() => null)
      if (!muted) {
        await setRecordingAudioMode().catch((err) => console.warn(`${tag()} setAudioModeAsync failed:`, err))
      }
      if (attempt.stoppedAt != null || !isCurrent()) {
        // Stopped (or the camera was replaced) before the native recording
        // was even asked to start: there's nothing to wait for.
        console.log(`${tag()} ${attempt.stoppedAt != null ? "stopped" : "replaced"} before recordAsync was called`)
        return
      }
      console.log(`${tag()} calling recordAsync · free disk ${formatBytes(freeBytes)}`)
      // `quality` is not a recordAsync option (CameraRecordingOptions has no
      // such field — it silently did nothing); video quality is controlled
      // via the CameraView `videoQuality` prop below instead.
      const video = await camera.recordAsync({
        maxDuration: 120,
      });
      console.log(`${tag()} recordAsync resolved ${sinceStop()}${isCurrent() ? "" : " (abandoned attempt, ignored)"}`, video?.uri)
      // Set by the patched expo-camera when the first attempt failed and it
      // retried with iOS's automatic audio session setup.
      if (video?.audioFallbackReason) {
        console.warn(`${tag()} recorded via audio fallback, first attempt failed:`, video.audioFallbackReason)
      }
      if (!isCurrent()) return
      if (!video?.uri) throw new Error("Recording finished without a file.")
      // Don't commit yet — show the preview so the user can review. (Also
      // replaces the failure screen when the clip arrives after the timeout.)
      setFailure(null)
      setPreviewUri(video.uri);
    } catch (err: any) {
      const message = String(err?.message ?? err)
      console.error(`${tag()} recording failed ${sinceStop()}${isCurrent() ? "" : " (abandoned attempt)"}: ${message}`)
      if (isCurrent()) setFailure({ kind: failureKind(message), message })
    } finally {
      if (isCurrent()) {
        setIsRecording(false);
        setIsSaving(false);
      }
    }
  };

  const stopRecording = () => {
    const attempt = attemptRef.current
    if (!cameraRef.current || !isRecording || !attempt || attempt.stoppedAt != null) return
    attempt.stoppedAt = Date.now()
    console.log(`rec#${attempt.id} ${elapsedLabel(attempt.startedAt, attempt.stoppedAt)} stop tapped`)
    // Cover the camera with "Saving…" but keep it mounted until recordAsync
    // settles: unmounting tears the capture session down (inputs and outputs
    // removed) while the clip is still being finalized.
    setIsSaving(true)
    try {
      cameraRef.current.stopRecording();
    } catch (err) {
      console.error(`rec#${attempt.id} stopRecording threw:`, err)
    }
  };

  // Drops the current camera (and any recording stuck in it) for a fresh one.
  const newCamera = (withoutSound: boolean) => {
    const abandoned = attemptRef.current
    console.log(`VideoRecorder: fresh camera ${withoutSound ? "without" : "with"} sound${abandoned ? `, leaving rec#${abandoned.id} behind` : ""}`)
    attemptRef.current = null
    setFailure(null)
    setIsSaving(false)
    setIsRecording(false)
    setCameraReady(false)
    setMuted(withoutSound)
    setCameraKey((k) => k + 1)
  }

  const closeAfterFailure = () => {
    const abandoned = attemptRef.current
    console.log(`VideoRecorder: closed from the failure screen${abandoned ? `, leaving rec#${abandoned.id} behind` : ""}`)
    attemptRef.current = null
    onClose?.()
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0")
  const ss = String(elapsed % 60).padStart(2, "0")

  // Preview screen — play back the just-recorded video and let user choose
  // to use it or re-record. The CameraView is unmounted here so the camera
  // surface releases cleanly with no frozen frame.
  if (previewUri) {
    return (
      <RecordingPreview
        uri={previewUri}
        onRetry={() => setPreviewUri(null)}
        onUse={() => onFinish(previewUri)}
      />
    )
  }

  // Failure screen buttons: the microphone-free retry comes first when the
  // microphone is the likely culprit.
  const micSuspected = failure != null && failure.kind !== "other"
  const failureButtons: { label: string; primary: boolean; onPress: () => void }[] = []
  if (failure) {
    if (muted) {
      failureButtons.push({ label: "Try again", primary: true, onPress: () => newCamera(true) })
    } else {
      const withoutSound = { label: "Record without sound", primary: micSuspected, onPress: () => newCamera(true) }
      const again = { label: micSuspected ? "Try again with sound" : "Try again", primary: !micSuspected, onPress: () => newCamera(false) }
      failureButtons.push(...(micSuspected ? [withoutSound, again] : [again, withoutSound]))
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: "black" }}>
      <CameraView
        key={cameraKey}
        ref={cameraRef}
        style={{ width: "100%", height: "100%" }}
        facing={facing}
        mode="video"
        mute={muted}
        videoQuality="720p"
        selectedLens={Platform.OS === "ios" ? selectedLens : undefined}
        onAvailableLensesChanged={(e) => setAvailableLenses(e.lenses)}
        onCameraReady={() => { console.log(`VideoRecorder: camera ready${muted ? " (no sound)" : ""}`); setCameraReady(true) }}
        onMountError={(e) => console.error("VideoRecorder: camera mount error:", e.message)}
      />

      {/* Recording indicator chip at top */}
      {isRecording && (
        <View style={styles.recChip} pointerEvents="none">
          <Animated.View style={[styles.recDot, recDotStyle]} />
          <Text style={styles.recText}>REC  {mm}:{ss}</Text>
        </View>
      )}

      {/* Shown for as long as this camera records without the microphone */}
      {muted && (
        <View style={styles.mutedChip} pointerEvents="none">
          <Ionicons name="mic-off" size={14} color="white" />
          <Text style={styles.mutedText}>No sound</Text>
        </View>
      )}

      {/* Lens picker — only meaningful on iOS devices with multiple back lenses */}
      {lensOptions.length > 1 && (
        <View style={styles.lensRow} pointerEvents="box-none">
          {lensOptions.map((lens) => (
            <TouchableOpacity
              key={lens.id}
              onPress={() => {
                if (lens.id !== activeLensId) console.log("VideoRecorder: lens", lens.label)
                setSelectedLens(lens.id)
              }}
              style={[styles.lensBtn, activeLensId === lens.id && styles.lensBtnActive]}
            >
              <Text style={[styles.lensBtnText, activeLensId === lens.id && styles.lensBtnTextActive]}>
                {lens.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Back + switch camera buttons — hidden while recording */}
      {!isRecording && (
        <>
          {onClose && (
            <TouchableOpacity onPress={onClose} style={[styles.topBtn, { left: 20 }]}>
              <Ionicons name="chevron-back" size={24} color="white" />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => setFacing((prev) => (prev === "back" ? "front" : "back"))}
            style={[styles.topBtn, { right: 20 }]}
          >
            <Text style={{ fontSize: 20 }}>🔄</Text>
          </TouchableOpacity>
        </>
      )}

      {/* Record button */}
      <Pressable
        onPress={isRecording ? stopRecording : startRecording}
        style={styles.recordBtnWrap}
        hitSlop={20}
      >
        <Animated.View style={[styles.ring, ringStyle]}>
          <Animated.View style={[styles.inner, innerStyle]} />
        </Animated.View>
      </Pressable>

      {/* Once the user taps stop, cover the camera (its last frame may be
          frozen) until the clip comes back. */}
      {isSaving && (
        <View style={styles.cover}>
          <Text style={styles.savingText}>Saving video…</Text>
        </View>
      )}

      {failure && (
        <View style={[styles.cover, styles.failWrap]}>
          <Ionicons name={micSuspected ? "mic-off-outline" : "alert-circle-outline"} size={36} color="white" />
          <Text style={styles.failTitle}>The video didn&apos;t save</Text>
          <Text style={styles.failText}>{muted ? FAILURE_TEXT_MUTED : FAILURE_TEXT[failure.kind]}</Text>
          <Text style={styles.failDetail} numberOfLines={4}>{failure.message}</Text>
          <View style={styles.failBtns}>
            {failureButtons.map((b) => (
              <Pressable
                key={b.label}
                style={[styles.previewBtn, styles.failBtn, b.primary ? styles.previewBtnPrimary : styles.previewBtnSecondary]}
                onPress={b.onPress}
                hitSlop={6}
              >
                <Text style={[styles.previewBtnText, b.primary && { color: "#111" }]}>{b.label}</Text>
              </Pressable>
            ))}
            {onClose && (
              <Pressable style={styles.failClose} onPress={closeAfterFailure} hitSlop={10}>
                <Text style={styles.failCloseText}>Close</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}

      <DebugLogOverlay />
    </View>
  )
}

// Its own component so the expo-video player only exists while there's a
// clip to show. Created next to the live camera (even with no video loaded,
// as soon as audioMixingMode is set), expo-video tries to switch the iOS
// audio session to playback under a capture session that holds the mic.
function RecordingPreview({ uri, onRetry, onUse }: { uri: string; onRetry: () => void; onUse: () => void }) {
  // Looping autoplay. expo-video's default audioMixingMode ("auto") makes iOS
  // stop other apps' audio as soon as an unmuted player starts, so the
  // athlete's music (Spotify etc.) died on every preview. Mixing keeps it going.
  const player = useVideoPlayer({ uri }, (p) => {
    p.audioMixingMode = "mixWithOthers"
    p.loop = true
    p.play()
  })

  return (
    <View style={{ flex: 1, backgroundColor: "black" }}>
      <VideoView
        player={player}
        style={{ flex: 1 }}
        contentFit="contain"
        nativeControls={false}
      />
      <View style={styles.previewControls}>
        <Pressable
          style={[styles.previewBtn, styles.previewBtnSecondary]}
          onPress={onRetry}
          hitSlop={10}
        >
          <Text style={styles.previewBtnText}>Retry</Text>
        </Pressable>
        <Pressable
          style={[styles.previewBtn, styles.previewBtnPrimary]}
          onPress={onUse}
          hitSlop={10}
        >
          <Text style={[styles.previewBtnText, { color: "#111" }]}>Use video</Text>
        </Pressable>
      </View>
      <DebugLogOverlay />
    </View>
  )
}

const styles = StyleSheet.create({
  // Permissions screen
  permWrap: {
    flex: 1, backgroundColor: "#111",
    alignItems: "center", justifyContent: "center", gap: 16, padding: 32,
  },
  permTitle: {
    color: "white", fontSize: 18, fontWeight: "700", textAlign: "center",
  },
  permText: {
    color: "rgba(255,255,255,0.5)", fontSize: 14, textAlign: "center", lineHeight: 20,
  },
  permBtn: {
    backgroundColor: "white", paddingHorizontal: 28, paddingVertical: 14,
    borderRadius: 14, marginTop: 8,
  },
  permBtnText: { color: "#111", fontSize: 16, fontWeight: "700" },

  // Top buttons
  topBtn: {
    position: "absolute", top: 40,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center", justifyContent: "center",
  },

  // Recording indicator chip
  recChip: {
    position: "absolute", top: 50, alignSelf: "center",
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, paddingVertical: 7,
    backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 16,
  },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#FF3B30" },
  recText: {
    color: "white", fontSize: 13, fontWeight: "700", letterSpacing: 1.2,
    fontVariant: ["tabular-nums"],
  },

  // "No sound" chip, just above the lens picker
  mutedChip: {
    position: "absolute", bottom: 190, alignSelf: "center",
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 14,
  },
  mutedText: { color: "white", fontSize: 12, fontWeight: "700" },

  // Lens picker (.5×/1×/2×)
  lensRow: {
    position: "absolute", bottom: 140, alignSelf: "center",
    flexDirection: "row", gap: 10,
  },
  lensBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center", justifyContent: "center",
  },
  lensBtnActive: {
    backgroundColor: "rgba(255,255,255,0.9)",
  },
  lensBtnText: {
    color: "white", fontSize: 13, fontWeight: "700",
  },
  lensBtnTextActive: {
    color: "#111",
  },

  // Record button
  recordBtnWrap: {
    position: "absolute", bottom: 40, alignSelf: "center",
    alignItems: "center", justifyContent: "center",
  },
  ring: {
    width: RING_SIZE, height: RING_SIZE, borderRadius: RING_SIZE / 2,
    borderWidth: RING_BORDER, borderColor: "white",
    alignItems: "center", justifyContent: "center",
  },
  inner: {
    backgroundColor: "#FF3B30",
  },

  // Opaque cover over the (still mounted) camera: "Saving…" and failures
  cover: {
    ...StyleSheet.absoluteFillObject, backgroundColor: "#000",
    alignItems: "center", justifyContent: "center",
  },
  savingText: {
    color: "white", fontSize: 16, fontWeight: "600",
    letterSpacing: 0.5,
  },

  // Failure screen
  failWrap: { paddingHorizontal: 32, gap: 12 },
  failTitle: { color: "white", fontSize: 18, fontWeight: "700", textAlign: "center" },
  failText: { color: "rgba(255,255,255,0.75)", fontSize: 14, lineHeight: 20, textAlign: "center" },
  failDetail: {
    color: "rgba(255,255,255,0.4)", fontSize: 11, lineHeight: 15, textAlign: "center",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  failBtns: { alignSelf: "stretch", gap: 10, marginTop: 8 },
  failBtn: { flex: 0 },
  failClose: { alignSelf: "center", paddingVertical: 10, paddingHorizontal: 24 },
  failCloseText: { color: "rgba(255,255,255,0.75)", fontSize: 15, fontWeight: "600" },

  // Preview screen
  previewControls: {
    position: "absolute", left: 0, right: 0, bottom: 36,
    flexDirection: "row", justifyContent: "space-between",
    paddingHorizontal: 20, gap: 12,
  },
  previewBtn: {
    flex: 1, borderRadius: 24,
    paddingVertical: 14, alignItems: "center", justifyContent: "center",
  },
  previewBtnSecondary: {
    borderWidth: 1.5, borderColor: "white",
  },
  previewBtnPrimary: {
    backgroundColor: "white",
  },
  previewBtnText: {
    fontSize: 16, fontWeight: "700", color: "white",
  },
})
