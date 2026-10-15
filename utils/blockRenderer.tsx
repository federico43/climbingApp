import { C } from "@/utils/theme"
import CustomButton from "@/components/customButton"
import { ExplorationSessionBlock } from "@/components/ExplorationSessionBlock"
import { FourByFourBlock } from "@/components/FourByFourBlock"
import { IntervalsBlock } from "@/components/IntervalsBlock"
import { FreeSessionBlock } from "@/components/FreeSessionBlock"
import { CoachedBlock } from "@/components/CoachedBlock"
import { BoulderLevelOptions, ProjectPickerModal } from "@/components/ProjectPickerModal"
import { SequenceBlock } from "@/components/SequenceBlock"
import { StrengthConditioningBlock } from "@/components/StrengthConditioningBlock"
import VideoRecorder from "@/components/VideoRecorder"
import type { Attempt, Block } from "@/hooks/WorkoutHook"
import { useBlockTimer } from "@/utils/blockTimer"
import { getLastProjectSession, getProjectById, listProjects, markProjectSent, ProjectRow, ProjectSessionSummary } from "@/services/BoulderGraphService"
import { summarizeProjectNotes } from "@/services/aiProtocol"
import { Image as CachedImage } from "expo-image"
import { Ionicons } from "@expo/vector-icons"
import WheelPicker from "@quidone/react-native-wheel-picker"
import React, { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
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

const projectStyles = StyleSheet.create({
  // Inline project list (selection screen)
  selectScroll: { padding: 20, paddingBottom: 12, gap: 10 },
  selectHeading: { fontSize: 22, fontWeight: "800", color: C.textPrimary, marginBottom: 6 },
  projRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: C.surface, borderRadius: 14, padding: 12,
    borderWidth: 1.5, borderColor: "transparent",
  },
  projRowSel: { borderColor: C.green },
  projThumb: { width: 48, height: 48, borderRadius: 10, backgroundColor: C.surfaceHigh },
  projThumbEmpty: { borderWidth: 1, borderColor: C.border },
  projName: { fontSize: 16, fontWeight: "700", color: C.textPrimary },
  projMeta: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  projCheck: { fontSize: 18, fontWeight: "800", color: C.green },
  createRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 14, borderRadius: 14, marginTop: 4,
    borderWidth: 1, borderColor: C.border, borderStyle: "dashed",
  },
  createText: { fontSize: 15, fontWeight: "700", color: C.green },
  selectFooter: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 32 },
})

// ─── Last Session Recap ───────────────────────────────────────────────────────

function relativeDay(iso: string): string {
  const then = new Date(iso)
  const days = Math.floor((Date.now() - then.getTime()) / 86400000)
  if (days <= 0) return "Today"
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days} days ago`
  if (days < 14) return "Last week"
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function formatDuration(sec: number): string {
  if (sec <= 0) return "—"
  const m = Math.round(sec / 60)
  if (m < 1) return `${sec}s`
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60), rem = m % 60
  return rem ? `${h}h ${rem}m` : `${h}h`
}

function LastSessionRecap({ project, onBack, onStart }: {
  project: ProjectRow
  onBack: () => void
  onStart: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<ProjectSessionSummary | null>(null)
  const [aiSummary, setAiSummary] = useState("")
  const [aiLoading, setAiLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    getLastProjectSession(project.$id)
      .then((s) => {
        if (cancelled) return
        // No history → skip straight to the session, don't show an empty recap.
        if (!s) { onStart(); return }
        setSummary(s)
        setLoading(false)
        if (s.notes.length) {
          setAiLoading(true)
          summarizeProjectNotes(s.notes, project.name)
            .then((text) => { if (!cancelled) setAiSummary(text) })
            .finally(() => { if (!cancelled) setAiLoading(false) })
        }
      })
      .catch(() => { if (!cancelled) onStart() }) // on error, just proceed
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.$id])

  if (loading || !summary) {
    return (
      <View style={shared_styles.screen}>
        <TopBar title={project.name} onBack={onBack} />
        <View style={recapStyles.centerFill}>
          <ActivityIndicator color={C.green} />
        </View>
      </View>
    )
  }

  return (
    <View style={shared_styles.screen}>
      <TopBar title={project.name} onBack={onBack} />
      <ScrollView contentContainerStyle={recapStyles.container}>
        <Text style={recapStyles.heading}>Last session</Text>
        <Text style={recapStyles.when}>{relativeDay(summary.date)}</Text>

        <View style={recapStyles.statsRow}>
          <View style={recapStyles.stat}>
            <Text style={recapStyles.statNum}>{formatDuration(summary.durationSec)}</Text>
            <Text style={recapStyles.statLabel}>duration</Text>
          </View>
          <View style={recapStyles.divider} />
          <View style={recapStyles.stat}>
            <Text style={recapStyles.statNum}>{summary.totalSessions}</Text>
            <Text style={recapStyles.statLabel}>total session{summary.totalSessions !== 1 ? "s" : ""}</Text>
          </View>
        </View>

        <View style={recapStyles.aiCard}>
          <Text style={recapStyles.aiLabel}>✨ Coach recap</Text>
          {aiLoading ? (
            <ActivityIndicator color={C.green} style={{ alignSelf: "flex-start", marginTop: 8 }} />
          ) : aiSummary ? (
            <Text style={recapStyles.aiText}>{aiSummary}</Text>
          ) : (
            <Text style={recapStyles.aiMuted}>No notes to summarize yet.</Text>
          )}
        </View>
      </ScrollView>
      <View style={recapStyles.footer}>
        <CustomButton title="Start session" onPress={onStart} />
      </View>
    </View>
  )
}

const recapStyles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  container: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16, alignItems: "center" },
  heading: { fontSize: 13, fontWeight: "700", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.8, marginTop: 8 },
  when: { fontSize: 28, fontWeight: "800", color: C.textPrimary, marginTop: 6, marginBottom: 20 },
  statsRow: {
    flexDirection: "row", alignItems: "center", width: "100%",
    backgroundColor: C.surface, borderRadius: 16, paddingVertical: 18,
    borderWidth: 1, borderColor: C.border,
  },
  stat: { flex: 1, alignItems: "center", gap: 4 },
  statNum: { fontSize: 26, fontWeight: "800", color: C.textPrimary, fontVariant: ["tabular-nums"] },
  statLabel: { fontSize: 12, color: C.textSecondary },
  divider: { width: 1, alignSelf: "stretch", backgroundColor: C.border, marginVertical: 4 },
  aiCard: { width: "100%", backgroundColor: C.surface, borderRadius: 14, padding: 16, marginTop: 16, gap: 8 },
  aiLabel: { fontSize: 12, fontWeight: "700", color: C.green, textTransform: "uppercase", letterSpacing: 0.5 },
  aiText: { fontSize: 14, color: C.textPrimary, lineHeight: 21 },
  aiMuted: { fontSize: 14, color: C.textMuted, fontStyle: "italic" },
  footer: { paddingHorizontal: 20, paddingBottom: 32, paddingTop: 8 },
})

// ─── Project Block ────────────────────────────────────────────────────────────

type ProjectPhase = "intro" | "projectSelect" | "lastSession" | "ready" | "rest" | "restTimer" | "review"

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
  // If we reopen with attempts already logged (e.g. resuming an interrupted
  // workout), the project was already chosen — skip past intro/projectSelect to
  // the active phase (or review if done), and restore the project below.
  const [phase, setPhase] = useState<ProjectPhase>(() =>
    isComplete ? "review" : attemptsDone > 0 ? "ready" : "intro"
  )
  const blockTimer = useBlockTimer()
  const [selectedProject, setSelectedProject] = useState<ProjectRow | null>(null)

  // Restore the worked-on project from the attempts' projectId when resuming.
  useEffect(() => {
    if (selectedProject || attemptsDone === 0) return
    const pid = [...attempts].reverse().find((a) => a.projectId)?.projectId
    if (!pid) return
    let cancelled = false
    getProjectById(pid)
      .then((p) => {
        if (cancelled) return
        if (p) setSelectedProject(p)
        else setPhase("projectSelect") // project gone — let them re-pick
      })
      .catch(() => { if (!cancelled) setPhase("projectSelect") })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerMode, setPickerMode] = useState<"menu" | "choose" | "create">("menu")
  const openPicker = (m: "menu" | "choose" | "create") => { setPickerMode(m); setPickerOpen(true) }
  // Inline project list for the selection screen.
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loadingProjects, setLoadingProjects] = useState(true)
  const loadProjects = useCallback(() => {
    setLoadingProjects(true)
    listProjects()
      .then((data) => setProjects(data.filter((p) => p.status === "active")))
      .catch(() => {})
      .finally(() => setLoadingProjects(false))
  }, [])
  useEffect(() => { loadProjects() }, [loadProjects])
  const notesRef = useRef("")
  // Saved clip of the attempt in progress, attached when it's logged.
  const pendingVideoRef = useRef<string | undefined>(undefined)
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
      video: pendingVideoRef.current,
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
    pendingVideoRef.current = undefined
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
          contentContainerStyle={projectStyles.selectScroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={projectStyles.selectHeading}>Choose your project</Text>

          {loadingProjects ? (
            <ActivityIndicator color={C.green} style={{ marginTop: 30 }} />
          ) : projects.length === 0 ? (
            <Text style={[shared_styles.description, { textAlign: "center" }]}>
              No active projects yet — create one below.
            </Text>
          ) : (
            projects.map((p) => {
              const daysLeft = Math.ceil((new Date(p.dueDate).getTime() - Date.now()) / 86400000)
              const selected = selectedProject?.$id === p.$id
              return (
                <Pressable
                  key={p.$id}
                  style={[projectStyles.projRow, selected && projectStyles.projRowSel]}
                  onPress={() => setSelectedProject(p)}
                >
                  {p.imageUri ? (
                    <CachedImage source={{ uri: p.imageUri }} style={projectStyles.projThumb} contentFit="cover" cachePolicy="memory-disk" transition={150} />
                  ) : (
                    <View style={[projectStyles.projThumb, projectStyles.projThumbEmpty]} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={projectStyles.projName}>{p.name}</Text>
                    <Text style={projectStyles.projMeta}>
                      {p.grade} · {daysLeft > 0 ? `${daysLeft}d left` : "Due today"}
                    </Text>
                  </View>
                  {selected && <Text style={projectStyles.projCheck}>✓</Text>}
                </Pressable>
              )
            })
          )}

          <Pressable style={projectStyles.createRow} onPress={() => openPicker("create")}>
            <Ionicons name="add" size={20} color={C.green} />
            <Text style={projectStyles.createText}>Create new project</Text>
          </Pressable>
        </ScrollView>

        <View style={projectStyles.selectFooter}>
          <CustomButton
            title="Start"
            onPress={() => { blockTimer.start(); setPhase("lastSession") }}
            disabled={!selectedProject}
          />
        </View>

        <ProjectPickerModal
          visible={pickerOpen}
          initialMode={pickerMode}
          onClose={() => setPickerOpen(false)}
          onSelect={(p) => { setSelectedProject(p); setPickerOpen(false); loadProjects() }}
        />
      </View>
    )
  }

  // ── 2b. Last session recap ───────────────────────────────────────────────────

  if (phase === "lastSession" && selectedProject) {
    return (
      <LastSessionRecap
        project={selectedProject}
        onBack={() => setPhase("projectSelect")}
        onStart={() => setPhase("ready")}
      />
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
                enterRest()
                // Set after enterRest (which clears it) so this attempt's
                // save picks it up.
                saveVideoLocally(videoUri, block.type, {
                  projectId: selectedProject?.$id,
                  projectName: selectedProject?.name,
                  grade: selectedProject?.grade,
                }).then((saved) => { pendingVideoRef.current = saved ?? undefined })
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