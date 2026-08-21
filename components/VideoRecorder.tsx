import { Ionicons } from '@expo/vector-icons';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { CameraType, CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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

export default function VideoRecorder({ onFinish, onClose }: any) {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
  const [micPermission, requestMicPermission] = useMicrophonePermissions()
  const cameraRef = useRef<any>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [facing, setFacing] = useState<CameraType>("back")
  const [elapsed, setElapsed] = useState(0)
  const [availableLenses, setAvailableLenses] = useState<string[]>([])
  const [selectedLens, setSelectedLens] = useState<string | undefined>(undefined)

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

  // Preview playback of the just-recorded clip, looping and autoplaying.
  const previewPlayer = useVideoPlayer(previewUri ? { uri: previewUri } : null, (p) => {
    p.loop = true
    p.play()
  })

  // Let the camera's mic activate without cutting off music/podcasts already
  // playing in another app (e.g. Spotify) — default iOS/Android behavior
  // otherwise stops other audio the moment recording starts.
  useEffect(() => {
    Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
      interruptionModeAndroid: InterruptionModeAndroid.MixWithOthers,
      shouldDuckAndroid: true,
    })
  }, [])

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
  }, [isRecording])

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

  if (!cameraPermission || !micPermission) return <View />

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
            await requestCameraPermission()
            await requestMicPermission()
          }}
          style={styles.permBtn}
        >
          <Text style={styles.permBtnText}>Grant permissions</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const startRecording = async () => {
    if (!cameraRef.current) return;
    try {
      setIsRecording(true);
      const video = await cameraRef.current.recordAsync({
        maxDuration: 120,
        quality: "720p",
      });
      // Don't commit yet — show the preview so the user can review.
      setPreviewUri(video.uri);
    } catch (err) {
      console.log(err);
    } finally {
      setIsRecording(false);
      setIsSaving(false);
    }
  };

  const stopRecording = () => {
    if (cameraRef.current && isRecording) {
      // Immediately swap the camera for a "Saving…" view so the camera
      // surface releases cleanly without leaving a frozen black frame.
      setIsSaving(true)
      cameraRef.current.stopRecording();
    }
  };

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0")
  const ss = String(elapsed % 60).padStart(2, "0")

  // Preview screen — play back the just-recorded video and let user choose
  // to use it or re-record. The CameraView is unmounted here so the camera
  // surface releases cleanly with no frozen frame.
  if (previewUri) {
    return (
      <View style={{ flex: 1, backgroundColor: "black" }}>
        <VideoView
          player={previewPlayer}
          style={{ flex: 1 }}
          contentFit="contain"
          nativeControls={false}
        />
        <View style={styles.previewControls}>
          <Pressable
            style={[styles.previewBtn, styles.previewBtnSecondary]}
            onPress={() => setPreviewUri(null)}
            hitSlop={10}
          >
            <Text style={styles.previewBtnText}>Retry</Text>
          </Pressable>
          <Pressable
            style={[styles.previewBtn, styles.previewBtnPrimary]}
            onPress={() => onFinish(previewUri)}
            hitSlop={10}
          >
            <Text style={[styles.previewBtnText, { color: "#111" }]}>Use video</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  // Once the user taps stop, swap the camera for a "Saving…" overlay so the
  // camera surface unmounts immediately and we don't get a frozen black frame.
  if (isSaving) {
    return (
      <View style={[styles.savingWrap, { backgroundColor: "rgba(0,0,0,0.92)" }]}>
        <Text style={styles.savingText}>Saving video…</Text>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: "black" }}>
      <CameraView
        ref={cameraRef}
        style={{ width: "100%", height: "100%" }}
        facing={facing}
        mode="video"
        selectedLens={Platform.OS === "ios" ? selectedLens : undefined}
        onAvailableLensesChanged={(e) => setAvailableLenses(e.lenses)}
      />

      {/* Recording indicator chip at top */}
      {isRecording && (
        <View style={styles.recChip} pointerEvents="none">
          <Animated.View style={[styles.recDot, recDotStyle]} />
          <Text style={styles.recText}>REC  {mm}:{ss}</Text>
        </View>
      )}

      {/* Lens picker — only meaningful on iOS devices with multiple back lenses */}
      {lensOptions.length > 1 && (
        <View style={styles.lensRow} pointerEvents="box-none">
          {lensOptions.map((lens) => (
            <TouchableOpacity
              key={lens.id}
              onPress={() => setSelectedLens(lens.id)}
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

  // Saving overlay (replaces camera the instant user taps stop)
  savingWrap: {
    flex: 1, alignItems: "center", justifyContent: "center",
  },
  savingText: {
    color: "white", fontSize: 16, fontWeight: "600",
    letterSpacing: 0.5,
  },

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
