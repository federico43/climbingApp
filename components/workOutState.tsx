import { C } from "@/utils/theme"
import { useWorkout } from "@/hooks/WorkoutHook"
import { BlockRenderer } from "@/utils/blockRenderer"
import { BlockTimerContext } from "@/utils/blockTimer"
import { Ionicons } from "@expo/vector-icons"
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { useEffect, useMemo, useRef, useState } from "react"
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context"
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated"
import CustomButton from "./customButton"

// ─── Block slide-in wrapper ───────────────────────────────────────────────────

function BlockEntry({ children }: { children: React.ReactNode }) {
  const opacity = useSharedValue(0)
  const translateX = useSharedValue(28)

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 240 })
    translateX.value = withSpring(0, { damping: 20, stiffness: 260 })
  }, [])

  const animStyle = useAnimatedStyle(() => ({
    flex: 1,
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }],
  }))

  return <Animated.View style={animStyle}>{children}</Animated.View>
}

// ─── WorkOutState ─────────────────────────────────────────────────────────────

export function WorkOutState({
  protocol,
  protocolName,
  onWorkoutEnd,
  onWorkoutStart,
  onClose,
  onMinimize,
  autoStart = false,
  workout,
  onSetCoached,
}: {
  protocol: any[]
  protocolName: string
  onWorkoutEnd: () => void
  onWorkoutStart: () => void
  onClose?: () => void
  onMinimize?: () => void
  autoStart?: boolean
  workout: ReturnType<typeof useWorkout>
  // Switches the current block between guided and coached (§12a). Omitted →
  // no switch.
  onSetCoached?: (index: number, coached: boolean) => void
}) {
  const {
    currentBlock,
    attemptsDone,
    status,
    timeRemaining,
    restTimeRemaining,
    logAttempt,
    undoLastAttempt,
    startWorkout,
    startRestTimer,
    currentBlockIndex,
    totalBlocks,
    isLastBlock,
    resetWorkout,
    goToNextBlock,
    goToPreviousBlock,
    skipBlock,
    attempts,
    blockDurations,
    blockStartTime,
    workoutStartTime,
    skippedBlocks,
  } = workout

  // On the final block, advancing finishes the workout — make that deliberate
  // so an accidental tap can't end (and save) the session by surprise.
  function handleNext() {
    if (isLastBlock) {
      Alert.alert("Finish workout?", "This will end and save your session.", [
        { text: "Cancel", style: "cancel" },
        { text: "Finish", style: "default", onPress: goToNextBlock },
      ])
    } else {
      goToNextBlock()
    }
  }

  function handleSkip() {
    Alert.alert(
      "Skip this block?",
      "It won't be saved or shown in your workout summary.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Skip", style: "destructive", onPress: skipBlock },
      ]
    )
  }

  const insets = useSafeAreaInsets()
  const didAutoStart = useRef(false)
  const [workoutElapsed, setWorkoutElapsed] = useState(0)

  // Time-constraint countdown arms when the block signals it started (Start
  // pressed), not on block entry. Reset whenever the block changes.
  const [timerStartedAt, setTimerStartedAt] = useState<number | null>(null)
  useEffect(() => { setTimerStartedAt(null) }, [currentBlockIndex])
  const blockTimer = useMemo(
    () => ({ start: () => setTimerStartedAt((t) => t ?? Date.now()) }),
    [],
  )

  // Total time spans the real workout — workoutStartTime lives in the hook, so
  // it's the original start even after a resume (not the resume moment).
  useEffect(() => {
    if (status === "completed" && workoutStartTime !== null) {
      setWorkoutElapsed(Math.floor((Date.now() - workoutStartTime) / 1000))
    }
  }, [status, workoutStartTime])

  function handleStartWorkout() {
    onWorkoutStart()
    startWorkout()
  }

  useEffect(() => {
    if (autoStart && !didAutoStart.current && currentBlock) {
      didAutoStart.current = true
      onWorkoutStart()
      startWorkout()
    }
  }, [])

  if (status === "idle") {
    return (
      <SafeAreaView style={[styles.container, styles.centeredScreen, { paddingTop: insets.top }]} edges={["bottom"]}>
        {onClose && (
          <Pressable
            onPress={() => { onWorkoutEnd(); resetWorkout() }}
            style={styles.closeButton}
          >
            <Text style={styles.closeButtonText}>✕</Text>
          </Pressable>
        )}
        <Text style={styles.title}>Training protocols</Text>
        {currentBlock ? (
          <Pressable style={styles.card} onPress={handleStartWorkout}>
            <Text style={styles.cardTitle}>{protocolName}</Text>
            <Text style={styles.cardSubtitle}>
              {totalBlocks} block{totalBlocks !== 1 ? "s" : ""} · Tap to start
            </Text>
          </Pressable>
        ) : (
          <Text style={styles.emptyState}>No protocol available.</Text>
        )}
      </SafeAreaView>
    )
  }

  if (status === "completed") {
    const h = Math.floor(workoutElapsed / 3600)
    const m = Math.floor((workoutElapsed % 3600) / 60)
    const s = workoutElapsed % 60
    const timeStr = h > 0
      ? `${h}h ${m}m`
      : m > 0 ? `${m}m ${s}s` : `${s}s`

    // Skipped blocks are omitted from the summary (and never saved).
    const completedBlocks = protocol
      .map((block: any, i: number) => ({ block, originalIndex: i }))
      .filter(({ originalIndex }) => !skippedBlocks.has(originalIndex))

    return (
      <SafeAreaView style={[styles.container, { paddingTop: insets.top }]} edges={["bottom"]}>
        {/* Top bar with exit button */}
        <View style={styles.progressBar}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressText}>Summary</Text>
            <Pressable
              hitSlop={8}
              onPress={() => {
                Alert.alert(
                  "Exit workout",
                  "Close the workout summary?",
                  [
                    { text: "Stay", style: "cancel" },
                    {
                      text: "Exit",
                      style: "destructive",
                      onPress: () => { onWorkoutEnd(); resetWorkout() },
                    },
                  ]
                )
              }}
            >
              <Text style={styles.exitButton}>✕</Text>
            </Pressable>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.summaryScroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.summaryCheck}>✓</Text>
          <Text style={styles.summaryTitle}>Workout complete</Text>
          <Text style={styles.summaryProto}>{protocolName}</Text>

          <View style={styles.summaryStats}>
            <View style={styles.summaryStat}>
              <Text style={styles.summaryStatNum}>{timeStr}</Text>
              <Text style={styles.summaryStatLabel}>total time</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryStat}>
              <Text style={styles.summaryStatNum}>{completedBlocks.length}</Text>
              <Text style={styles.summaryStatLabel}>block{completedBlocks.length !== 1 ? "s" : ""}{"\n"}completed</Text>
            </View>
          </View>

          <View style={styles.summaryBlockList}>
            {completedBlocks.map(({ block, originalIndex }, i) => {
              const dur = blockDurations[originalIndex] ?? 0
              const dm = Math.floor(dur / 60)
              const ds = dur % 60
              const durStr = dm > 0
                ? (ds === 0 ? `${dm}m` : `${dm}m ${ds}s`)
                : `${ds}s`
              return (
                <View key={originalIndex} style={styles.summaryBlockRow}>
                  <Text style={styles.summaryBlockIndex}>{i + 1}</Text>
                  <Text style={styles.summaryBlockName} numberOfLines={1}>
                    {block.blockName || "Block"}
                  </Text>
                  <Text style={styles.summaryBlockDuration}>{durStr}</Text>
                  <Text style={styles.summaryBlockCheck}>✓</Text>
                </View>
              )
            })}
          </View>

          <CustomButton
            title="Save workout"
            onPress={() => { onWorkoutEnd(); resetWorkout() }}
          />
        </ScrollView>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <View style={[styles.progressBar, { paddingTop: insets.top + 12 }]}>
        <View style={styles.progressHeader}>
          <Text style={styles.progressText}>
            Block {currentBlockIndex + 1} of {totalBlocks}
          </Text>
          <View style={styles.progressActions}>
            {(currentBlock?.timeLimit ?? 0) > 0 && !SELF_TIMED_BLOCKS.has(currentBlock?.type ?? "") && timerStartedAt !== null && (
              <BlockCountdown key={currentBlockIndex} minutes={currentBlock.timeLimit ?? 0} />
            )}
            <Pressable onPress={handleSkip} style={styles.skipBtn} hitSlop={10}>
              <Text style={styles.skipBtnText}>Skip</Text>
              <Ionicons name="play-skip-forward" size={14} color={C.textSecondary} />
            </Pressable>
            {onMinimize && (
              <Pressable onPress={onMinimize} style={styles.minimizeBtn} hitSlop={10}>
                <Ionicons name="chevron-down" size={18} color={C.textSecondary} />
              </Pressable>
            )}
            <Pressable
              hitSlop={8}
              onPress={() => {
                Alert.alert(
                  "Exit workout",
                  "Are you sure you want to cancel this workout?",
                  [
                    { text: "Keep going", style: "cancel" },
                    {
                      text: "Exit",
                      style: "destructive",
                      onPress: () => {
                        onWorkoutEnd()
                        resetWorkout()
                      },
                    },
                  ]
                )
              }}
            >
              <Text style={styles.exitButton}>✕</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${((currentBlockIndex + 1) / totalBlocks) * 100}%` },
            ]}
          />
        </View>
      </View>
      {/* Coach is here / On my own — only before anything's logged on the block. */}
      {onSetCoached && currentBlock && !attempts.some((a) => a.blockIndex === currentBlockIndex) && (
        <Pressable
          style={[styles.coachSwitch, currentBlock.coached && styles.coachSwitchOn]}
          onPress={() => onSetCoached(currentBlockIndex, !currentBlock.coached)}
          hitSlop={6}
        >
          <Ionicons
            name={currentBlock.coached ? "person" : "person-outline"}
            size={13}
            color={currentBlock.coached ? C.bg : C.textSecondary}
          />
          <Text style={[styles.coachSwitchText, currentBlock.coached && { color: C.bg }]}>
            {currentBlock.coached ? "Coach is here · switch to on my own" : "Coach is here?"}
          </Text>
        </Pressable>
      )}
      <BlockEntry key={`${currentBlockIndex}-${currentBlock?.coached ? "c" : "g"}`}>
        <BlockTimerContext.Provider value={blockTimer}>
          <BlockRenderer
            block={currentBlock}
            attemptsDone={attemptsDone}
            logAttempt={logAttempt}
            undoLastAttempt={undoLastAttempt}
            timeRemaining={timeRemaining}
            restTimeRemaining={restTimeRemaining}
            startRestTimer={startRestTimer}
            attempts={attempts}
            currentBlockIndex={currentBlockIndex}
            goToNextBlock={handleNext}
            goToPreviousBlock={goToPreviousBlock}
            blockStartTime={blockStartTime}
          />
        </BlockTimerContext.Provider>
      </BlockEntry>
    </SafeAreaView>
  )
}

// Blocks that render their own time display (countdown or work/rest) — the host
// chip would duplicate it, so skip them.
const SELF_TIMED_BLOCKS = new Set(["exploration_session", "intervals", "free_session"])

// Per-block countdown for blocks that carry a time constraint. Remounts per
// block (keyed by index), turns red and reads "Time's up" at zero — it never
// auto-advances, so the athlete decides when to move on.
function BlockCountdown({ minutes }: { minutes: number }) {
  const total = Math.max(0, Math.round(minutes * 60))
  const [remaining, setRemaining] = useState(total)
  useEffect(() => {
    const end = Date.now() + total * 1000
    const id = setInterval(() => {
      const r = Math.max(0, Math.ceil((end - Date.now()) / 1000))
      setRemaining(r)
      if (r <= 0) clearInterval(id)
    }, 250)
    return () => clearInterval(id)
  }, [total])
  const over = remaining <= 0
  const m = Math.floor(remaining / 60)
  const s = remaining % 60
  return (
    <View style={[styles.countdownChip, over && styles.countdownChipOver]}>
      <Ionicons name="time-outline" size={13} color={over ? C.bg : C.green} />
      <Text style={[styles.countdownText, over && styles.countdownTextOver]}>
        {over ? "Time's up" : `${m}:${String(s).padStart(2, "0")}`}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  centeredScreen: {
    alignItems: "center",
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: C.textPrimary,
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: C.textSecondary,
    marginBottom: 24,
  },
  emptyState: {
    fontSize: 16,
    color: C.textMuted,
    marginTop: 40,
  },
  closeButton: {
    alignSelf: "flex-end",
    padding: 8,
    marginBottom: 4,
  },
  closeButtonText: {
    fontSize: 18,
    color: C.textMuted,
  },
  card: {
    width: "100%",
    padding: 20,
    borderRadius: 16,
    backgroundColor: C.green,
    marginTop: 20,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: C.bg,
    marginBottom: 6,
  },
  cardSubtitle: {
    fontSize: 14,
    color: "rgba(36,35,37,0.55)",
  },
  progressBar: {
    width: "100%",
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  progressText: {
    fontSize: 13,
    color: C.textSecondary,
    textAlign: "center",
  },
  progressTrack: {
    width: "100%",
    height: 4,
    backgroundColor: C.border,
    borderRadius: 2,
  },
  progressFill: {
    height: 4,
    backgroundColor: C.green,
    borderRadius: 2,
  },
  progressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  countdownChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: C.surfaceHigh, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 5,
    borderWidth: 1, borderColor: C.green,
  },
  countdownChipOver: { backgroundColor: C.red, borderColor: C.red },
  countdownText: { fontSize: 13, fontWeight: "800", color: C.green, fontVariant: ["tabular-nums"] },
  countdownTextOver: { color: C.bg },
  progressActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  coachSwitch: {
    flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6,
    marginHorizontal: 20, marginTop: 8, marginBottom: 2,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    borderWidth: 1, borderColor: C.border,
  },
  coachSwitchOn: { backgroundColor: C.green, borderColor: C.green },
  coachSwitchText: { fontSize: 12, fontWeight: "700", color: C.textSecondary },
  skipBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: C.surfaceHigh,
    borderRadius: 14,
    paddingHorizontal: 10,
    height: 28,
  },
  skipBtnText: {
    fontSize: 13, fontWeight: "600", color: C.textSecondary,
  },
  minimizeBtn: {
    backgroundColor: C.surfaceHigh,
    borderRadius: 14, width: 28, height: 28,
    alignItems: "center", justifyContent: "center",
  },
  minimizeBtnText: {
    fontSize: 20, fontWeight: "700",
    color: C.textSecondary, lineHeight: 22, marginTop: -2,
  },
  exitButton: {
    fontSize: 16,
    color: C.textMuted,
    padding: 4,
  },

  // Summary screen
  summaryScroll: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 16,
  },
  summaryCheck: {
    fontSize: 64,
    color: C.green,
    lineHeight: 72,
  },
  summaryTitle: {
    fontSize: 26,
    fontWeight: "700",
    color: C.textPrimary,
    textAlign: "center",
  },
  summaryProto: {
    fontSize: 15,
    color: C.textSecondary,
    textAlign: "center",
    marginBottom: 8,
  },
  summaryStats: {
    flexDirection: "row",
    backgroundColor: C.surface,
    borderRadius: 18,
    paddingVertical: 20,
    width: "100%",
    marginBottom: 8,
  },
  summaryStat: {
    flex: 1,
    alignItems: "center",
    gap: 6,
  },
  summaryDivider: {
    width: 1,
    backgroundColor: C.border,
    marginVertical: 4,
  },
  summaryStatNum: {
    fontSize: 28,
    fontWeight: "800",
    color: C.green,
    fontVariant: ["tabular-nums"],
  },
  summaryStatLabel: {
    fontSize: 12,
    color: C.textSecondary,
    textAlign: "center",
    lineHeight: 16,
  },
  summaryBlockList: {
    width: "100%",
    backgroundColor: C.surface,
    borderRadius: 18,
    overflow: "hidden",
    marginBottom: 8,
  },
  summaryBlockRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
    gap: 12,
  },
  summaryBlockIndex: {
    fontSize: 12,
    fontWeight: "700",
    color: C.textMuted,
    width: 18,
    textAlign: "center",
  },
  summaryBlockName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    color: C.textPrimary,
  },
  summaryBlockDuration: {
    fontSize: 13,
    fontWeight: "600",
    color: C.textSecondary,
    fontVariant: ["tabular-nums"],
    marginRight: 10,
  },
  summaryBlockCheck: {
    fontSize: 14,
    color: C.green,
  },
})