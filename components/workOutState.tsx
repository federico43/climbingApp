import {
  Body, Card, CardTitle, GhostButton, hexAlpha, IconButton, Melt, Mono, PosterHeadline, PrimaryCTA,
  ProgressBar, SectionHeader, SpecsRow, usePaper, usePaperStyles,
} from "@/components/paper"
import { useC } from "@/theme/paper/legacy"
import { font, PaperTheme, radius, space } from "@/theme/paper/tokens"
import { useBlockTimerAlert } from "@/hooks/useBlockTimerAlert"
import { useWorkout } from "@/hooks/WorkoutHook"
import { useSessionSyncState } from "@/services/sessionSyncQueue"
import { BlockRenderer } from "@/utils/blockRenderer"
import { BlockTimerContext } from "@/utils/blockTimer"
import { LastBlockContext } from "@/utils/blockNav"
import { Ionicons } from "@expo/vector-icons"
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { useEffect, useMemo, useRef, useState } from "react"
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context"
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated"
import { router } from "expo-router"
import { ProjectSummaryCard } from "./ProjectBoulderingBlock"
import { mainSwapFor } from "@/utils/mainSwap"
import { isSprayBlock } from "@/utils/sprayBlocks"
import { useAuth } from "@/components/auth-context"
import { dropDone, shouldAutoOpen, toggleTask } from "@/utils/nextTasks"
import { localDateStr } from "@/utils/planRotation"
import { ForTodayChip, ForTodaySheet, NextTimeCard, NextTimeEditor, useNextTasks } from "./NextTasks"

// ─── Block slide-in wrapper ───────────────────────────────────────────────────

function BlockEntry({ children }: { children: React.ReactNode }) {
  const opacity = useSharedValue(0)
  const translateX = useSharedValue(28)

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 240 })
    translateX.value = withSpring(0, { damping: 20, stiffness: 260 })
  }, [opacity, translateX])

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
  onSwapMain,
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
  // ⇄ the current main block to the other one of its type (plan workouts,
  // utils/mainSwap.ts). Omitted → no switch.
  onSwapMain?: (index: number) => Promise<void>
}) {
  const C = useC()
  const t = usePaper()
  const styles = usePaperStyles(makeStyles)
  const {
    currentBlock,
    attemptsDone,
    status,
    timeRemaining,
    restTimeRemaining,
    logAttempt,
    undoLastAttempt,
    removeAttempt,
    updateLastAttempt,
    startWorkout,
    startRestTimer,
    currentBlockIndex,
    totalBlocks,
    isLastBlock,
    resetWorkout,
    goToNextBlock,
    goToPreviousBlock,
    skipBlock,
    leaveAsHomework,
    attempts,
    blockDurations,
    blockStartTime,
    workoutStartTime,
    skippedBlocks,
    homeworkBlocks,
  } = workout

  // ⋯ menu on the block: leave it as homework (what's logged is kept, the
  // rest goes to the Plan page's homework — utils/homework.ts) or skip it.
  const [blockMenu, setBlockMenu] = useState(false)

  const [swapping, setSwapping] = useState(false)
  const nothingLogged = !attempts.some((a) => a.blockIndex === currentBlockIndex)
  const mainSwap = onSwapMain && nothingLogged ? mainSwapFor(protocol, currentBlockIndex) : null

  function handleSwapMain() {
    if (!mainSwap || !onSwapMain) return
    Alert.alert(
      `Switch to ${mainSwap.to.name}?`,
      `You'll do ${mainSwap.to.name} instead of ${mainSwap.from.name} today. Your plan stays the same.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Switch",
          onPress: () => {
            setSwapping(true)
            onSwapMain(currentBlockIndex)
              .catch((e: any) => Alert.alert("Couldn't switch", e?.message ?? "Check your connection and try again."))
              .finally(() => setSwapping(false))
          },
        },
      ]
    )
  }

  const insets = useSafeAreaInsets()
  const didAutoStart = useRef(false)

  // "For next time" tasks (utils/nextTasks.ts): written on the summary,
  // shown as a checklist when the next workout starts (and from the chip
  // mid-workout). Ticked ones go when the workout ends.
  const userId = useAuth().User?.$id ?? null
  const { list: tasks, update: updateTasks } = useNextTasks(userId, workoutStartTime)
  const [forTodayOpen, setForTodayOpen] = useState(false)
  const autoOpenedFor = useRef<number | null>(null)
  useEffect(() => {
    if (status !== "running" || workoutStartTime == null || autoOpenedFor.current === workoutStartTime) return
    if (!shouldAutoOpen(tasks, workoutStartTime, Date.now())) return
    autoOpenedFor.current = workoutStartTime
    setForTodayOpen(true)
  }, [status, workoutStartTime, tasks])
  const [editorOpen, setEditorOpen] = useState(false)
  // Once the athlete opens the editor the summary stays until they leave.
  const [holdSummary, setHoldSummary] = useState(false)
  useEffect(() => {
    if (status === "completed") {
      setForTodayOpen(false)
      updateTasks((l) => dropDone(l, Date.now()))
    } else {
      setEditorOpen(false)
      setHoldSummary(false)
    }
  }, [status, updateTasks])
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

  // The session is saved the moment it completes (see WorkoutContext — kept on
  // the phone until it reaches the server), so the summary just closes itself after AUTO_CLOSE_SECS — doing what "Save
  // workout" used to — unless the athlete leaves first.
  const [autoCloseIn, setAutoCloseIn] = useState(AUTO_CLOSE_SECS)
  const sync = useSessionSyncState()
  const closeSummaryRef = useRef(() => {})
  closeSummaryRef.current = () => { onWorkoutEnd(); resetWorkout() }
  useEffect(() => {
    if (status !== "completed" || holdSummary) return
    setAutoCloseIn(AUTO_CLOSE_SECS)
    const end = Date.now() + AUTO_CLOSE_SECS * 1000
    const id = setInterval(() => {
      const r = Math.max(0, Math.ceil((end - Date.now()) / 1000))
      setAutoCloseIn(r)
      if (r <= 0) {
        clearInterval(id)
        closeSummaryRef.current()
      }
    }, 250)
    return () => clearInterval(id)
  }, [status, holdSummary])

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- auto-start is decided once, on mount
  }, [])

  const blockMenuNode = (
    <Modal visible={blockMenu} transparent animationType="fade" onRequestClose={() => setBlockMenu(false)}>
      <Pressable style={styles.menuBackdrop} onPress={() => setBlockMenu(false)}>
        <Pressable style={[styles.menuSheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
          <Mono style={styles.menuTitle}>{currentBlock?.blockName || "This block"}</Mono>
          <Pressable
            style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}
            onPress={() => { setBlockMenu(false); leaveAsHomework() }}
          >
            <View style={[styles.menuIcon, { borderColor: hexAlpha(t.pink, 0.45) }]}>
              <Ionicons name="school-outline" size={18} color={t.pink} />
            </View>
            <View style={{ flex: 1 }}>
              <Body weight={800} size={16}>Leave as homework</Body>
              <Body muted size={13} style={{ marginTop: 2 }}>Finish it another day</Body>
            </View>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}
            onPress={() => { setBlockMenu(false); skipBlock() }}
          >
            <View style={[styles.menuIcon, { borderColor: t.ghostBorder }]}>
              <Ionicons name="play-skip-forward" size={18} color={C.red} />
            </View>
            <View style={{ flex: 1 }}>
              <Body weight={800} size={16} style={{ color: C.red }}>Skip block</Body>
              <Body muted size={13} style={{ marginTop: 2 }}>{"It won't be saved"}</Body>
            </View>
          </Pressable>
          <GhostButton label="Cancel" onPress={() => setBlockMenu(false)} style={{ marginTop: 6 }} />
        </Pressable>
      </Pressable>
    </Modal>
  )

  if (status === "idle") {
    return (
      <SafeAreaView style={[styles.container, styles.centeredScreen, { paddingTop: insets.top }]} edges={["bottom"]}>
        {onClose && (
          <IconButton
            icon="close"
            label="Close"
            size={36}
            onPress={() => { onWorkoutEnd(); resetWorkout() }}
            style={{ alignSelf: "flex-end" }}
          />
        )}
        <Mono style={{ alignSelf: "flex-start", marginTop: 16 }}>Training protocol</Mono>
        {currentBlock ? (
          <Card style={{ width: "100%", marginTop: 12, gap: 6 }}>
            <CardTitle size={30}>{protocolName}</CardTitle>
            <Mono>{totalBlocks} block{totalBlocks !== 1 ? "s" : ""}</Mono>
            <PrimaryCTA label="Start workout" onPress={handleStartWorkout} style={{ marginTop: 14 }} />
          </Card>
        ) : (
          <Body muted style={{ marginTop: 40 }}>No protocol available.</Body>
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
    const doneCount = completedBlocks.filter(({ originalIndex }) => !homeworkBlocks.has(originalIndex)).length

    return (
      <SafeAreaView style={[styles.container, { paddingTop: insets.top }]} edges={["bottom"]}>
        <View style={styles.topRow}>
          <Mono color={t.mintText}>Summary · saved</Mono>
          <IconButton icon="close" label="Close summary" size={36} onPress={() => closeSummaryRef.current()} />
        </View>

        <ScrollView contentContainerStyle={styles.summaryScroll} showsVerticalScrollIndicator={false}>
          {/* Melt kept short and soft, behind the headline only, so the
              mint "Back to home" button sits on plain paper and stands out. */}
          <View pointerEvents="none" style={styles.summaryMelt}>
            <Melt top={0} height={190} />
          </View>
          <Mono>Workout complete</Mono>
          <PosterHeadline style={{ marginTop: 6 }}>Done</PosterHeadline>
          <SpecsRow left={[`*${protocolName}*`]} right={[`${doneCount} of ${totalBlocks} blocks`]} />

          <Card style={styles.summaryStats}>
            <View style={styles.summaryStat}>
              <Text style={styles.summaryStatNum}>{timeStr}</Text>
              <Mono>Total time</Mono>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryStat}>
              <Text style={styles.summaryStatNum}>{doneCount}</Text>
              <Mono>Block{doneCount !== 1 ? "s" : ""} done</Mono>
            </View>
          </Card>

          {completedBlocks.length > 0 && <SectionHeader>Blocks</SectionHeader>}
          {completedBlocks.length > 0 && <Card padded={false}>
            {completedBlocks.map(({ block, originalIndex }, i) => {
              const dur = blockDurations[originalIndex] ?? 0
              const dm = Math.floor(dur / 60)
              const ds = dur % 60
              const durStr = dm > 0
                ? (ds === 0 ? `${dm}m` : `${dm}m ${ds}s`)
                : `${ds}s`
              // Project bouldering: grade · attempts · sent + fall reasons under the row.
              const projectAttempts = block.type === "project_bouldering" && !block.coached
                ? attempts.filter((a) => a.blockIndex === originalIndex)
                : null
              const homework = homeworkBlocks.has(originalIndex)
              return (
                <View key={originalIndex} style={i > 0 && styles.summaryRowDivider}>
                  <View style={styles.summaryBlockRow}>
                    <Mono style={styles.summaryBlockIndex}>{String(i + 1).padStart(2, "0")}</Mono>
                    <Body weight={700} size={16} style={{ flex: 1 }} numberOfLines={1}>
                      {block.blockName || "Block"}
                    </Body>
                    {homework ? (
                      <View style={styles.summaryHomework}>
                        <Ionicons name="school" size={12} color={t.pink} />
                        <Mono color={t.pink}>Homework</Mono>
                      </View>
                    ) : (
                      <>
                        <Mono color={t.ink}>{durStr}</Mono>
                        <View style={styles.summaryCheck}>
                          <Ionicons name="checkmark" size={14} color={t.onMint} />
                        </View>
                      </>
                    )}
                  </View>
                  {!!projectAttempts?.length && (
                    <View style={styles.summaryProject}>
                      <ProjectSummaryCard attempts={projectAttempts} compact />
                    </View>
                  )}
                </View>
              )
            })}
          </Card>}

          {homeworkBlocks.size > 0 && (
            <Body muted size={13} style={styles.summaryHomeworkNote}>
              {"What's left is on your Plan page as homework — pick a day to finish it in the next 5 days."}
            </Body>
          )}

          <NextTimeCard list={tasks} onOpen={() => { setHoldSummary(true); setEditorOpen(true) }} />

          <PrimaryCTA
            label="Back to home"
            icon="home"
            style={{ marginTop: 24 }}
            onPress={() => {
              closeSummaryRef.current()
              router.navigate("/")
            }}
          />
          <Mono style={styles.summaryAutoClose}>
            {sync.pending > 0 && sync.offline
              ? "No connection — saved on this phone, it uploads once you're back online"
              : "Workout saved"}{holdSummary ? "" : ` · closing in ${autoCloseIn}s`}
          </Mono>
        </ScrollView>
        {editorOpen && (
          <NextTimeEditor list={tasks} update={updateTasks} onClose={() => setEditorOpen(false)} insets={insets} />
        )}
      </SafeAreaView>
    )
  }

  const coached = !!currentBlock?.coached
  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <View style={[styles.progressBar, { paddingTop: insets.top + 8 }]}>
        <View style={styles.progressHeader}>
          <Mono color={t.ink}>
            Block {String(currentBlockIndex + 1).padStart(2, "0")}
            <Text style={{ color: t.label }}> / {String(totalBlocks).padStart(2, "0")}</Text>
          </Mono>
          <View style={styles.progressActions}>
            {(currentBlock?.timeLimit ?? 0) > 0 && !SELF_TIMED_BLOCKS.has(currentBlock?.type ?? "") && !isSprayBlock(currentBlock) && timerStartedAt !== null && (
              <BlockCountdown key={currentBlockIndex} minutes={currentBlock.timeLimit ?? 0} label={currentBlock.blockName || "Block"} />
            )}
            <IconButton icon="ellipsis-horizontal" label="Block options" size={34} onPress={() => setBlockMenu(true)} />
            {onMinimize && <IconButton icon="chevron-down" label="Minimize workout" size={34} onPress={onMinimize} />}
            <IconButton
              icon="close"
              label="Exit workout"
              size={34}
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
            />
          </View>
        </View>
        <ProgressBar progress={(currentBlockIndex + 1) / Math.max(1, totalBlocks)} />
      </View>
      {/* Coach is here / On my own and ⇄ main block — only before anything's logged on the block. */}
      <View style={styles.blockSwitches}>
        {onSetCoached && currentBlock && nothingLogged && !isSprayBlock(currentBlock) && (
          <Pressable
            style={[styles.coachSwitch, coached && styles.coachSwitchOn]}
            onPress={() => onSetCoached(currentBlockIndex, !coached)}
            hitSlop={6}
            accessibilityRole="switch"
            accessibilityState={{ checked: coached }}
          >
            <Ionicons name={coached ? "person" : "person-outline"} size={13} color={coached ? t.onMint : t.ink} />
            <Text style={[styles.coachSwitchText, coached && { color: t.onMint }]}>
              {coached ? "Coach is here · switch to on my own" : "Coach is here?"}
            </Text>
          </Pressable>
        )}
        <ForTodayChip list={tasks} onPress={() => setForTodayOpen(true)} />
        {mainSwap && (
          <Pressable style={styles.coachSwitch} onPress={handleSwapMain} disabled={swapping} hitSlop={6}>
            <Ionicons name="swap-horizontal" size={13} color={t.ink} />
            <Text style={styles.coachSwitchText}>
              {swapping ? "Switching…" : `Switch to ${mainSwap.to.name}`}
            </Text>
          </Pressable>
        )}
      </View>
      <BlockEntry key={`${currentBlockIndex}-${currentBlock?.blockName ?? ""}-${currentBlock?.coached ? "c" : "g"}`}>
        <BlockTimerContext.Provider value={blockTimer}>
          <LastBlockContext.Provider value={isLastBlock}>
            <BlockRenderer
              block={currentBlock}
              attemptsDone={attemptsDone}
              logAttempt={logAttempt}
              undoLastAttempt={undoLastAttempt}
              removeAttempt={removeAttempt}
              updateLastAttempt={updateLastAttempt}
              timeRemaining={timeRemaining}
              restTimeRemaining={restTimeRemaining}
              startRestTimer={startRestTimer}
              attempts={attempts}
              currentBlockIndex={currentBlockIndex}
              goToNextBlock={goToNextBlock}
              goToPreviousBlock={goToPreviousBlock}
              blockStartTime={blockStartTime}
            />
          </LastBlockContext.Provider>
        </BlockTimerContext.Provider>
      </BlockEntry>
      {blockMenuNode}
      {forTodayOpen && tasks.tasks.length > 0 && (
        <ForTodaySheet
          list={tasks}
          onToggle={(id) => updateTasks((l) => toggleTask(l, id, localDateStr(new Date()), Date.now()))}
          onClose={() => setForTodayOpen(false)}
          insets={insets}
        />
      )}
    </SafeAreaView>
  )
}

// How long the summary stays up before closing itself.
const AUTO_CLOSE_SECS = 10

// Blocks that render their own time display (countdown or work/rest) — the host
// chip would duplicate it, so skip them.
const SELF_TIMED_BLOCKS = new Set(["exploration_session", "route_exploration", "intervals", "free_session", "project_bouldering"])

// Per-block countdown for blocks that carry a time constraint. Remounts per
// block (keyed by index), turns red and reads "Time's up" at zero — it never
// auto-advances, so the athlete decides when to move on. Beeps at zero, and
// notifies when it runs out with the app in the background.
function BlockCountdown({ minutes, label }: { minutes: number; label: string }) {
  const C = useC()
  const t = usePaper()
  const styles = usePaperStyles(makeStyles)
  const total = Math.max(0, Math.round(minutes * 60))
  const [remaining, setRemaining] = useState(total)
  const [end] = useState(() => Date.now() + total * 1000)
  useBlockTimerAlert(total > 0 ? end : null, label)
  useEffect(() => {
    const id = setInterval(() => {
      const r = Math.max(0, Math.ceil((end - Date.now()) / 1000))
      setRemaining(r)
      if (r <= 0) clearInterval(id)
    }, 250)
    return () => clearInterval(id)
  }, [end])
  const over = remaining <= 0
  const m = Math.floor(remaining / 60)
  const s = remaining % 60
  return (
    <View style={[styles.countdownChip, over && { backgroundColor: C.red, borderColor: C.red }]}>
      <Ionicons name="time-outline" size={13} color={over ? t.onMint : t.mintText} />
      <Mono color={over ? t.onMint : t.mintText} size={11}>
        {over ? "Time's up" : `${m}:${String(s).padStart(2, "0")}`}
      </Mono>
    </View>
  )
}

const makeStyles = (t: PaperTheme) => StyleSheet.create({
  container: { flex: 1 },
  centeredScreen: { alignItems: "center", padding: space.gutter },
  pressed: { opacity: 0.7 },
  topRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: space.gutter, paddingTop: 8, paddingBottom: 4,
  },
  progressBar: { width: "100%", paddingHorizontal: space.gutter, marginBottom: 10, gap: 10 },
  progressHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  countdownChip: {
    flexDirection: "row", alignItems: "center", gap: 5, height: 34,
    borderRadius: 17, paddingHorizontal: 11, borderWidth: 1.5, borderColor: t.mintDeep,
  },
  blockSwitches: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginHorizontal: space.gutter },
  coachSwitch: {
    flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6,
    marginTop: 4, marginBottom: 2, height: 32,
    paddingHorizontal: 12, borderRadius: 16,
    borderWidth: 1.5, borderColor: t.ghostBorder,
  },
  coachSwitchOn: { backgroundColor: t.mint, borderColor: t.mode === "dark" ? t.mint : t.ink },
  coachSwitchText: { fontFamily: font.bold, fontSize: 12.5, color: t.ink },
  menuBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  menuSheet: {
    backgroundColor: t.paper, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card,
    borderWidth: 1, borderColor: t.cardBorder,
    paddingTop: 20, paddingHorizontal: space.gutter, gap: 8,
  },
  menuTitle: { textAlign: "center", marginBottom: 6 },
  menuItem: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder,
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 12,
  },
  menuIcon: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center",
  },

  // Summary screen
  summaryMelt: { position: "absolute", left: 0, right: 0, top: 10, height: 190, opacity: 0.55 },
  summaryScroll: { flexGrow: 1, paddingHorizontal: space.gutter, paddingTop: 20, paddingBottom: 40 },
  summaryStats: { flexDirection: "row", marginTop: 40, paddingVertical: 20 },
  summaryStat: { flex: 1, alignItems: "center", gap: 6 },
  summaryDivider: { width: 1, backgroundColor: t.hairline, marginVertical: 4 },
  summaryStatNum: { fontFamily: font.title, fontSize: 40, color: t.ink, letterSpacing: -0.4, fontVariant: ["tabular-nums"] },
  summaryRowDivider: { borderTopWidth: 1, borderTopColor: t.hairline },
  summaryBlockRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: space.cardPad, paddingVertical: 14, gap: 12,
  },
  summaryBlockIndex: { width: 20 },
  summaryCheck: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: t.mint,
    borderWidth: 1.5, borderColor: t.mode === "dark" ? t.mint : t.ink,
    alignItems: "center", justifyContent: "center",
  },
  summaryHomework: { flexDirection: "row", alignItems: "center", gap: 5 },
  summaryProject: { paddingLeft: 50, paddingRight: 12, paddingBottom: 12 },
  summaryHomeworkNote: { textAlign: "center", marginTop: 14 },
  summaryAutoClose: { textAlign: "center", marginTop: 4, lineHeight: 16 },
})
