import CustomButton from "@/components/customButton"
import { BlockNotes } from "@/components/BlockNotes"
import { ExplorationFocusSlides, useExplorationFocusFirstTime } from "@/components/ExplorationFocusSlides"
import { ConsumeAuth } from "@/components/auth-context"
import type { Attempt } from "@/hooks/WorkoutHook"
import { getSessions, getUsers } from "@/services/BoulderGraphService"
import { shared_stylesSheet, topBar_stylesSheet, TopBar } from "@/utils/BlockStyles"
import { useNextBlockLabel } from "@/utils/blockNav"
import { BoulderLevelOptions, colourLabel } from "@/utils/boulderColours"
import { FALL_REASONS } from "@/utils/progression/projectBouldering"
import {
  BREATH_IN_MS, BREATH_OUT_MS, breathAt, EXPLORATION_BREATHING_MIN, EXPLORATION_BREATHING_NOTES,
  EXPLORATION_MAX_TRIES, EXPLORATION_PART_MIN, EXPLORATION_PROJECT_NOTES, EXPLORATION_WARMUP_MIN, EXPLORATION_WARMUP_NOTES,
  explorationDescription, explorationNotes, explorationStartColour, formatPoints, lastExploration, nextExplorationColour,
  routePoints, summarizeExploration, wallLabel, WALLS, type ExplorationSummary,
} from "@/utils/routeExploration"
import { Palette, paperSheet, useC, useSheet } from "@/theme/paper/legacy"
import * as Haptics from "expo-haptics"
import { useBlockTimerAlert } from "@/hooks/useBlockTimerAlert"
import { usePopupTurn } from "@/utils/popupTurn"
import React, { useEffect, useRef, useState } from "react"
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"

// Route exploration (utils/routeExploration.ts), laid out like the Density
// test (ExplorationSessionBlock). Part 1 Flash: pick wall, colour and go,
// then "+ Log route"; "Tried all" moves up a colour (all sent) or on to
// part 2. Part 2 Project: a timer on the routes that didn't go, then "what
// did you realise you did wrong". Routes live in the logged attempts, so a
// resumed workout picks up where it was.
// Before part 1 (coach 2026-11-12): a timed warm-up on easy routes, then
// guided breathing, then a "ready" screen that starts part 1's timer. The
// first time, slides explain why (components/ExplorationFocusSlides.tsx).

// review = part 1's points vs last time, before part 2 (coach 2026-11-05).
type Phase = "intro" | "warmup" | "breathingIntro" | "breathing" | "flashIntro" | "flash" | "review" | "projectIntro" | "project" | "question" | "done"

const RESULTS = [
  { label: "Flash", tries: 1, sent: true },
  { label: "2nd go", tries: 2, sent: true },
  { label: "3rd go", tries: 3, sent: true },
  { label: "Not sent", tries: EXPLORATION_MAX_TRIES, sent: false },
]

interface Props {
  block: any
  attempts: Attempt[]
  logAttempt: (attempt: Omit<Attempt, "blockIndex" | "type" | "timestamp">) => void
  removeAttempt?: (timestamp: number) => void
  goToNextBlock: () => void
  goToPreviousBlock?: () => void
}

function swatch(value: string, C: Palette): string {
  return BoulderLevelOptions.find((o) => o.value === value)?.color ?? C.border
}

function resultLabel(r: { sent: boolean; tries: number }): string {
  return r.sent ? RESULTS[r.tries - 1]?.label ?? "Sent" : "Not sent"
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  return `${m}:${String(seconds % 60).padStart(2, "0")}`
}

// Countdown from `minutes` while `running`; calls onEnd once at zero. Beeps at
// zero, and notifies (as `label`) when it runs out with the app in the background.
function useCountdown(minutes: number, running: boolean, label: string, onEnd: () => void) {
  const [left, setLeft] = useState(minutes * 60)
  const [endsAt, setEndsAt] = useState<number | null>(null)
  useBlockTimerAlert(running ? endsAt : null, label)
  const onEndRef = useRef(onEnd)
  onEndRef.current = onEnd
  useEffect(() => {
    if (!running) return
    const end = Date.now() + minutes * 60 * 1000
    setEndsAt(end)
    setLeft(minutes * 60)
    const id = setInterval(() => {
      const s = Math.max(0, Math.ceil((end - Date.now()) / 1000))
      setLeft(s)
      if (s === 0) { clearInterval(id); onEndRef.current() }
    }, 250)
    return () => { clearInterval(id); setEndsAt(null) }
  }, [running, minutes])
  return left
}

export function RouteExplorationBlock({ block, attempts, logAttempt, removeAttempt, goToNextBlock, goToPreviousBlock }: Props) {
  const C = useC()
  const shared_styles = useSheet(shared_stylesSheet)
  const styles = useSheet(sheet)
  const topBar_styles = useSheet(topBar_stylesSheet)
  const nextLabel = useNextBlockLabel("Continue")
  const { User } = ConsumeAuth()
  const flashMin = block?.timeLimit || EXPLORATION_PART_MIN
  const projectMin = block?.projectTime || EXPLORATION_PART_MIN
  const warmupMin = block?.warmupTime || EXPLORATION_WARMUP_MIN
  const breathingMin = block?.breathingTime || EXPLORATION_BREATHING_MIN
  const title = block?.blockName || "Route exploration"

  const summary = summarizeExploration(attempts)
  const routes = summary.routes
  const notSent = routes.filter((r) => !r.sent)

  const [phase, setPhase] = useState<Phase>(summary.answered ? "done" : routes.length > 0 ? "flash" : "intro")
  const [startColour, setStartColour] = useState<string>(
    routes.length > 0 ? routes[0].colour : explorationStartColour(block?.startColour),
  )
  const [colour, setColour] = useState<string>(routes.length > 0 ? routes[routes.length - 1].colour : startColour)
  const [wall, setWall] = useState<string | null>(routes.length > 0 ? routes[routes.length - 1].wall : null)
  const [result, setResult] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [reasons, setReasons] = useState<string[]>([])
  const [notes, setNotes] = useState("")
  // The previous exploration, for the review (undefined = still loading).
  const [last, setLast] = useState<{ date: string; summary: ExplorationSummary } | null | undefined>(undefined)

  useEffect(() => {
    if ((phase !== "review" && phase !== "done") || last !== undefined) return
    const own = attempts.map((a) => a.timestamp)
    getSessions()
      .then((sessions) => setLast(lastExploration(sessions, own)))
      .catch(() => setLast(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // Before the first route: the athlete's current flash level (blue at
  // least). The colour saved on the block when the plan was built can be
  // stale (no flash level yet, or it changed since), so it's only a fallback.
  useEffect(() => {
    if (routes.length > 0 || !User?.$id) return
    getUsers(User.$id)
      .then((u: any) => {
        if (!u?.flashLevel) return
        const c = explorationStartColour(u.flashLevel)
        setStartColour(c)
        setColour(c)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The "why" slides: by themselves the first time (waiting their turn if
  // another pop-up is up), and again from "Why breathe?".
  const firstTime = useExplorationFocusFirstTime()
  const [slidesSeen, setSlidesSeen] = useState(false)
  const [slidesOpen, setSlidesOpen] = useState(false)
  const autoSlides = usePopupTurn(firstTime && !slidesSeen && phase === "intro")
  const closeSlides = () => { setSlidesSeen(true); setSlidesOpen(false) }
  const slides = (
    <ExplorationFocusSlides
      visible={autoSlides || slidesOpen}
      minutes={{ warmup: warmupMin, breathing: breathingMin, flash: flashMin, project: projectMin }}
      onClose={closeSlides}
    />
  )

  const warmupLeft = useCountdown(warmupMin, phase === "warmup", `${title} · warm-up`, () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    setPhase("breathingIntro")
  })
  const breathingLeft = useCountdown(breathingMin, phase === "breathing", `${title} · breathing`, () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    setPhase("flashIntro")
  })

  const flashLeft = useCountdown(flashMin, phase === "flash", `${title} · part 1`, () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
    setPhase("review")
  })
  const projectLeft = useCountdown(projectMin, phase === "project", `${title} · part 2`, () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
    setPhase("question")
  })

  function logRoute() {
    if (!wall) return
    const r = RESULTS[result]
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
    logAttempt({ success: r.sent, level: colour, wall, tries: r.tries, part: 1 })
    setNotice(null)
  }

  function triedAll() {
    const next = nextExplorationColour(colour, routes)
    if (next) {
      setColour(next)
      setResult(0)
      setNotice(`Every ${colourLabel(colour).toLowerCase()} sent. Now try every ${colourLabel(next).toLowerCase()}.`)
    } else {
      setPhase("review")
    }
  }

  function save() {
    logAttempt({ success: false, part: 2, fallReasons: reasons, notes: notes.trim() || undefined })
    setPhase("done")
    goToNextBlock()
  }

  // Density test's top bar: back, title, timer and count badges.
  const activeBar = (barTitle: string, left: number, onBack?: () => void) => (
    <View style={topBar_styles.bar}>
      <Pressable
        onPress={onBack}
        disabled={!onBack}
        style={{ width: 40, justifyContent: "center" }}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        {onBack ? <Text style={topBar_styles.backText}>←</Text> : null}
      </Pressable>
      <Text style={topBar_styles.title} numberOfLines={1}>{barTitle}</Text>
      <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
        <View style={[styles.timerBadge, left <= 60 && styles.timerBadgeUrgent]}>
          <Text style={[styles.timerText, left <= 60 && styles.timerTextUrgent]}>{formatTime(left)}</Text>
        </View>
        {routes.length > 0 && (
          <View style={styles.scoreBadge}>
            <Text style={styles.scoreBadgeText}>{formatPoints(summary.points)} pts</Text>
          </View>
        )}
      </View>
    </View>
  )

  // Part 1's attempts, in the same order as `routes`, for the ✕ on each row.
  const routeAttempts = attempts.filter((a) => a.part !== 2)
  const routeRows = (list: typeof routes, withResult: boolean, deletable = false) =>
    [...list].reverse().map((r, i) => (
      <View key={list.length - i} style={styles.climbRow}>
        <View style={[styles.climbLevelBar, { backgroundColor: swatch(r.colour, C) }]} />
        <Text style={styles.climbLevelText}>{colourLabel(r.colour)} · {wallLabel(r.wall)}</Text>
        {withResult && (
          <Text style={[styles.climbAttemptsText, r.sent && { color: C.green }]}>{resultLabel(r)}</Text>
        )}
        {withResult && <Text style={styles.climbScore}>+{formatPoints(routePoints(r))}</Text>}
        {deletable && removeAttempt && routeAttempts[list.length - 1 - i] && (
          <Pressable onPress={() => removeAttempt(routeAttempts[list.length - 1 - i].timestamp)} hitSlop={10} style={styles.deleteBtn}>
            <Text style={styles.deleteBtnText}>✕</Text>
          </Pressable>
        )}
      </View>
    ))

  // ── Intro ──────────────────────────────────────────────────────────────────
  if (phase === "intro") {
    const text = explorationNotes(explorationDescription(block?.description), startColour)
    return (
      <View style={shared_styles.screen}>
        <TopBar title={title} onBack={goToPreviousBlock} poster />
        <ScrollView contentContainerStyle={shared_styles.introContent}>
          <BlockNotes text={text} title="Coach notes" />
          <View style={styles.stepsCard}>
            {[
              ["Warm-up", `${warmupMin} min`],
              ["Breathing", `${breathingMin} min`],
              ["Part 1 · Flash", `${flashMin} min`],
              ["Part 2 · Project", `${projectMin} min`],
            ].map(([label, mins], n) => (
              <View key={label} style={styles.stepRow}>
                <Text style={styles.stepNum}>{n + 1}</Text>
                <Text style={styles.stepLabel}>{label}</Text>
                <Text style={styles.stepMins}>{mins}</Text>
              </View>
            ))}
          </View>
          <Pressable onPress={() => setSlidesOpen(true)} hitSlop={10} style={{ alignSelf: "flex-start" }}>
            <Text style={styles.whyLink}>Why breathe? See the 5 slides</Text>
          </Pressable>
        </ScrollView>
        <View style={shared_styles.footer}>
          <CustomButton title={`Start warm-up · ${warmupMin} min`} onPress={() => setPhase("warmup")} />
        </View>
        {slides}
      </View>
    )
  }

  // ── Warm-up ────────────────────────────────────────────────────────────────
  if (phase === "warmup") {
    return (
      <View style={shared_styles.screen}>
        <TopBar title="Warm-up" onBack={() => setPhase("intro")} />
        <BlockNotes text={EXPLORATION_WARMUP_NOTES} compact />
        <View style={styles.centerContent}>
          <Text style={styles.bigTimerLabel}>warm-up</Text>
          <Text style={styles.bigTimer}>{formatTime(warmupLeft)}</Text>
          <Pressable style={styles.nextBtn} onPress={() => setPhase("breathingIntro")}>
            <Text style={styles.nextBtnText}>I&apos;m warm</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  // ── Breathing ──────────────────────────────────────────────────────────────
  if (phase === "breathingIntro") {
    return (
      <View style={shared_styles.screen}>
        <TopBar title="Breathing" onBack={() => setPhase("intro")} />
        <ScrollView contentContainerStyle={shared_styles.introContent}>
          <BlockNotes text={EXPLORATION_BREATHING_NOTES} title="Before part 1" />
          <Pressable onPress={() => setSlidesOpen(true)} hitSlop={10} style={{ alignSelf: "flex-start" }}>
            <Text style={styles.whyLink}>Why breathe?</Text>
          </Pressable>
        </ScrollView>
        <View style={shared_styles.footer}>
          <CustomButton title={`Start breathing · ${breathingMin} min`} onPress={() => setPhase("breathing")} />
          <Pressable onPress={() => setPhase("flashIntro")} hitSlop={10} style={styles.skipLink}>
            <Text style={styles.skipLinkText}>Skip breathing</Text>
          </Pressable>
        </View>
        {slides}
      </View>
    )
  }

  if (phase === "breathing") {
    return (
      <View style={shared_styles.screen}>
        <TopBar title="Breathing" onBack={() => setPhase("breathingIntro")} />
        <View style={styles.centerContent}>
          <BreathingCircle />
          <Text style={styles.breathTimer}>{formatTime(breathingLeft)}</Text>
          <Pressable style={styles.nextBtn} onPress={() => setPhase("flashIntro")}>
            <Text style={styles.nextBtnText}>I&apos;m ready</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  // ── Ready for part 1 ───────────────────────────────────────────────────────
  if (phase === "flashIntro") {
    const text = explorationNotes(explorationDescription(block?.description), startColour)
    return (
      <View style={shared_styles.screen}>
        <TopBar title="Part 1 · Flash" onBack={() => setPhase("breathingIntro")} />
        <ScrollView contentContainerStyle={shared_styles.introContent}>
          <Text style={styles.readyLine}>Head on the wall. One move at a time.</Text>
          <BlockNotes text={text} title="Coach notes" />
        </ScrollView>
        <View style={shared_styles.footer}>
          <CustomButton title={`Start part 1 · ${flashMin} min`} onPress={() => setPhase("flash")} />
        </View>
      </View>
    )
  }

  // ── Part 1: Flash ──────────────────────────────────────────────────────────
  if (phase === "flash") {
    return (
      <View style={shared_styles.screen}>
        {activeBar("Part 1 · Flash", flashLeft, () => setPhase("flashIntro"))}
        <View style={styles.container}>
          {notice && <Text style={styles.notice}>{notice}</Text>}

          <View style={styles.pickerSection}>
            <Text style={styles.pickerLabel}>Grade</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {BoulderLevelOptions.filter((o) => o.value !== "orange").map((o) => {
                const on = colour === o.value
                return (
                  <Pressable
                    key={o.value}
                    style={[styles.gradeChip, { borderColor: o.color }, on && { backgroundColor: o.color }]}
                    onPress={() => setColour(o.value)}
                  >
                    <Text style={[styles.gradeChipText, on && styles.gradeChipTextSelected]}>{o.label}</Text>
                  </Pressable>
                )
              })}
            </ScrollView>
          </View>

          <View style={styles.pickerSection}>
            <Text style={styles.pickerLabel}>Wall</Text>
            <View style={styles.chipRow}>
              {WALLS.map((w) => {
                const on = wall === w.key
                return (
                  <Pressable key={w.key} style={[styles.attemptsChip, on && styles.attemptsChipSelected]} onPress={() => setWall(w.key)}>
                    <Text style={[styles.attemptsChipText, on && styles.attemptsChipTextSelected]}>{w.label}</Text>
                  </Pressable>
                )
              })}
            </View>
          </View>

          <View style={styles.pickerSection}>
            <Text style={styles.pickerLabel}>Attempts · max {EXPLORATION_MAX_TRIES}</Text>
            <View style={styles.chipRow}>
              {RESULTS.map((r, i) => {
                const on = result === i
                return (
                  <Pressable key={r.label} style={[styles.attemptsChip, on && styles.attemptsChipSelected]} onPress={() => setResult(i)}>
                    <Text style={[styles.attemptsChipText, on && styles.attemptsChipTextSelected]}>{r.label}</Text>
                  </Pressable>
                )
              })}
            </View>
          </View>

          <ScrollView style={styles.climbList} contentContainerStyle={styles.climbListContent} showsVerticalScrollIndicator={false}>
            {routes.length === 0 ? (
              <Text style={styles.emptyText}>
                {wall ? "Pick how it went and tap \"Log route\"." : "Pick the wall, then log each route."}
              </Text>
            ) : routeRows(routes, true, true)}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable style={[styles.logBoulderBtn, !wall && { opacity: 0.35 }]} onPress={logRoute} disabled={!wall}>
              <Text style={styles.logBoulderBtnText}>+ Log route</Text>
            </Pressable>
            <Pressable style={styles.finishPill} onPress={triedAll}>
              <Text style={styles.finishPillText}>Tried all {colourLabel(colour).toLowerCase()}s</Text>
            </Pressable>
          </View>
        </View>
      </View>
    )
  }

  // ── Part 2: Project ────────────────────────────────────────────────────────
  if (phase === "projectIntro" || phase === "project") {
    const running = phase === "project"
    const list = notSent.length > 0
      ? routeRows(notSent, false)
      : <Text style={styles.emptyText}>Every route went. Work the hardest ones you tried.</Text>
    if (!running) {
      return (
        <View style={shared_styles.screen}>
          <TopBar title="Part 2 · Project" />
          <ScrollView contentContainerStyle={shared_styles.introContent}>
            <BlockNotes text={EXPLORATION_PROJECT_NOTES} title="Coach notes" />
            <View style={styles.climbListContent}>{list}</View>
          </ScrollView>
          <View style={shared_styles.footer}>
            <CustomButton title={`Start part 2 · ${projectMin} min`} onPress={() => setPhase("project")} />
          </View>
        </View>
      )
    }
    // Running: like a free session — a big countdown and Stop; what they
    // realised is asked at the end.
    return (
      <View style={shared_styles.screen}>
        <TopBar title="Part 2 · Project" />
        <BlockNotes text={EXPLORATION_PROJECT_NOTES} compact />
        <View style={styles.centerContent}>
          <Text style={styles.bigTimerLabel}>remaining</Text>
          <Text style={styles.bigTimer}>{formatTime(projectLeft)}</Text>
          <Pressable style={styles.stopBtn} onPress={() => setPhase("question")}>
            <Text style={styles.stopBtnText}>Stop</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  // ── End-of-block question ──────────────────────────────────────────────────
  if (phase === "question") {
    const toggle = (key: string) => setReasons((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
    return (
      <View style={shared_styles.screen}>
        <TopBar title="Part 2 · Project" />
        <ScrollView contentContainerStyle={styles.questionContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.question}>What did you realise you did wrong in the first {flashMin} minutes?</Text>
          <View style={styles.chipRow}>
            {FALL_REASONS.map((r) => {
              const on = reasons.includes(r.key)
              return (
                <Pressable key={r.key} onPress={() => toggle(r.key)} style={[styles.reasonChip, on && styles.reasonChipOn]}>
                  <Text style={[styles.reasonChipText, on && styles.reasonChipTextOn]}>{r.label}</Text>
                </Pressable>
              )
            })}
          </View>
          <TextInput
            style={styles.input}
            value={notes}
            onChangeText={setNotes}
            placeholder="Anything else? (optional)"
            placeholderTextColor={C.textMuted}
            multiline
          />
        </ScrollView>
        <View style={shared_styles.footer}>
          <CustomButton title="Save" onPress={save} />
        </View>
      </View>
    )
  }

  // ── Review (after part 1) / Done ─────────────────────────────────────────────
  // Part 1's points vs the last exploration, then where they came from.
  // After part 1 it leads into part 2; on a finished block, to the next one.
  const lastWall = (w: string) => last?.summary.byWall.find((b) => b.wall === w)
  const diff = last ? Math.round((summary.points - last.summary.points) * 10) / 10 : 0
  return (
    <View style={shared_styles.screen}>
      <TopBar title={phase === "review" ? "Part 1 · Review" : "Session complete"} onBack={phase === "review" ? undefined : goToPreviousBlock} />
      <ScrollView contentContainerStyle={styles.reviewScroll}>
        <View style={styles.scoreCard}>
          <Text style={styles.scoreLabel}>Points today</Text>
          <Text style={styles.scoreValue}>{formatPoints(summary.points)}</Text>
          <Text style={styles.scoreSub}>
            {routes.length} route{routes.length !== 1 ? "s" : ""} · {routes.length - notSent.length} sent
          </Text>
        </View>

        <View style={styles.lastCard}>
          {last === undefined ? (
            <Text style={styles.scoreSub}>Loading last session…</Text>
          ) : last === null ? (
            <Text style={styles.scoreSub}>First exploration. Next time you&apos;ll see how you compare.</Text>
          ) : (
            <>
              <View style={{ flex: 1 }}>
                <Text style={styles.breakdownTitle}>Last session · {shortDate(last.date)}</Text>
                <Text style={styles.lastValue}>{formatPoints(last.summary.points)} pts</Text>
              </View>
              <Text style={[styles.diff, { color: diff > 0 ? C.green : diff < 0 ? C.red : C.textSecondary }]}>
                {diff > 0 ? "+" : ""}{formatPoints(diff)}
              </Text>
            </>
          )}
        </View>

        {summary.byWall.length > 0 && (
          <View style={styles.breakdownCard}>
            <Text style={styles.breakdownTitle}>By wall</Text>
            {summary.byWall.map((b) => {
              const prev = lastWall(b.wall)
              return (
                <View key={b.wall} style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>{wallLabel(b.wall)}</Text>
                  <Text style={styles.breakdownCount}>{b.sent}/{b.tried} sent</Text>
                  <Text style={styles.breakdownPts}>{formatPoints(b.points)} pts</Text>
                  {prev && <Text style={styles.breakdownLast}>last {formatPoints(prev.points)}</Text>}
                </View>
              )
            })}
          </View>
        )}

        {summary.byColour.length > 0 && (
          <View style={styles.breakdownCard}>
            <Text style={styles.breakdownTitle}>By colour</Text>
            {summary.byColour.map((b) => (
              <View key={b.colour} style={styles.breakdownRow}>
                <View style={[styles.levelDot, { backgroundColor: swatch(b.colour, C) }]} />
                <Text style={styles.breakdownLabel}>{colourLabel(b.colour)}</Text>
                <Text style={styles.breakdownCount}>{b.sent}/{b.tried} sent</Text>
                <Text style={styles.breakdownPts}>{formatPoints(b.points)} pts</Text>
              </View>
            ))}
          </View>
        )}
        <Pressable
          style={[styles.startButton, { width: "100%" }]}
          onPress={phase === "review" ? () => setPhase("projectIntro") : goToNextBlock}
        >
          <Text style={styles.startButtonText}>{phase === "review" ? "Go to part 2" : nextLabel}</Text>
        </Pressable>
      </ScrollView>
    </View>
  )
}

// The breathing guide: a circle that grows while breathing in (4 s) and
// shrinks while breathing out (6 s), with the cue under it.
function BreathingCircle() {
  const styles = useSheet(sheet)
  const scale = useRef(new Animated.Value(0.55)).current
  const [cue, setCue] = useState<"in" | "out">("in")
  useEffect(() => {
    const start = Date.now()
    const ease = Easing.inOut(Easing.sin)
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(scale, { toValue: 1, duration: BREATH_IN_MS, easing: ease, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 0.55, duration: BREATH_OUT_MS, easing: ease, useNativeDriver: true }),
    ]))
    loop.start()
    const id = setInterval(() => setCue(breathAt(Date.now() - start).phase), 200)
    return () => { loop.stop(); clearInterval(id) }
  }, [scale])
  return (
    <View style={styles.breathWrap}>
      <Animated.View style={[styles.breathCircle, { transform: [{ scale }] }]} />
      <Text style={styles.breathCue}>{cue === "in" ? "Breathe in" : "Breathe out"}</Text>
    </View>
  )
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

// Same values as ExplorationSessionBlock (the Density test).
const sheet = paperSheet((C) => StyleSheet.create({
  container: { flex: 1, width: "100%", paddingHorizontal: 20, paddingTop: 8 },
  notice: { fontSize: 15, fontWeight: "700", color: C.green, marginBottom: 10 },

  scoreBadge: { backgroundColor: C.surface, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 3 },
  scoreBadgeText: { color: C.green, fontSize: 13, fontWeight: "700" },
  timerBadge: { backgroundColor: C.surface, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 },
  timerBadgeUrgent: { backgroundColor: "rgba(219,80,74,0.15)" },
  timerText: { fontSize: 14, fontWeight: "700", color: C.textSecondary, fontVariant: ["tabular-nums"] },
  timerTextUrgent: { color: C.red },

  pickerSection: { marginBottom: 12, gap: 6 },
  pickerLabel: { fontSize: 12, fontWeight: "600", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.4 },
  chipRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  gradeChip: { borderWidth: 2, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 },
  gradeChipText: { fontSize: 14, fontWeight: "600", color: C.textSecondary },
  gradeChipTextSelected: { color: C.onAccent },
  attemptsChip: {
    borderWidth: 1.5, borderColor: C.border, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 7, backgroundColor: C.surfaceHigh,
  },
  attemptsChipSelected: { borderColor: C.green, backgroundColor: C.green },
  attemptsChipText: { fontSize: 14, fontWeight: "600", color: C.textSecondary },
  attemptsChipTextSelected: { color: C.onAccent },

  climbList: { flex: 1 },
  climbListContent: { gap: 8, paddingBottom: 8 },
  emptyText: { fontSize: 14, color: C.textMuted, textAlign: "center", paddingTop: 16, lineHeight: 20 },
  climbRow: {
    flexDirection: "row", alignItems: "center", backgroundColor: C.surface, borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 12, gap: 10,
  },
  climbLevelBar: { width: 4, height: 28, borderRadius: 2 },
  climbLevelText: { fontSize: 15, fontWeight: "600", color: C.textPrimary, flex: 1 },
  climbAttemptsText: { fontSize: 13, color: C.textSecondary, fontWeight: "500" },
  climbScore: { fontSize: 13, fontWeight: "700", color: C.green },
  deleteBtn: { paddingLeft: 8 },
  deleteBtnText: { fontSize: 14, color: C.textMuted, fontWeight: "600" },

  footer: { paddingTop: 10, paddingBottom: 24, flexDirection: "row", alignItems: "center", gap: 10 },
  logBoulderBtn: { flex: 1, backgroundColor: C.green, borderRadius: 14, paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  logBoulderBtnText: { fontSize: 15, fontWeight: "700", color: C.onAccent },
  finishPill: {
    borderRadius: 22, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 18, paddingVertical: 11, backgroundColor: C.surface,
  },
  finishPillText: { fontSize: 14, fontWeight: "700", color: C.textSecondary },
  startButton: { backgroundColor: C.green, borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  startButtonText: { color: C.onAccent, fontSize: 16, fontWeight: "700", padding: 10 },

  // Part 2's countdown — same as FreeSessionBlock.
  centerContent: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 20 },
  bigTimerLabel: { fontSize: 13, fontWeight: "600", color: C.textMuted, textTransform: "uppercase", letterSpacing: 1.5 },
  bigTimer: { fontSize: 72, fontWeight: "700", color: C.textPrimary, fontVariant: ["tabular-nums"], letterSpacing: -2, lineHeight: 80 },
  stopBtn: { width: "100%", borderRadius: 16, paddingVertical: 18, alignItems: "center", borderWidth: 2, borderColor: C.red, marginTop: 8 },
  stopBtnText: { fontSize: 18, fontWeight: "700", color: C.red, letterSpacing: 0.3 },

  stepsCard: { backgroundColor: C.surface, borderRadius: 14, padding: 14, gap: 10 },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepNum: { width: 22, height: 22, borderRadius: 11, overflow: "hidden", textAlign: "center", lineHeight: 22, fontSize: 12, fontWeight: "800", color: C.onAccent, backgroundColor: C.green },
  stepLabel: { flex: 1, fontSize: 15, fontWeight: "600", color: C.textPrimary },
  stepMins: { fontSize: 14, fontWeight: "700", color: C.textSecondary, fontVariant: ["tabular-nums"] },
  whyLink: { fontSize: 15, fontWeight: "700", color: C.green, textDecorationLine: "underline" },
  skipLink: { alignSelf: "center", paddingTop: 12 },
  skipLinkText: { fontSize: 14, fontWeight: "600", color: C.textSecondary },
  readyLine: { fontSize: 20, fontWeight: "800", color: C.textPrimary, lineHeight: 26 },
  nextBtn: { width: "100%", borderRadius: 16, paddingVertical: 18, alignItems: "center", borderWidth: 2, borderColor: C.green, marginTop: 8 },
  nextBtnText: { fontSize: 18, fontWeight: "700", color: C.green, letterSpacing: 0.3 },
  breathWrap: { width: 240, height: 240, alignItems: "center", justifyContent: "center" },
  breathCircle: { position: "absolute", width: 240, height: 240, borderRadius: 120, backgroundColor: C.green, opacity: 0.22 },
  breathCue: { fontSize: 24, fontWeight: "800", color: C.textPrimary },
  breathTimer: { fontSize: 32, fontWeight: "700", color: C.textSecondary, fontVariant: ["tabular-nums"] },

  questionContent: { padding: 20, gap: 14 },
  question: { fontSize: 18, fontWeight: "700", color: C.textPrimary, lineHeight: 24 },
  reasonChip: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 22, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface },
  reasonChipOn: { backgroundColor: C.red, borderColor: C.red },
  reasonChipText: { fontSize: 15, fontWeight: "600", color: C.textPrimary },
  reasonChipTextOn: { color: "#fff", fontWeight: "800" },
  input: { minHeight: 80, backgroundColor: C.surface, borderRadius: 12, padding: 12, color: C.textPrimary, fontSize: 15, textAlignVertical: "top" },

  reviewScroll: { flexGrow: 1, padding: 20, alignItems: "center", gap: 12 },
  scoreCard: { width: "100%", backgroundColor: C.surface, borderRadius: 16, padding: 20, alignItems: "center", gap: 4 },
  scoreLabel: { fontSize: 12, fontWeight: "600", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  scoreValue: { fontSize: 64, fontWeight: "800", color: C.yellow, lineHeight: 72, letterSpacing: -2 },
  scoreSub: { fontSize: 14, color: C.textSecondary },
  breakdownCard: { width: "100%", backgroundColor: C.surface, borderRadius: 14, padding: 16, gap: 10, marginBottom: 8 },
  breakdownTitle: { fontSize: 13, fontWeight: "700", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2 },
  breakdownRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  levelDot: { width: 12, height: 12, borderRadius: 6 },
  breakdownLabel: { fontSize: 15, fontWeight: "600", flex: 1, color: C.textPrimary },
  breakdownCount: { fontSize: 14, color: C.textSecondary },
  breakdownPts: { fontSize: 14, fontWeight: "700", color: C.green, minWidth: 56, textAlign: "right" },
  breakdownLast: { fontSize: 12, color: C.textMuted, minWidth: 48, textAlign: "right" },
  lastCard: { width: "100%", backgroundColor: C.surface, borderRadius: 14, padding: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  lastValue: { fontSize: 22, fontWeight: "800", color: C.textPrimary, marginTop: 2 },
  diff: { fontSize: 28, fontWeight: "800", letterSpacing: -0.5 },
}))
