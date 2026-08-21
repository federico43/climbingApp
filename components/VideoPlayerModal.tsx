import { C } from "@/utils/theme"
import { CoachFeedbackRecorder } from "@/components/CoachFeedbackRecorder"
import { VideoRow } from "@/services/videoStorage"
import * as FileSystem from "expo-file-system/legacy"
import { useVideoPlayer, VideoPlayerStatus, VideoView } from "expo-video"
import React, { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context"

// ─── Types ────────────────────────────────────────────────────────────────────

// "watch" is the normal player (tap/double-tap/scrub/swipe-dismiss).
// "coach-recording" is the coach-only feedback flow — a narrated review
// recorded live (see CoachFeedbackRecorder). Both share one player instance
// so switching between them never restarts playback.
type Phase = "watch" | "coach-recording"

interface Props {
  uri: string | null
  title?: string
  onClose: () => void
  // When both are set, a "Feedback" button appears in the watch controls
  // (coach-only — athletes viewing their own clips never pass this).
  video?: VideoRow
  canGiveFeedback?: boolean
  // Skips straight past normal watch controls into the recording flow —
  // used when the coach taps the feedback icon directly on a clip card.
  startInFeedbackMode?: boolean
  onFeedbackSent?: () => void
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

export function VideoPlayerModal({ uri, title, onClose, video, canGiveFeedback, startInFeedbackMode, onFeedbackSent }: Props) {
  const insets = useSafeAreaInsets()

  const [phase, setPhase] = useState<Phase>(startInFeedbackMode && video ? "coach-recording" : "watch")
  const [isPlaying, setIsPlaying] = useState(false)
  const [positionMs, setPositionMs] = useState(0)
  const [durationMs, setDurationMs] = useState(0)
  const [seekFlash, setSeekFlash] = useState<"left" | "right" | null>(null)
  const [loadStatus, setLoadStatus] = useState<VideoPlayerStatus>("idle")

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

  // The clip downloads to local cache first, then plays entirely from disk —
  // like WhatsApp's video previews — instead of streaming straight off R2.
  // Streaming works, but on a constrained connection (cellular in particular)
  // the player's buffer drains faster than the network refills it, so
  // playback stutters every few seconds. Downloading first trades a visible
  // upfront wait for smooth, uninterrupted playback once it starts. Only
  // applies when we have a VideoRow — local file:// uris (already-local
  // clips) skip straight to playback.
  const [localUri, setLocalUri] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [downloadFailed, setDownloadFailed] = useState(false)

  // No source at all until we know what to play: a local file:// uri plays
  // immediately, a remote VideoRow waits for the download below (or its
  // failure, in which case we fall back to streaming rather than get stuck).
  // Nothing is created/fetched while waiting, so there's no bandwidth
  // contention between a download and a parallel stream.
  const isWaitingForDownload = !!video && !localUri && !downloadFailed
  const sourceUri = !video ? uri : (localUri ?? (downloadFailed ? uri : null))
  const player = useVideoPlayer(sourceUri ? { uri: sourceUri } : null, (p) => {
    p.timeUpdateEventInterval = 0.1
    p.play()
  })
  // PanResponder handlers below are created once (via useRef) and must never
  // close over a stale player instance from a later source swap.
  const playerRef = useRef(player)
  playerRef.current = player

  // Reset everything whenever a different clip is shown.
  useEffect(() => {
    setPhase(startInFeedbackMode && video ? "coach-recording" : "watch")
    setIsPlaying(false)
    setPositionMs(0)
    setDurationMs(0)
    setLocalUri(null)
    setDownloadProgress(0)
    setDownloadFailed(false)
    setLoadStatus("idle")
    positionMsRef.current = 0
    durationMsRef.current = 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri, video?.$id])

  // Kick off the local-file download once per clip, as soon as the modal
  // opens — regardless of watch vs. feedback phase, so casual viewers get
  // the same smooth-playback benefit as the coach's recording flow.
  const downloadStartedRef = useRef(false)
  useEffect(() => { downloadStartedRef.current = false }, [video?.$id])

  useEffect(() => {
    if (downloadStartedRef.current) return
    if (!video || !FileSystem.cacheDirectory) return
    downloadStartedRef.current = true
    let cancelled = false
    const dest = FileSystem.cacheDirectory + `clip-${video.$id}.mp4`
    let resumable: FileSystem.DownloadResumable | null = null
    try {
      resumable = FileSystem.createDownloadResumable(video.url, dest, {}, ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
        if (cancelled || totalBytesExpectedToWrite <= 0) return
        setDownloadProgress(totalBytesWritten / totalBytesExpectedToWrite)
      })
      resumable.downloadAsync()
        .then((result) => {
          if (cancelled || !result) return
          setLocalUri(result.uri)
        })
        .catch(() => { if (!cancelled) setDownloadFailed(true) })
    } catch {
      if (!cancelled) setDownloadFailed(true)
    }
    return () => {
      cancelled = true
      // Closing (or switching clips) mid-download shouldn't keep burning the
      // viewer's data in the background for a clip they're no longer looking at.
      resumable?.cancelAsync().catch(() => {})
    }
  }, [video?.$id, video?.url])

  // Cleanup is independent of the trigger above — scoped purely to clip
  // identity so it isn't re-run (and doesn't delete a download in progress)
  // on every phase change within the feedback flow.
  useEffect(() => {
    if (!video || !FileSystem.cacheDirectory) return
    const dest = FileSystem.cacheDirectory + `clip-${video.$id}.mp4`
    return () => {
      FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {})
    }
  }, [video?.$id])

  useEffect(() => {
    return () => {
      clearTimeout(hideTimerRef.current)
      clearTimeout(singleTapTimerRef.current)
      clearTimeout(seekFlashTimerRef.current)
    }
  }, [])

  // ── Playback status updates ─────────────────────────────────────────────────

  useEffect(() => {
    const playingSub = player.addListener("playingChange", ({ isPlaying: playing }) => {
      setIsPlaying(playing)
    })
    const timeSub = player.addListener("timeUpdate", ({ currentTime }) => {
      // Don't overwrite position while user is dragging the scrubber
      if (scrubCurrentRef.current === null) {
        const ms = currentTime * 1000
        setPositionMs(ms)
        positionMsRef.current = ms
      }
      if (player.duration) {
        const durMs = player.duration * 1000
        setDurationMs(durMs)
        durationMsRef.current = durMs
      }
    })
    // The player otherwise fails silently — a video that's stuck loading or
    // that errored out looks identical from the outside (frame 0, 0:00,
    // tapping play does nothing), so surface which one it actually is.
    const statusSub = player.addListener("statusChange", ({ status, error }) => {
      setLoadStatus(status)
      if (status === "error") {
        console.warn("[video] failed to load", sourceUri, error?.message)
      } else if (__DEV__) {
        // Confirms whether a "loading" flicker is really re-streaming from
        // the local file (shouldn't stall) vs. still pointed at the remote
        // URL for some reason.
        console.log("[video] status:", status, "isLocal:", sourceUri === localUri, "source:", sourceUri)
      }
    })
    return () => {
      playingSub.remove()
      timeSub.remove()
      statusSub.remove()
    }
  }, [player])

  // ── Controls visibility (watch phase only) ──────────────────────────────────

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
    if (player.playing) player.pause()
    else player.play()
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
      player.currentTime = next / 1000
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
        playerRef.current.currentTime = (pct * durationMsRef.current) / 1000
      },
      onPanResponderRelease: () => {
        const finalPct = scrubCurrentRef.current
        scrubCurrentRef.current = null
        setScrubProgress(null)
        if (finalPct !== null) {
          const ms = finalPct * durationMsRef.current
          playerRef.current.currentTime = ms / 1000
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

  // ── Swipe-down to dismiss (watch phase only) ────────────────────────────────

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

  // ── Feedback flow ────────────────────────────────────────────────────────────

  function enterCoachRecording() {
    player.pause()
    setPhase("coach-recording")
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const isScrubbing = scrubProgress !== null
  const displayProgress = isScrubbing ? scrubProgress! : (durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0)
  const progressPct = `${(displayProgress * 100).toFixed(1)}%` as any
  const showFeedbackButton = phase === "watch" && !!video && !!canGiveFeedback

  return (
    // A RN <Modal> renders into its own native window, so it inherits neither
    // the app-level GestureHandlerRootView (Android: DrawingCanvas's gestures
    // silently do nothing) nor the app-level SafeAreaProvider (iOS: insets
    // resolve to 0, so controls sit under the status bar/notch). Both need
    // their own instance in here. See the same gesture-handler pattern in
    // AthleteWorkoutBuilder.tsx.
    <SafeAreaProvider>
    <GestureHandlerRootView style={styles.root}>
    <Animated.View
      style={[styles.root, { transform: [{ translateY }] }]}
      {...(phase === "watch" ? panResponder.panHandlers : {})}
    >
      {isWaitingForDownload ? (
        <SafeAreaView style={fb.safe} edges={["top", "bottom"]}>
          <View style={fb.header}>
            <Pressable style={fb.closeBtn} onPress={onClose} hitSlop={8}>
              <Text style={fb.closeBtnText}>✕</Text>
            </Pressable>
            <Text style={fb.headerTitle}>Downloading…</Text>
            <View style={{ width: 40 }} />
          </View>
          <View style={fb.centerFill}>
            <ActivityIndicator color={C.green} size="large" />
            {downloadProgress > 0 && (
              <Text style={fb.recordHint}>{Math.round(downloadProgress * 100)}%</Text>
            )}
          </View>
        </SafeAreaView>
      ) : (
      <>
      {/* This VideoView only covers "watch" — coach-recording renders its own
          (wrapped in DrawingCanvas), see CoachFeedbackRecorder. The
          underlying player instance is unaffected either way: currentTime,
          mute state etc. live on `player`, not on whichever VideoView is
          currently bound to it, so switching phases never restarts
          playback. */}
      {phase === "watch" && (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          nativeControls={false}
        />
      )}

      {/* The video otherwise fails silently — a clip that's stuck buffering
          and one that's actually broken both just look like a frozen frame
          at 0:00, so make the state visible instead of leaving a dead-looking
          play button. */}
      {phase === "watch" && loadStatus === "loading" && (
        <View style={styles.loadOverlay} pointerEvents="none">
          <ActivityIndicator color="#fff" size="large" />
        </View>
      )}
      {phase === "watch" && loadStatus === "error" && (
        <View style={styles.loadOverlay} pointerEvents="none">
          <Text style={styles.loadErrorText}>Couldn't load this video</Text>
        </View>
      )}

      {phase === "watch" && (
        <>
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
              {showFeedbackButton && (
                <Pressable style={styles.feedbackButton} onPress={enterCoachRecording}>
                  <Text style={styles.feedbackButtonText}>Feedback</Text>
                </Pressable>
              )}
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
        </>
      )}

      {phase === "coach-recording" && video && (
        <CoachFeedbackRecorder
          player={player}
          video={video}
          positionMs={positionMs}
          durationMs={durationMs}
          onClose={onClose}
          onSent={() => { onFeedbackSent?.(); setPhase("watch") }}
        />
      )}
      </>
      )}
    </Animated.View>
    </GestureHandlerRootView>
    </SafeAreaProvider>
  )
}

// ─── Styles (watch phase) ──────────────────────────────────────────────────────

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
  feedbackButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: C.green,
  },
  feedbackButtonText: { color: C.bg, fontSize: 13, fontWeight: "700" },
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
  loadOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  loadErrorText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    fontWeight: "600",
    paddingHorizontal: 24,
    textAlign: "center",
  },
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

// ─── Styles (feedback flow phases) ─────────────────────────────────────────────

// Only used by the "Downloading…" screen above — the rest of the old
// feedback-flow styles moved to CoachFeedbackRecorder.tsx along with the JSX
// that used them.
const fb = StyleSheet.create({
  safe: { flex: 1 },
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
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  recordHint: { color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: "600" },
})
