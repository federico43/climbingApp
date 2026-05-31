import { C } from "@/utils/theme"
import CustomButton from "@/components/customButton"
import { ExplorationSessionBlock } from "@/components/ExplorationSessionBlock"
import { FreeSessionBlock } from "@/components/FreeSessionBlock"
import { ProjectPickerModal } from "@/components/ProjectPickerModal"
import { SequenceBlock } from "@/components/SequenceBlock"
import { StrengthConditioningBlock } from "@/components/StrengthConditioningBlock"
import VideoRecorder from "@/components/VideoRecorder"
import type { Attempt, Block } from "@/hooks/WorkoutHook"
import { markProjectSent, ProjectRow } from "@/services/BoulderGraphService"
import WheelPicker from "@quidone/react-native-wheel-picker"
import React, { useEffect, useRef, useState } from "react"
import {
  Animated,
  KeyboardAvoidingView, Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native"
import { AnimatedCircularProgress } from "react-native-circular-progress"
import { ready_styles, rest_styles, review_styles, shared_styles, TopBar, warmup_styles } from "../utils/BlockStyles"
import { saveVideoLocally } from "./saveVideo"

// ─── Types ────────────────────────────────────────────────────────────────────

interface BlockRendererProps {
  block: Block | null
  attemptsDone: number
  logAttempt: (attempt: Omit<Attempt, "blockIndex" | "type" | "timestamp">) => void
  undoLastAttempt?: () => void
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
}: BlockRendererProps) {
  if (!block) return null

  const blockAttempts = attempts.filter((a) => a.blockIndex === currentBlockIndex)
  const onPrevBlock = currentBlockIndex > 0 ? goToPreviousBlock : undefined

  switch (block.type) {
    case "project_bouldering":
      return (
        <ProjectBlock
          block={block}
          attemptsDone={attemptsDone}
          logAttempt={logAttempt}
          undoLastAttempt={undoLastAttempt}
          restTimeRemaining={restTimeRemaining}
          startRestTimer={startRestTimer}
          attempts={blockAttempts}
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
          goToNextBlock={goToNextBlock}
          goToPreviousBlock={onPrevBlock}
        />
      )

    default:
      return <Text>Unknown block type: {block.type}</Text>
  }
}

// ─── Constraint Warmup ────────────────────────────────────────────────────────

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

  function handleFinishRecording(videoUri: string) {
    setShowCamera(false)
    saveVideoLocally(videoUri, block.type)
    logAttempt({ success: true, video: videoUri })
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
          {!!block.level && (
            <View style={{ alignItems: "center", marginTop: 4, marginBottom: 8 }}>
              <Text style={{
                fontSize: 11, fontWeight: "700", color: C.textSecondary,
                textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4,
              }}>
                Boulder difficulty
              </Text>
              <Text style={{
                fontSize: 36, fontWeight: "800",
                color: C.green, textTransform: "capitalize",
              }}>
                {block.level}
              </Text>
            </View>
          )}
          {!!block.description && (
            <Text style={shared_styles.description}>{block.description}</Text>
          )}
          <CustomButton title="Start" onPress={() => setPhase("ready")} />
        </ScrollView>
      </View>
    )
  }

  if (phase === "ready") {
    return (
      <View style={shared_styles.screen}>
        <TopBar title={blockTitle} onBack={() => setPhase("intro")} />
        <View style={shared_styles.container}>
          <Text style={warmup_styles.level}>{block.level}</Text>
          <Animated.Text style={[warmup_styles.progress, { transform: [{ scale: counterScale }] }]}>
            {displayDone} / {targetAttempts}
          </Animated.Text>
          <View style={warmup_styles.buttonWrapper}>
            <Pressable style={rest_styles.yesButton} onPress={() => setShowCamera(true)}>
              <Text style={rest_styles.yesButtonText}>Record attempt</Text>
            </Pressable>
            <View style={{ height: 10 }} />
            <Animated.View style={{ transform: [{ scale: logBtnScale }], width: "100%" }}>
              <Pressable
                style={rest_styles.noButton}
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
                <Text style={rest_styles.noButtonText}>Log without video</Text>
                <Animated.Text
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    right: 20,
                    color: C.green,
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

const projectStyles = StyleSheet.create({
  selectedCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    width: "100%",
  },
  selectedName: { fontSize: 16, fontWeight: "700", color: C.textPrimary, marginBottom: 4 },
  selectedGrade: { fontSize: 14, color: C.green, fontWeight: "600" },
  changeBtn: { fontSize: 14, color: C.green, fontWeight: "600" },
  pickBtn: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 18,
    alignItems: "center",
  },
  pickBtnText: { fontSize: 16, fontWeight: "600", color: C.textPrimary },
})

// ─── Project Block ────────────────────────────────────────────────────────────

type ProjectPhase = "intro" | "projectSelect" | "ready" | "rest" | "restTimer" | "review"

interface ProjectBlockProps {
  block: Block
  attemptsDone: number
  logAttempt: BlockRendererProps["logAttempt"]
  undoLastAttempt?: () => void
  restTimeRemaining: number | null
  startRestTimer: (duration: number) => void
  attempts: Attempt[]
  goToNextBlock: () => void
  goToPreviousBlock?: () => void
}

function ProjectBlock({
  block,
  logAttempt,
  undoLastAttempt,
  restTimeRemaining,
  startRestTimer,
  attempts,
  goToNextBlock,
  goToPreviousBlock,
}: ProjectBlockProps) {
  const targetAttempts = block.targetAttempts ?? 1
  const attemptsDone = attempts.length
  // A project block is "done" when it hit its attempt target or the user sent
  // it — a send ends the block (no more attempts needed). Revisiting a done
  // block lands on review so logged attempts are preserved and can't be over-logged.
  const isComplete =
    attemptsDone >= targetAttempts ||
    attempts.some((a) => a.success)
  const [phase, setPhase] = useState<ProjectPhase>(() =>
    isComplete ? "review" : "intro"
  )
  const [selectedProject, setSelectedProject] = useState<ProjectRow | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const notesRef = useRef("")
  const [notes, setNotes] = useState("")
  const [showNotes, setShowNotes] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const [postRestPhase, setPostRestPhase] = useState<"ready" | "review">("ready")
  const [outcome, setOutcome] = useState<"sent" | "fell" | null>(null)

  const blockTitle = block.blockName || "Project bouldering"
  const projectGrade = selectedProject?.grade ?? ""

  function handleNotesChange(text: string) {
    setNotes(text)
    notesRef.current = text
  }

  function handleSaveAttempt(resolvedSuccess: boolean) {
    logAttempt({
      success: resolvedSuccess,
      notes: notesRef.current,
      level: projectGrade,
      projectId: selectedProject?.$id,
    })

    if (resolvedSuccess && selectedProject) {
      markProjectSent(selectedProject.$id).catch(console.error)
    }

    const nextCount = attemptsDone + 1
    const reachedLimit = nextCount >= targetAttempts
    // A successful send ends the block — no more attempts needed.
    const sent = resolvedSuccess

    // Keep outcome/notes in state so the back button shows the user's last answer
    setShowNotes(false)

    if (sent) {
      setPhase("review")
    } else if (reachedLimit) {
      setPhase("review")
    } else {
      setPostRestPhase("ready")
      setPhase("restTimer")
    }
  }

  function backFromTimer() {
    // Undo the just-logged attempt so re-saving doesn't double-count.
    undoLastAttempt?.()
    setPhase("rest")
  }

  function enterRest() {
    setOutcome(null)
    setNotes("")
    notesRef.current = ""
    startRestTimer(block.restTime ?? 120)
    setPhase("rest")
  }

  const handleSaveAttemptRef = useRef(handleSaveAttempt)
  useEffect(() => { handleSaveAttemptRef.current = handleSaveAttempt })

  // Auto-advance when the restTimer (post-save) expires.
  // The "rest" data-entry phase no longer auto-saves on timer end.
  useEffect(() => {
    if (phase === "restTimer" && restTimeRemaining === 0) {
      setPhase(postRestPhase)
    }
  }, [phase, restTimeRemaining, postRestPhase])

  // ── 1. Explanation ───────────────────────────────────────────────────────────

  if (phase === "intro") {
    return (
      <View style={shared_styles.screen}>
        <TopBar title={blockTitle} onBack={goToPreviousBlock} />
        <ScrollView

          contentContainerStyle={shared_styles.introContent}
          keyboardShouldPersistTaps="handled"
        >
          {!!block.description && (
            <Text style={shared_styles.description}>{block.description}</Text>
          )}
          <CustomButton title="Next" onPress={() => setPhase("projectSelect")} />
        </ScrollView>
      </View>
    )
  }

  // ── 2. Project selection ─────────────────────────────────────────────────────

  if (phase === "projectSelect") {
    return (
      <View style={shared_styles.screen}>
        <TopBar title={blockTitle} onBack={() => setPhase("intro")} />
        <ScrollView

          contentContainerStyle={shared_styles.introContent}
          keyboardShouldPersistTaps="handled"
        >
          {selectedProject ? (
            <View style={projectStyles.selectedCard}>
              <View style={{ flex: 1 }}>
                <Text style={projectStyles.selectedName}>{selectedProject.name}</Text>
                <Text style={projectStyles.selectedGrade}>{selectedProject.grade}</Text>
              </View>
              <Pressable onPress={() => setPickerOpen(true)} hitSlop={8}>
                <Text style={projectStyles.changeBtn}>Change</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={[shared_styles.description, { textAlign: "center" }]}>
              Choose the project you're working on.
            </Text>
          )}

          <View style={{ gap: 10, width: "100%" }}>
            {!selectedProject && (
              <Pressable style={projectStyles.pickBtn} onPress={() => setPickerOpen(true)}>
                <Text style={projectStyles.pickBtnText}>Choose / create project</Text>
              </Pressable>
            )}
            <CustomButton
              title="Start"
              onPress={() => setPhase("ready")}
              disabled={!selectedProject}
            />
          </View>
        </ScrollView>

        <ProjectPickerModal
          visible={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={(p) => { setSelectedProject(p); setPickerOpen(false) }}
        />
      </View>
    )
  }

  // ── 3. Ready ─────────────────────────────────────────────────────────────────

  if (phase === "ready") {
    return (
      <View style={shared_styles.screen}>
        <TopBar
          title={selectedProject?.name ?? projectGrade}
          onBack={() => setPhase("projectSelect")}
        />
        <View style={shared_styles.container}>
          <Text style={ready_styles.progressValue}>{attemptsDone}</Text>
          <Text style={ready_styles.progressLabel}>attempts</Text>
          <View style={{ width: "100%", gap: 10, marginTop: 24 }}>
            <Pressable style={rest_styles.yesButton} onPress={() => setShowCamera(true)}>
              <Text style={rest_styles.yesButtonText}>Record attempt</Text>
            </Pressable>
            <Pressable
              style={rest_styles.noButton}
              onPress={enterRest}
            >
              <Text style={rest_styles.noButtonText}>Log without video</Text>
            </Pressable>
          </View>
        </View>
        {showCamera && (
          <View style={warmup_styles.cameraOverlay}>
            <VideoRecorder
              onFinish={(videoUri: string) => {
                setShowCamera(false)
                saveVideoLocally(videoUri, block.type)
                enterRest()
              }}
              onClose={() => setShowCamera(false)}
            />
          </View>
        )}
      </View>
    )
  }

  // ── 4. Rest data entry: outcome + (notes if fell) ───────────────────────────

  if (phase === "rest") {
    const timerDisplay = restTimeRemaining != null && restTimeRemaining > 0
      ? `${Math.floor(restTimeRemaining / 60)}:${String(restTimeRemaining % 60).padStart(2, "0")}`
      : "go!"

    return (
      <View style={[shared_styles.screen, { backgroundColor: C.bg }]}>
        <View style={pbStyles.header}>
          <Text style={pbStyles.question}>How did it go?</Text>
          <View style={pbStyles.pillTimer}>
            <Text style={pbStyles.pillTimerText}>{timerDisplay}</Text>
          </View>
        </View>
        <ScrollView contentContainerStyle={pbStyles.content} keyboardShouldPersistTaps="handled">
          <View style={pbStyles.outcomeRow}>
            {(["sent", "fell"] as const).map((o) => (
              <Pressable
                key={o}
                style={[
                  pbStyles.outcomeChip,
                  outcome === o && (o === "sent" ? pbStyles.outcomeChipSent : pbStyles.outcomeChipFell),
                ]}
                onPress={() => setOutcome(o)}
              >
                <Text style={[pbStyles.outcomeChipText, outcome === o && pbStyles.outcomeChipTextSelected]}>
                  {o === "sent" ? "Sent" : "Fell"}
                </Text>
              </Pressable>
            ))}
          </View>

          {outcome === "fell" && (
            <>
              <Text style={[pbStyles.sectionLabel, { marginTop: 8 }]}>What went wrong?</Text>
              <TextInput
                placeholder="Notes (optional)"
                value={notes}
                onChangeText={handleNotesChange}
                style={pbStyles.notesInput}
                multiline
                placeholderTextColor={C.textMuted}
              />
            </>
          )}
        </ScrollView>

        <View style={pbStyles.footer}>
          <View />
          <Pressable
            style={[pbStyles.pillBtn, !outcome && { borderColor: C.border }]}
            onPress={() => outcome && handleSaveAttempt(outcome === "sent")}
          >
            <Text style={[pbStyles.pillBtnText, !outcome && { color: C.textMuted }]}>Save</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  // ── 5. Rest timer (sequence-style big circle) ───────────────────────────────

  if (phase === "restTimer") {
    const fillPercent = restTimeRemaining != null && block.restTime
      ? (restTimeRemaining / block.restTime) * 100
      : 0
    const restUrgent = (restTimeRemaining ?? 99) <= 15

    return (
      <View style={pbStyles.rest2Container}>
        <View style={pbStyles.rest2Header}>
          <Text style={pbStyles.rest2Label}>{blockTitle}</Text>
          <Text style={pbStyles.rest2Sub}>Rest</Text>
        </View>
        <View style={pbStyles.rest2Circle}>
          <AnimatedCircularProgress
            size={300} width={10} fill={fillPercent}
            tintColor={restUrgent ? C.red : C.green}
            backgroundColor={C.surface}
            rotation={0}
          >
            {() => {
              const t = restTimeRemaining ?? 0
              const display = t > 0
                ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`
                : "go!"
              return <Text style={pbStyles.timerText}>{display}</Text>
            }}
          </AnimatedCircularProgress>
        </View>
        <View style={pbStyles.rest2Footer}>
          <Pressable style={pbStyles.skipBtn} onPress={backFromTimer}>
            <Text style={pbStyles.skipBtnText}>Back</Text>
          </Pressable>
          <Pressable style={pbStyles.skipBtn} onPress={() => setPhase(postRestPhase)}>
            <Text style={pbStyles.skipBtnText}>Skip rest</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  // ── 6. Review ────────────────────────────────────────────────────────────────

  if (phase === "review") {
    return (
      <View style={shared_styles.screen}>
        <TopBar title="Review" />
        <ScrollView

          contentContainerStyle={{ padding: 20, gap: 10 }}
          keyboardShouldPersistTaps="handled"
        >
          {attempts.map((a, i) => (
            <View key={i} style={review_styles.reviewRow}>
              <Text style={review_styles.reviewText}>
                Attempt {i + 1} — {a.success ? "✅" : "❌"}
              </Text>
              {a.notes ? <Text style={review_styles.reviewNotes}>{a.notes}</Text> : null}
            </View>
          ))}
          <CustomButton title="Continue" onPress={goToNextBlock} />
        </ScrollView>
      </View>
    )
  }

  return null
}

// ─── Project Bouldering — sequence-style rest styles ──────────────────────────

const pbStyles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 24, paddingTop: 20, paddingBottom: 8,
  },
  question: { fontSize: 26, fontWeight: "700", color: C.textPrimary, flex: 1 },
  pillTimer: {
    backgroundColor: C.surface, borderRadius: 30,
    paddingHorizontal: 20, paddingVertical: 8, minWidth: 80, alignItems: "center",
  },
  pillTimerText: { fontSize: 16, fontWeight: "700", color: C.textPrimary, fontVariant: ["tabular-nums"] },

  content: { padding: 24, gap: 16, flexGrow: 1 },
  sectionLabel: {
    fontSize: 12, color: C.textMuted,
    textTransform: "uppercase", letterSpacing: 0.6, marginBottom: -4,
  },

  outcomeRow: { flexDirection: "row", gap: 12 },
  outcomeChip: {
    flex: 1, paddingVertical: 16, borderRadius: 14,
    borderWidth: 1, borderColor: C.border, alignItems: "center",
  },
  outcomeChipSent: { backgroundColor: C.green, borderColor: C.green },
  outcomeChipFell: { backgroundColor: C.red, borderColor: C.red },
  outcomeChipText: { fontSize: 16, fontWeight: "700", color: C.textSecondary },
  outcomeChipTextSelected: { color: C.bg },

  rpeRow: { flexDirection: "row", gap: 8 },
  rpeChip: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    borderWidth: 1, borderColor: C.border, alignItems: "center",
  },
  rpeChipSelected: { backgroundColor: C.green, borderColor: C.green },
  rpeChipText: { fontSize: 15, fontWeight: "600", color: C.textSecondary },
  rpeChipTextSelected: { color: C.bg },

  notesInput: {
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
    padding: 12, fontSize: 15, color: C.textPrimary,
    backgroundColor: C.surfaceHigh,
    minHeight: 80, textAlignVertical: "top",
  },

  footer: {
    backgroundColor: C.bg, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 36,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  pillBtn: {
    borderRadius: 20, borderWidth: 1.5, borderColor: C.green,
    paddingHorizontal: 28, paddingVertical: 10,
  },
  pillBtnText: { fontSize: 15, fontWeight: "700", color: C.green },

  rest2Container: {
    flex: 1, backgroundColor: C.bg,
    paddingTop: 16, paddingBottom: 48, paddingHorizontal: 24,
  },
  rest2Header: { alignItems: "center", gap: 4 },
  rest2Label: { fontSize: 22, fontWeight: "700", color: C.textPrimary },
  rest2Sub: { fontSize: 14, color: C.textMuted },
  rest2Circle: { flex: 1, alignItems: "center", justifyContent: "center" },
  timerText: { fontSize: 72, fontWeight: "700", color: C.textPrimary, textAlign: "center" },
  rest2Footer: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center", width: "100%",
  },
  skipBtn: {
    borderRadius: 20, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 28, paddingVertical: 10,
  },
  skipBtnText: { fontSize: 15, fontWeight: "600", color: C.textSecondary },
})