import { CameraType, CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { ResizeMode, Video } from 'expo-av';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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

export default function VideoRecorder({ onFinish, onClose }: any) {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
  const [micPermission, requestMicPermission] = useMicrophonePermissions()
  const cameraRef = useRef<any>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [facing, setFacing] = useState<CameraType>("back")
  const [elapsed, setElapsed] = useState(0)

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
        <Video
          source={{ uri: previewUri }}
          style={{ flex: 1 }}
          resizeMode={ResizeMode.CONTAIN}
          shouldPlay
          isLooping
          isMuted={false}
          useNativeControls={false}
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
      />

      {/* Recording indicator chip at top */}
      {isRecording && (
        <View style={styles.recChip} pointerEvents="none">
          <Animated.View style={[styles.recDot, recDotStyle]} />
          <Text style={styles.recText}>REC  {mm}:{ss}</Text>
        </View>
      )}

      {/* Back + switch camera buttons — hidden while recording */}
      {!isRecording && (
        <>
          {onClose && (
            <TouchableOpacity onPress={onClose} style={[styles.topBtn, { left: 20 }]}>
              <Text style={{ fontSize: 20, color: "white" }}>←</Text>
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
