import { AVPlaybackStatus, ResizeMode, Video } from "expo-av"
import React, { useCallback, useEffect, useRef, useState } from "react"
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  uri: string | null
  title?: string
  onClose: () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

const SEEK_MS = 10_000
const CONTROLS_HIDE_DELAY = 3000

// ─── Component ────────────────────────────────────────────────────────────────

export function VideoPlayerModal({ uri, title, onClose }: Props) {
  const insets = useSafeAreaInsets()
  const videoRef = useRef<Video>(null)

  const [isPlaying, setIsPlaying] = useState(false)
  const [positionMs, setPositionMs] = useState(0)
  const [durationMs, setDurationMs] = useState(0)
  const [seekFlash, setSeekFlash] = useState<"left" | "right" | null>(null)

  // Animated values
  const controlsOpacity = useRef(new Animated.Value(1)).current
  const translateY = useRef(new Animated.Value(0)).current

  // Refs
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const seekFlashTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const progressBarWidthRef = useRef(0)
  const lastTapRef = useRef<{ time: number; side: "left" | "right" } | null>(null)

  // Scrubber drag — refs so PanResponder (created once) always sees fresh values
  const positionMsRef = useRef(0)
  const durationMsRef = useRef(0)
  const scrubStartProgressRef = useRef(0)
  const scrubCurrentRef = useRef<number | null>(null)
  const [scrubProgress, setScrubProgress] = useState<number | null>(null)

  useEffect(() => {
    return () => {
      videoRef.current?.pauseAsync()
      clearTimeout(hideTimerRef.current)
      clearTimeout(singleTapTimerRef.current)
      clearTimeout(seekFlashTimerRef.current)
    }
  }, [])

  // ── Playback status updates ─────────────────────────────────────────────────

  function handlePlaybackStatus(status: AVPlaybackStatus) {
    if (!status.isLoaded) return
    setIsPlaying(status.isPlaying)
    // Don't overwrite position while user is dragging the scrubber
    if (scrubCurrentRef.current === null) {
      setPositionMs(status.positionMillis)
      positionMsRef.current = status.positionMillis
    }
    if (status.durationMillis) {
      setDurationMs(status.durationMillis)
      durationMsRef.current = status.durationMillis
    }
  }

  // ── Controls visibility ─────────────────────────────────────────────────────

  const showControls = useCallback(() => {
    Animated.timing(controlsOpacity, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start()
    clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => {
      Animated.timing(controlsOpacity, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }).start()
    }, CONTROLS_HIDE_DELAY)
  }, [controlsOpacity])

  useEffect(() => { showControls() }, [])

  // ── Tap handling ────────────────────────────────────────────────────────────

  function togglePlayPause() {
    if (isPlaying) videoRef.current?.pauseAsync()
    else videoRef.current?.playAsync()
  }

  function handleCenterTap() {
    showControls()
    togglePlayPause()
  }

  function handleEdgeTap(side: "left" | "right") {
    const now = Date.now()
    const last = lastTapRef.current

    if (last?.side === side && now - last.time < 350) {
      lastTapRef.current = null
      clearTimeout(singleTapTimerRef.current)
      const delta = side === "left" ? -SEEK_MS : SEEK_MS
      const next = Math.max(0, Math.min(durationMs, positionMs + delta))
      videoRef.current?.setPositionAsync(next)
      clearTimeout(seekFlashTimerRef.current)
      setSeekFlash(side)
      seekFlashTimerRef.current = setTimeout(() => setSeekFlash(null), 700)
      showControls()
    } else {
      lastTapRef.current = { time: now, side }
      clearTimeout(singleTapTimerRef.current)
      singleTapTimerRef.current = setTimeout(() => {
        if (lastTapRef.current?.time === now) {
          lastTapRef.current = null
          showControls()
          togglePlayPause()
        }
      }, 360)
    }
  }

  // ── Progress bar scrubber ───────────────────────────────────────────────────

  const scrubPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        // Capture where the touch started as the initial scrub position
        const pct = Math.max(0, Math.min(1, e.nativeEvent.locationX / progressBarWidthRef.current))
        scrubStartProgressRef.current = pct
        scrubCurrentRef.current = pct
        setScrubProgress(pct)
        showControls()
      },
      onPanResponderMove: (_, { dx }) => {
        if (!progressBarWidthRef.current) return
        const pct = Math.max(0, Math.min(1, scrubStartProgressRef.current + dx / progressBarWidthRef.current))
        scrubCurrentRef.current = pct
        setScrubProgress(pct)
        // Seek continuously for live preview
        videoRef.current?.setPositionAsync(pct * durationMsRef.current)
      },
      onPanResponderRelease: () => {
        const finalPct = scrubCurrentRef.current
        scrubCurrentRef.current = null
        setScrubProgress(null)
        if (finalPct !== null) {
          const ms = finalPct * durationMsRef.current
          videoRef.current?.setPositionAsync(ms)
          positionMsRef.current = ms
          setPositionMs(ms)
        }
      },
      onPanResponderTerminate: () => {
        scrubCurrentRef.current = null
        setScrubProgress(null)
      },
    })
  ).current

  // ── Swipe-down to dismiss ───────────────────────────────────────────────────

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, { dy, dx }) =>
        dy > 10 && dy > Math.abs(dx) * 1.5,
      onPanResponderMove: (_, { dy }) => {
        if (dy > 0) translateY.setValue(dy)
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 120 || vy > 0.9) {
          Animated.timing(translateY, {
            toValue: 900,
            duration: 260,
            useNativeDriver: true,
          }).start(() => onCloseRef.current())
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 6,
          }).start()
        }
      },
    })
  ).current

  // ── Render ──────────────────────────────────────────────────────────────────

  const isScrubbing = scrubProgress !== null
  const displayProgress = isScrubbing ? scrubProgress! : (durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0)
  const progressPct = `${(displayProgress * 100).toFixed(1)}%` as any

  return (
    <Animated.View style={[styles.root, { transform: [{ translateY }] }]} {...panResponder.panHandlers}>

      <Video
        ref={videoRef}
        source={{ uri: uri ?? "" }}
        style={StyleSheet.absoluteFill}
        resizeMode={ResizeMode.CONTAIN}
        shouldPlay
        onPlaybackStatusUpdate={handlePlaybackStatus}
      />

      {/* Swipe hint pill */}
      <View style={styles.swipeHint} pointerEvents="none">
        <View style={styles.swipeHintBar} />
      </View>

      {/* Tap zones */}
      <View style={[StyleSheet.absoluteFill, styles.tapRow]} pointerEvents="box-none">
        <Pressable style={styles.tapZone} onPress={() => handleEdgeTap("left")} />
        <Pressable style={styles.tapZoneCenter} onPress={handleCenterTap} />
        <Pressable style={styles.tapZone} onPress={() => handleEdgeTap("right")} />
      </View>

      {/* Seek flash badges */}
      {seekFlash === "left" && (
        <View style={[styles.seekBadge, styles.seekBadgeLeft]} pointerEvents="none">
          <Text style={styles.seekBadgeText}>◄◄ {SEEK_MS / 1000}s</Text>
        </View>
      )}
      {seekFlash === "right" && (
        <View style={[styles.seekBadge, styles.seekBadgeRight]} pointerEvents="none">
          <Text style={styles.seekBadgeText}>{SEEK_MS / 1000}s ►►</Text>
        </View>
      )}

      {/* Controls overlay */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.controls, { opacity: controlsOpacity }]} pointerEvents="box-none">

        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
          <Pressable style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>✕</Text>
          </Pressable>
          {title ? <Text style={styles.videoTitle} numberOfLines={1}>{title}</Text> : null}
        </View>

        <Pressable style={styles.playPauseButton} onPress={handleCenterTap}>
          <Text style={styles.playPauseIcon}>{isPlaying ? "⏸" : "▶"}</Text>
        </Pressable>

        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 10 }]}>
          <Text style={styles.timeText}>
            {isScrubbing ? formatTime(displayProgress * durationMs) : formatTime(positionMs)}
          </Text>

          <View
            style={styles.progressTrack}
            onLayout={(e) => { progressBarWidthRef.current = e.nativeEvent.layout.width }}
            {...scrubPanResponder.panHandlers}
          >
            <View style={styles.progressBg} pointerEvents="none" />
            <View style={[styles.progressFilled, { width: progressPct }]} pointerEvents="none" />
            <View style={[styles.progressThumb, isScrubbing && styles.progressThumbActive, { left: progressPct }]} pointerEvents="none" />
          </View>

          <Text style={styles.timeText}>{formatTime(durationMs)}</Text>
        </View>
      </Animated.View>

    </Animated.View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
  },
  swipeHint: {
    position: "absolute",
    top: 10,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 10,
  },
  swipeHintBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  tapRow: {
    flexDirection: "row",
  },
  tapZone: { flex: 1 },
  tapZoneCenter: { flex: 1.4 },
  seekBadge: {
    position: "absolute",
    top: "42%",
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 24,
  },
  seekBadgeLeft: { left: 24 },
  seekBadgeRight: { right: 24 },
  seekBadgeText: {
    color: "white",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  controls: {
    justifyContent: "space-between",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 12,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeButtonText: { color: "white", fontSize: 15, fontWeight: "700" },
  videoTitle: {
    flex: 1,
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    fontWeight: "600",
  },
  playPauseButton: {
    alignSelf: "center",
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  playPauseIcon: { fontSize: 26, color: "white" },
  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  timeText: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 12,
    fontWeight: "600",
    width: 38,
    textAlign: "center",
  },
  progressTrack: {
    flex: 1,
    height: 28,
    justifyContent: "center",
  },
  progressBg: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  progressFilled: {
    position: "absolute",
    left: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: "white",
  },
  progressThumb: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "white",
    top: 7,
    marginLeft: -7,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  progressThumbActive: {
    width: 20,
    height: 20,
    borderRadius: 10,
    top: 4,
    marginLeft: -10,
  },
})
