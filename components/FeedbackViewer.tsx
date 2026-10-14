import { C } from "@/utils/theme"
import { DebugLogOverlay } from "@/components/DebugLogOverlay"
import { DrawingCanvas } from "@/components/DrawingCanvas"
import { useFeedbackReplay } from "@/hooks/useFeedbackReplay"
import { markFeedbackViewed, Stroke, VideoFeedbackRow, VideoRow } from "@/services/videoStorage"
import { getCachedVideoAspect, loadVideoAspect, VideoAspectSize } from "@/services/videoAspect"
import { useVideoPlayer, VideoView } from "expo-video"
import { useEffect, useRef, useState } from "react"
import { ActivityIndicator, PanResponder, Pressable, StyleSheet, Text, View } from "react-native"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context"

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

interface Props {
  feedback: VideoFeedbackRow
  // The athlete's original clip — VideoFeedbackRow only carries the coach's
  // bubble recording + event timeline, not a frame image, so the reference
  // clip's URL has to come from the caller (which already has both in hand).
  video: VideoRow
  title?: string
  onClose: () => void
}

// Athlete's view of coach feedback: the coach's narrated bubble recording,
// played alongside the original clip and the strokes they drew — all driven
// off the bubble's own clock (see hooks/useFeedbackReplay.ts). Marks itself
// viewed as soon as it's opened.
export function FeedbackViewer({ feedback, video, title, onClose }: Props) {
  const bubblePlayer = useVideoPlayer({ uri: feedback.bubbleVideoUrl }, (p) => {
    p.timeUpdateEventInterval = 0.1
  })
  const referencePlayer = useVideoPlayer({ uri: video.url }, (p) => {
    // The coach's narration is the only audio track that matters here.
    p.muted = true
  })

  // Diagnostic only (no auto-play here — see togglePlay, this viewer is
  // tap-to-play by design): logs whether the remote bubble video ever
  // reaches "readyToPlay" or lands on "error", since expo-video never
  // throws for a failed/stalled remote load — a blank bubble and a stuck
  // "loading" status look identical without this.
  useEffect(() => {
    const sub = bubblePlayer.addListener("statusChange", ({ status, error }) => {
      console.log("[feedback] viewer bubblePlayer status:", status, error ? `error: ${error.message}` : "")
    })
    return () => sub.remove()
  }, [bubblePlayer])

  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [videoAspect, setVideoAspect] = useState<VideoAspectSize | null>(() => getCachedVideoAspect(video.$id))
  const [isPlaying, setIsPlaying] = useState(false)
  const [positionMs, setPositionMs] = useState(0)
  const [durationMs, setDurationMs] = useState(0)
  const progressBarWidthRef = useRef(0)

  const { seekTo } = useFeedbackReplay(feedback.timeline, bubblePlayer, referencePlayer, setStrokes)

  useEffect(() => {
    console.log(
      "[feedback] viewer loaded timeline (", feedback.timeline.length, "events):",
      JSON.stringify(feedback.timeline)
    )
  }, [feedback.$id])

  useEffect(() => {
    if (!feedback.viewed) {
      markFeedbackViewed(feedback.$id).catch((e: any) =>
        console.warn("[feedback] markFeedbackViewed failed:", e?.message ?? e)
      )
    }
  }, [feedback.$id])

  // DrawingCanvas needs the reference clip's actual displayed aspect ratio.
  // videoTrack.size reports raw encoded dimensions, which don't account for
  // the rotation transform phone-recorded portrait clips carry — the
  // thumbnail's width/height reflect the actual visual frame instead (same
  // fix as CoachFeedbackRecorder.tsx). Gating render on this (below) instead
  // of guessing 16:9 avoids the same aspect-ratio flash bug.
  useEffect(() => {
    const cached = getCachedVideoAspect(video.$id)
    if (cached) { setVideoAspect(cached); return }
    let cancelled = false
    loadVideoAspect(video.$id, video.url).then((size) => {
      if (!cancelled) setVideoAspect(size)
    })
    return () => { cancelled = true }
  }, [video.$id, video.url])

  // The bubble recording is the master clock — its own play/pause/position
  // drive the header controls below.
  useEffect(() => {
    const playingSub = bubblePlayer.addListener("playingChange", ({ isPlaying: playing }) => setIsPlaying(playing))
    const timeSub = bubblePlayer.addListener("timeUpdate", ({ currentTime }) => {
      setPositionMs(currentTime * 1000)
      if (bubblePlayer.duration) setDurationMs(bubblePlayer.duration * 1000)
    })
    return () => {
      playingSub.remove()
      timeSub.remove()
    }
  }, [bubblePlayer])

  function togglePlay() {
    if (bubblePlayer.playing) bubblePlayer.pause()
    else bubblePlayer.play()
  }

  function handleSeekFraction(fraction: number) {
    if (durationMs <= 0) return
    seekTo(Math.max(0, Math.min(1, fraction)) * durationMs)
  }
  // scrubPanResponder below is created once (via useRef) — this ref keeps it
  // seeing the current handleSeekFraction closure (which itself closes over
  // durationMs) instead of the one from whichever render first mounted it.
  const handleSeekRef = useRef(handleSeekFraction)
  handleSeekRef.current = handleSeekFraction
  const scrubStartFractionRef = useRef(0)

  const scrubPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
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

  const progressPct = `${durationMs > 0 ? Math.min(100, (positionMs / durationMs) * 100) : 0}%` as any

  return (
    // RN <Modal> content needs its own GestureHandlerRootView on Android
    // (DrawingCanvas always mounts a GestureDetector even in read-only mode)
    // and its own SafeAreaProvider on iOS (otherwise insets resolve to 0 and
    // the close button sits under the status bar/notch). See the same
    // pattern in VideoPlayerModal.tsx.
    <SafeAreaProvider>
    <GestureHandlerRootView style={styles.root}>
      <DebugLogOverlay />
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8}>
            <Text style={styles.closeBtnText}>✕</Text>
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>{title ?? "Coach feedback"}</Text>
          <View style={{ width: 36 }} />
        </View>

        {videoAspect ? (
          <DrawingCanvas naturalSize={videoAspect} strokes={strokes} editable={false} style={styles.canvas}>
            <VideoView player={referencePlayer} style={StyleSheet.absoluteFill} contentFit="fill" nativeControls={false} pointerEvents="none" />
          </DrawingCanvas>
        ) : (
          <View style={[styles.canvas, styles.canvasLoading]}>
            <ActivityIndicator color={C.green} size="large" />
          </View>
        )}

        <View style={styles.bubbleCorner} pointerEvents="none">
          {/* Android's default SurfaceView rendering doesn't composite
              normally when two VideoViews overlap on screen (this one + the
              fullscreen reference clip above) — the non-frontmost one can
              render fully transparent while its container View still shows
              fine. textureView is expo-video's documented fix for this
              "overlapping video views" case (same fix as
              CoachFeedbackRecorder.tsx's review preview). */}
          <VideoView player={bubblePlayer} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} surfaceType="textureView" />
        </View>

        <View style={styles.controlBar}>
          <Pressable style={styles.playBtn} onPress={togglePlay}>
            <Text style={styles.playBtnText}>{isPlaying ? "⏸" : "▶"}</Text>
          </Pressable>
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
      </SafeAreaView>
    </GestureHandlerRootView>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: "#000", zIndex: 100 },
  safe: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12, gap: 12,
  },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center",
  },
  closeBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  headerTitle: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "700", textAlign: "center" },

  canvas: { flex: 1, backgroundColor: "#111" },
  canvasLoading: { alignItems: "center", justifyContent: "center" },

  bubbleCorner: {
    position: "absolute", bottom: 92, right: 16,
    width: 100, height: 140, borderRadius: 16, overflow: "hidden",
    borderWidth: 2, borderColor: "rgba(255,255,255,0.5)",
  },

  controlBar: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  playBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: C.green, alignItems: "center", justifyContent: "center",
  },
  playBtnText: { color: C.bg, fontSize: 18 },
  timeText: { color: "rgba(255,255,255,0.6)", fontSize: 12, width: 34, textAlign: "center" },
  progressTrack: { flex: 1, height: 28, justifyContent: "center" },
  progressBg: { position: "absolute", left: 0, right: 0, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.3)" },
  progressFilled: { position: "absolute", left: 0, height: 3, borderRadius: 2, backgroundColor: "white" },
})
