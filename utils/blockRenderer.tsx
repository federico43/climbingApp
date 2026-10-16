import { C } from "@/utils/theme"
import CustomButton from "@/components/customButton"
import { ExplorationSessionBlock } from "@/components/ExplorationSessionBlock"
import { FourByFourBlock } from "@/components/FourByFourBlock"
import { IntervalsBlock } from "@/components/IntervalsBlock"
import { FreeSessionBlock } from "@/components/FreeSessionBlock"
import { ProjectBoulderingBlock } from "@/components/ProjectBoulderingBlock"
import { CoachedBlock } from "@/components/CoachedBlock"
import { BoulderLevelOptions } from "@/components/ProjectPickerModal"
import { SequenceBlock } from "@/components/SequenceBlock"
import { StrengthConditioningBlock } from "@/components/StrengthConditioningBlock"
import VideoRecorder from "@/components/VideoRecorder"
import type { Attempt, Block } from "@/hooks/WorkoutHook"
import { useBlockTimer } from "@/utils/blockTimer"
import WheelPicker from "@quidone/react-native-wheel-picker"
import React, { useEffect, useRef, useState } from "react"
import {
  Animated,
  KeyboardAvoidingView, Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native"
import { shared_styles, TopBar, warmup_styles } from "../utils/BlockStyles"
import { saveVideoLocally } from "./saveVideo"

// ─── Types ────────────────────────────────────────────────────────────────────

interface BlockRendererProps {
  block: Block | null
  attemptsDone: number
  logAttempt: (attempt: Omit<Attempt, "blockIndex" | "type" | "timestamp">) => void
  undoLastAttempt?: () => void
  updateLastAttempt?: (patch: Partial<Omit<Attempt, "blockIndex" | "type" | "timestamp">>) => void
  timeRemaining: number | null
  restTimeRemaining: number | null
  startRestTimer: (duration: number) => void
  attempts: Attempt[]
  currentBlockIndex: number
  goToNextBlock: () => void
  goToPreviousBlock: () => void   // always provided by parent; BlockRenderer gates it below
  blockStartTime?: number | null
}

// ─── Router ───────────────────────────────────────────────────────────────────

export function BlockRenderer({
  block,
  attemptsDone,
  logAttempt,
  timeRemaining,
  restTimeRemaining,
  startRestTimer,
  attempts,
  currentBlockIndex,
  goToNextBlock,
  goToPreviousBlock,
  blockStartTime,
  undoLastAttempt,
  updateLastAttempt,
}: BlockRendererProps) {
  if (!block) return null

  const blockAttempts = attempts.filter((a) => a.blockIndex === currentBlockIndex)
  const onPrevBlock = currentBlockIndex > 0 ? goToPreviousBlock : undefined

  // Run by the coach in person: title + Done (+ the coach's sequences),
  // whatever the block's type (docs/training-plan-implementation.md §12b).
  if (block.coached) {
    return (
      <CoachedBlock
        key={currentBlockIndex}
        block={block as any}
        attempts={blockAttempts}
        logAttempt={logAttempt}
        goToNextBlock={goToNextBlock}
        goToPreviousBlock={onPrevBlock}
      />
    )
  }

  switch (block.type) {
    case "project_bouldering":
      return (
        <ProjectBoulderingBlock
          block={block}
          logAttempt={logAttempt}
          updateLastAttempt={updateLastAttempt}
          undoLastAttempt={undoLastAttempt}
          restTimeRemaining={restTimeRemaining}
          startRestTimer={startRestTimer}
          attempts={blockAttempts}
          allAttempts={attempts}
          goToNextBlock={goToNextBlock}
          goToPreviousBlock={onPrevBlock}
        />
      )

    case "constraint_warmup":
      return (
        <ConstraintWarmupBlock
          block={block}
          attemptsDone={attemptsDone}
          logAttempt={logAttempt}
          attempts={blockAttempts}
          goToNextBlock={goToNextBlock}
          goToPreviousBlock={onPrevBlock}
          blockStartTime={blockStartTime ?? null}
        />
      )

    case "strength_conditioning":
      return (
        <StrengthConditioningBlock
          key={currentBlockIndex}
          block={block as any}
          goToNextBlock={goToNextBlock}
          goToPreviousBlock={onPrevBlock}
          logAttempt={logAttempt}
        />
      )

    case "exploration_session":
      return (
        <ExplorationSessionBlock
          block={block}
          logAttempt={logAttempt}
          goToNextBlock={goToNextBlock}
          goToPreviousBlock={onPrevBlock}
        />
      )

    case "sequence":
      return (
        <SequenceBlock
          key={currentBlockIndex}
          block={block as any}
          logAttempt={logAttempt}
          restTimeRemaining={restTimeRemaining}
          startRestTimer={startRestTimer}
          attempts={blockAttempts}
          goToNextBlock={goToNextBlock}
          goToPreviousBlock={onPrevBlock}
        />
      )

    case "free_session":
      return (
        <FreeSessionBlock
          block={block as any}
          logAttempt={logAttempt}
          goToNextBlock={goToNextBlock}
          goToPreviousBlock={onPrevBlock}
        />
      )

    case "four_by_four":
      return (
        <FourByFourBlock
          key={currentBlockIndex}
          block={block as any}
          logAttempt={logAttempt}
          restTimeRemaining={restTimeRemaining}
          startRestTimer={startRestTimer}
          attempts={blockAttempts}
          goToNextBlock={goToNextBlock}
          goToPreviousBlock={onPrevBlock}
        />
      )

    case "intervals":
      return (
        <IntervalsBlock
          key={currentBlockIndex}
          block={block as any}
          logAttempt={logAttempt}
          attempts={blockAttempts}
          goToNextBlock={goToNextBlock}
          goToPreviousBlock={onPrevBlock}
        />
      )

    default:
      return <Text>Unknown block type: {block.type}</Text>
  }
}

// ─── Constraint Warmup ────────────────────────────────────────────────────────

// A grade-colored pill (orange pill orange, blue blue, etc.) used wherever the
// boulder difficulty is shown.
function DifficultyPill({ level, fontSize = 18 }: { level: string; fontSize?: number }) {
  const opt = BoulderLevelOptions.find((o) => o.value === String(level).toLowerCase())
  return (
    <View style={{
      backgroundColor: opt?.color ?? C.green,
      borderRadius: 999, paddingHorizontal: 14, paddingVertical: 5,
    }}>
      <Text style={{
        fontSize, fontWeight: "800",
        color: opt?.on ?? C.bg, textTransform: "capitalize",
      }}>
        {opt?.label ?? level}
      </Text>
    </View>
  )
}

type Phase = "intro" | "ready" | "review"

interface ConstraintWarmupBlockProps {
  block: Block
  attemptsDone: number
  logAttempt: BlockRendererProps["logAttempt"]
  attempts: Attempt[]
  goToNextBlock: () => void
  goToPreviousBlock?: () => void
  blockStartTime?: number | null
}

function ConstraintWarmupBlock({
  block,
  logAttempt,
  attempts,
  goToNextBlock,
  goToPreviousBlock,
  blockStartTime,
}: ConstraintWarmupBlockProps) {
  const targetAttempts = block.targetAttempts ?? 1
  const attemptsDone = attempts.length
  // Revisiting a block that already met its target lands on the review state
  // (not the logging UI), so attempts are preserved and can't be over-logged.
  const [phase, setPhase] = useState<Phase>(() =>
    attemptsDone >= targetAttempts ? "review" : "intro"
  )
  const blockTimer = useBlockTimer()
  const [showCamera, setShowCamera] = useState(false)
  const [reviewElapsed, setReviewElapsed] = useState<number | null>(null)
  const counterScale = useRef(new Animated.Value(1)).current
  const logBtnScale = useRef(new Animated.Value(1)).current
  const plusOneOpacity = useRef(new Animated.Value(0)).current
  const plusOneY = useRef(new Animated.Value(0)).current

  const blockTitle = block.blockName || "Constraint warmup"
  // Never display more than the target (clamps a stray over-log at N/N).
  const displayDone = Math.min(attemptsDone, targetAttempts)

  function popCounter() {
    Animated.sequence([
      Animated.spring(counterScale, { toValue: 1.6, useNativeDriver: true, tension: 200, friction: 5 }),
      Animated.spring(counterScale, { toValue: 1, useNativeDriver: true, tension: 120, friction: 8 }),
    ]).start()
  }

  function flashLogButton() {
    // Reset the floating "+1"
    plusOneOpacity.setValue(0)
    plusOneY.setValue(0)

    Animated.parallel([
      // Button quick scale bounce
      Animated.sequence([
        Animated.spring(logBtnScale, { toValue: 0.94, useNativeDriver: true, tension: 300, friction: 6 }),
        Animated.spring(logBtnScale, { toValue: 1, useNativeDriver: true, tension: 200, friction: 8 }),
      ]),
      // Floating "+1" that rises and fades
      Animated.sequence([
        Animated.timing(plusOneOpacity, { toValue: 1, duration: 120, useNativeDriver: true }),
        Animated.timing(plusOneY, { toValue: -40, duration: 600, useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.delay(300),
        Animated.timing(plusOneOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]),
    ]).start()
  }

  // Snapshot block duration when entering review
  useEffect(() => {
    if (phase === "review" && reviewElapsed === null) {
      const start = blockStartTime ?? attempts[0]?.timestamp ?? Date.now()
      setReviewElapsed(Math.floor((Date.now() - start) / 1000))
    }
  }, [phase, blockStartTime, attempts, reviewElapsed])

  async function handleFinishRecording(videoUri: string) {
    setShowCamera(false)
    // The recorder's uri is a temp file that saveVideoLocally moves away, so
    // the attempt has to point at the saved copy.
    const saved = await saveVideoLocally(videoUri, block.type, { grade: (block as any).level })
    logAttempt({ success: true, video: saved ?? undefined })
    if (attemptsDone + 1 >= targetAttempts) {
      setPhase("review")
    }
  }

  if (phase === "intro") {
    return (
      <View style={shared_styles.screen}>
        <TopBar title={blockTitle} onBack={goToPreviousBlock} />
        <ScrollView

          contentContainerStyle={shared_styles.introContent}
          keyboardShouldPersistTaps="handled"
        >
          {!!(block as any).level && (
            <View style={{
              flexDirection: "row", alignItems: "center", justifyContent: "center",
              flexWrap: "wrap", gap: 8, marginTop: 4, marginBottom: 8,
            }}>
              <Text style={{ fontSize: 22, fontWeight: "800", color: C.textPrimary }}>
                {targetAttempts}
              </Text>
              <DifficultyPill level={String((block as any).level)} />
              <Text style={{ fontSize: 22, fontWeight: "800", color: C.textPrimary }}>
                boulders
              </Text>
            </View>
          )}
          {!!block.description && (
            <Text style={shared_styles.description}>{block.description}</Text>
          )}
          <CustomButton title="Start" onPress={() => { blockTimer.start(); setPhase("ready") }} />
        </ScrollView>
      </View>
    )
  }

  if (phase === "ready") {
    return (
      <View style={shared_styles.screen}>
        <TopBar title={blockTitle} onBack={() => setPhase("intro")} />
        {/* Centered status: difficulty pill + progress counter */}
        <View style={cwStyles.readyCenter}>
          {!!(block as any).level && (
            <View style={{ marginBottom: 8 }}>
              <DifficultyPill level={String((block as any).level)} fontSize={22} />
            </View>
          )}
          <Animated.Text style={[warmup_styles.progress, { transform: [{ scale: counterScale }] }]}>
            {displayDone} / {targetAttempts}
          </Animated.Text>
        </View>
        <View style={cwStyles.readySpacer} />
        {/* Controls pinned to the bottom */}
        <View style={cwStyles.footer}>
          <View style={cwStyles.controls}>
            <Pressable style={cwStyles.recordBtn} onPress={() => setShowCamera(true)}>
              <Text style={cwStyles.recordBtnText}>Record</Text>
            </Pressable>
            <Animated.View style={{ transform: [{ scale: logBtnScale }], flex: 1 }}>
              <Pressable
                style={cwStyles.registerBtn}
                onPress={() => {
                  flashLogButton()
                  logAttempt({ success: true })
                  if (attemptsDone + 1 >= targetAttempts) {
                    setTimeout(() => setPhase("review"), 200)
                  } else {
                    popCounter()
                  }
                }}
              >
                <Text style={cwStyles.registerBtnText}>Register Climb</Text>
                <Animated.Text
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    right: 14,
                    color: C.bg,
                    fontSize: 16,
                    fontWeight: "800",
                    opacity: plusOneOpacity,
                    transform: [{ translateY: plusOneY }],
                  }}
                >
                  +1
                </Animated.Text>
              </Pressable>
            </Animated.View>
          </View>
        </View>
        {showCamera && (
          <View style={warmup_styles.cameraOverlay}>
            <VideoRecorder onFinish={handleFinishRecording} onClose={() => setShowCamera(false)} />
          </View>
        )}
      </View>
    )
  }

  if (phase === "review") {
    const t = reviewElapsed ?? 0
    const mm = Math.floor(t / 60)
    const ss = t % 60
    const timeStr = mm > 0
      ? (ss === 0 ? `${mm}m` : `${mm}m ${ss}s`)
      : `${ss}s`
    return (
      <View style={shared_styles.screen}>
        <TopBar title="Complete" />
        <View style={[shared_styles.container, { justifyContent: "center", gap: 8 }]}>
          <Text style={shared_styles.title}>Exercise complete</Text>
          <Text style={{ fontSize: 56, fontWeight: "800", color: C.green, fontVariant: ["tabular-nums"] }}>
            {timeStr}
          </Text>
          <Text style={{ fontSize: 13, color: C.textSecondary, marginBottom: 24 }}>total time</Text>
          <View style={{ width: "100%" }}>
            <CustomButton title="Continue" onPress={goToNextBlock} />
          </View>
        </View>
      </View>
    )
  }

  return null
}

// Constraint-warmup ready-phase controls — same look as the sequence active
// buttons (side-by-side rounded), with the register action emphasized in green.
const cwStyles = StyleSheet.create({
  readyCenter: { alignItems: "center", paddingHorizontal: 20, paddingTop: 24, paddingBottom: 8 },
  readySpacer: { flex: 1 },
  footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32 },
  controls: { flexDirection: "row", gap: 10, width: "100%" },
  recordBtn: {
    flex: 1, backgroundColor: C.surfaceHigh, borderRadius: 22,
    paddingVertical: 14, alignItems: "center", justifyContent: "center",
  },
  recordBtnText: { color: C.textPrimary, fontSize: 15, fontWeight: "700" },
  registerBtn: {
    flex: 1, backgroundColor: C.green, borderRadius: 22,
    paddingVertical: 14, alignItems: "center", justifyContent: "center",
  },
  registerBtnText: { color: C.bg, fontSize: 15, fontWeight: "800" },
})
