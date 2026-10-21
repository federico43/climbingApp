import { C } from "@/utils/theme"
import CustomButton from "@/components/customButton"
import { useAuth } from "@/components/auth-context"
import VideoRecorder from "@/components/VideoRecorder"
import type { Attempt } from "@/hooks/WorkoutHook"
import { getUsers } from "@/services/BoulderGraphService"
import { useBlockTimer } from "@/utils/blockTimer"
import { BoulderLevelOptions, colourIndex, colourLabel, shiftColour } from "@/utils/boulderColours"
import {
  FALL_REASONS, fallReasonLabel, normalizeProjectBlock, PROJECT_V2, resumedBlockStart,
  reviewPromptHistory, shouldPromptReviewClip, summarizeProjectAttempts,
} from "@/utils/progression/projectBouldering"
import { saveVideoLocally } from "@/utils/saveVideo"
import { shared_styles, TopBar } from "@/utils/BlockStyles"
import { Ionicons } from "@expo/vector-icons"
import { ID } from "appwrite"
import * as Haptics from "expo-haptics"
import React, { useEffect, useRef, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { AnimatedCircularProgress } from "react-native-circular-progress"
import { useNextBlockLabel } from "@/utils/blockNav"

// Project bouldering v2 (docs/project-bouldering-v2.md): work boulders of one
// grade against the block's clock. One big button logs an attempt and starts
// the rest; while resting the athlete can mark the attempt as a send or tag
// why they came off. Now and then the app asks them to film the next attempt
// for the coach (shouldPromptReviewClip).
//
// Phases: intro → [grade] → ready ⇄ rest → … → timeUp → review.

type Phase = "intro" | "grade" | "ready" | "rest" | "timeUp" | "review"

interface Props {
  block: any
  logAttempt: (attempt: Omit<Attempt, "blockIndex" | "type" | "timestamp">) => void
  updateLastAttempt?: (patch: Partial<Omit<Attempt, "blockIndex" | "type" | "timestamp">>) => void
  undoLastAttempt?: () => void
  restTimeRemaining: number | null
  startRestTimer: (duration: number) => void
  attempts: Attempt[]       // this block's
  allAttempts: Attempt[]    // the whole workout's (review-clip cap)
  goToNextBlock: () => void
  goToPreviousBlock?: () => void
}

function clock(secs: number): string {
  const s = Math.abs(Math.round(secs))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

export function ProjectBoulderingBlock({
  block, logAttempt, updateLastAttempt, undoLastAttempt, restTimeRemaining, startRestTimer,
  attempts, allAttempts, goToNextBlock, goToPreviousBlock,
}: Props) {
  const nextLabel = useNextBlockLabel("Continue")
  const settings = normalizeProjectBlock(block)
  const blockTitle: string = block.blockName || "Project bouldering"
  const limitSecs = settings.timeLimit * 60
  const blockTimer = useBlockTimer()
  const { User } = useAuth()

  // Resuming (or coming back to) a block with attempts: the clock is rebuilt
  // from them (the live timer isn't persisted) and the grade from their level.
  const [startedAt, setStartedAt] = useState<number | null>(() => resumedBlockStart(attempts.map((a) => a.timestamp)))
  const [grade, setGrade] = useState<string>(() => settings.grade || summarizeProjectAttempts(attempts).grade)
  const [now, setNow] = useState(Date.now())
  const secondsLeft = startedAt == null ? limitSecs : limitSecs - Math.floor((now - startedAt) / 1000)
  const [phase, setPhase] = useState<Phase>(() =>
    attempts.length === 0 ? "intro" : secondsLeft <= 0 ? "review" : "ready"
  )
  const [overtime, setOvertime] = useState(false)   // "One more attempt" after time's up

  // Review-clip prompt: the per-block caps come from the attempts themselves
  // (reviewPromptHistory); only the unanswered card and an accepted "film the
  // next one" live here.
  const [promptVisible, setPromptVisible] = useState(false)
  const [recordNext, setRecordNext] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const filmingReviewRef = useRef(false)

  // Grade picker default: one colour above the athlete's flash level.
  useEffect(() => {
    if (grade || !User?.$id) return
    let cancelled = false
    getUsers(User.$id)
      .then((u: any) => {
        if (cancelled || !u?.flashLevel || colourIndex(u.flashLevel) < 0) return
        setGrade((g) => g || shiftColour(u.flashLevel, 1))
      })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Tick the block clock once it has started.
  useEffect(() => {
    if (startedAt == null) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [startedAt])

  // Time's up: ask once the athlete is between attempts (never mid-rest).
  useEffect(() => {
    if (phase === "ready" && startedAt != null && secondsLeft <= 0 && !overtime) setPhase("timeUp")
  }, [phase, startedAt, secondsLeft, overtime])

  // End of rest → back to the button.
  useEffect(() => {
    if (phase === "rest" && restTimeRemaining === 0) setPhase("ready")
  }, [phase, restTimeRemaining])

  const last = attempts[attempts.length - 1]
  const summary = summarizeProjectAttempts(attempts)

  function start() {
    blockTimer.start()
    if (startedAt == null) { setStartedAt(Date.now()); setNow(Date.now()) }
    setPhase("ready")
  }

  function record(extra: { videoId?: string; reviewClip?: boolean } = {}) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {})
    const ask = shouldPromptReviewClip({
      enabled: settings.reviewPrompts,
      attemptNumber: attempts.length + 1,
      sentInBlock: summary.sent,
      clipsThisWorkout: allAttempts.filter((a) => a.reviewClip).length + (extra.reviewClip ? 1 : 0),
      ...reviewPromptHistory(attempts),
      secondsLeft: startedAt == null ? null : secondsLeft,
      restTime: settings.restTime,
      // The review clip being logged right now settles the pending one.
      pendingRecord: recordNext && !extra.reviewClip,
    }, Math.random)
    logAttempt({
      success: false, level: grade, fallReasons: [], pbv: PROJECT_V2, ...extra,
      ...(ask ? { reviewPrompted: true } : {}),
    })
    if (overtime) setOvertime(false)   // the one extra attempt is spent
    setPromptVisible(ask)
    startRestTimer(settings.restTime)
    setPhase("rest")
  }

  function onVideo(uri: string) {
    setShowCamera(false)
    const reviewClip = filmingReviewRef.current
    const rowId = ID.unique()
    const n = attempts.length + 1
    saveVideoLocally(uri, "project_bouldering", {
      grade,
      projectName: `${reviewClip ? "Review request · " : ""}${blockTitle} · attempt ${n}`,
      rowId,
    })
    setRecordNext(false)
    record({ videoId: rowId, ...(reviewClip ? { reviewClip: true } : {}) })
  }

  function film(review: boolean) {
    filmingReviewRef.current = review
    setShowCamera(true)
  }

  function toggleSent() {
    if (!last) return
    const sent = !last.success
    updateLastAttempt?.({ success: sent, fallReasons: [] })
    if (sent) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      // Sent: no more review clips in this block — drop the card, and an
      // already-accepted "film the next one" with it.
      setPromptVisible(false)
      setRecordNext(false)
    }
  }

  function toggleReason(key: string) {
    if (!last || last.success) return
    const cur = last.fallReasons ?? []
    updateLastAttempt?.({ fallReasons: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] })
  }

  function undo() {
    undoLastAttempt?.()
    // The prompt this attempt raised goes with it (its count lives on the
    // attempt), and so does a "film the next one" accepted from it.
    if (last?.reviewPrompted) setRecordNext(false)
    setPromptVisible(false)
    setPhase("ready")
  }

  const timeChip = startedAt != null && (
    <View style={[s.timeChip, secondsLeft <= 60 && s.timeChipUrgent]}>
      <Ionicons name="time-outline" size={14} color={secondsLeft <= 60 ? C.bg : C.green} />
      <Text style={[s.timeChipText, secondsLeft <= 60 && { color: C.bg }]}>
        {secondsLeft > 0 ? clock(secondsLeft) : `+${clock(-secondsLeft)}`}
      </Text>
    </View>
  )

  // Shown on rest and, if rest ran out (or was skipped) before it was
  // answered, on ready too — it has already used up one of the block's prompts.
  const promptCard = promptVisible && !recordNext && (
    <View style={s.promptCard}>
      <Ionicons name="videocam" size={22} color={C.yellow} />
      <View style={{ flex: 1, gap: 10 }}>
        <Text style={s.promptText}>Film your next attempt so your coach can review it?</Text>
        <View style={s.promptActions}>
          <Pressable style={s.promptYes} onPress={() => { setRecordNext(true); setPromptVisible(false) }}>
            <Text style={s.promptYesText}>Sure</Text>
          </Pressable>
          <Pressable onPress={() => setPromptVisible(false)} hitSlop={8}>
            <Text style={s.linkMuted}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )

  // ── 1. Intro ─────────────────────────────────────────────────────────────────

  if (phase === "intro") {
    return (
      <View style={shared_styles.screen}>
        <TopBar title={blockTitle} onBack={goToPreviousBlock} />
        <ScrollView contentContainerStyle={shared_styles.introContent}>
          <View style={s.introPills}>
            {settings.grade ? <GradePill grade={settings.grade} /> : (
              <View style={s.infoPill}><Text style={s.infoPillText}>You pick the grade</Text></View>
            )}
            <View style={s.infoPill}><Text style={s.infoPillText}>⏱ {settings.timeLimit} min</Text></View>
            <View style={s.infoPill}><Text style={s.infoPillText}>{clock(settings.restTime)} rest</Text></View>
          </View>
          {!!block.description && <Text style={shared_styles.description}>{block.description}</Text>}
          <Text style={s.hint}>
            Tap the big button every time you come off (or top out). Rest starts on its own — use it to note what happened.
          </Text>
          <CustomButton title={settings.grade ? "Start" : "Next"} onPress={() => (settings.grade ? start() : setPhase("grade"))} />
        </ScrollView>
      </View>
    )
  }

  // ── 2. Grade (only when the coach left it to the athlete) ─────────────────────

  if (phase === "grade") {
    return (
      <View style={shared_styles.screen}>
        <TopBar title={blockTitle} onBack={() => setPhase("intro")} />
        <ScrollView contentContainerStyle={shared_styles.introContent}>
          <Text style={s.heading}>Which grade are you working?</Text>
          <View style={s.gradeGrid}>
            {BoulderLevelOptions.map((g) => {
              const on = grade === g.value
              return (
                <Pressable
                  key={g.value}
                  onPress={() => setGrade(g.value)}
                  style={[s.gradeChip, on && { backgroundColor: g.color, borderColor: g.color }]}
                >
                  <View style={[s.gradeDot, { backgroundColor: g.color }, on && { backgroundColor: g.on }]} />
                  <Text style={[s.gradeChipText, on && { color: g.on, fontWeight: "700" }]}>{g.label}</Text>
                </Pressable>
              )
            })}
          </View>
          <CustomButton title="Start" onPress={start} disabled={!grade} />
        </ScrollView>
      </View>
    )
  }

  // ── 3. Ready: the big button ──────────────────────────────────────────────────

  if (phase === "ready") {
    return (
      <View style={shared_styles.screen}>
        <TopBar
          title={blockTitle}
          onBack={attempts.length === 0 ? () => setPhase(settings.grade ? "intro" : "grade") : undefined}
        />
        <View style={s.readyBody}>
          <View style={s.readyTop}>
            {/* Grade beside the clock — TopBar's side slot is too narrow for it. */}
            <View style={s.readyMeta}>
              {!!grade && <GradePill grade={grade} />}
              {timeChip}
            </View>
            <Text style={s.countNum}>{attempts.length}</Text>
            <Text style={s.countLabel}>
              attempt{attempts.length !== 1 ? "s" : ""}
              {summary.sends > 0 ? ` · ${summary.sends} send${summary.sends !== 1 ? "s" : ""} 🎉` : ""}
            </Text>
          </View>

          <Pressable
            onPress={() => (recordNext ? film(true) : record())}
            style={({ pressed }) => [s.bigButton, recordNext && s.bigButtonRecord, pressed && { transform: [{ scale: 0.96 }] }]}
          >
            {recordNext && <Ionicons name="videocam" size={40} color={C.bg} />}
            <Text style={s.bigButtonText}>{recordNext ? "Record\nattempt" : "Attempt"}</Text>
          </Pressable>

          {recordNext ? (
            <View style={{ alignItems: "center", gap: 6 }}>
              <Text style={s.hint}>Your coach asked for this one on video.</Text>
              <Pressable onPress={() => setRecordNext(false)} hitSlop={8}>
                <Text style={s.linkMuted}>Don&apos;t film it</Text>
              </Pressable>
            </View>
          ) : promptVisible ? (
            promptCard
          ) : (
            <Pressable onPress={() => film(false)} hitSlop={8} style={s.filmLink}>
              <Ionicons name="videocam-outline" size={16} color={C.textSecondary} />
              <Text style={s.linkMuted}>Film this one</Text>
            </Pressable>
          )}
        </View>
        <View style={s.footer}>
          <Pressable onPress={() => setPhase("review")} hitSlop={8}>
            <Text style={s.finishText}>Finish block</Text>
          </Pressable>
        </View>
        {showCamera && (
          <View style={s.cameraOverlay}>
            <VideoRecorder onFinish={onVideo} onClose={() => setShowCamera(false)} />
          </View>
        )}
      </View>
    )
  }

  // ── 4. Rest: send / fall reasons, review prompt ───────────────────────────────

  if (phase === "rest") {
    const t = restTimeRemaining ?? 0
    const fill = settings.restTime ? (t / settings.restTime) * 100 : 0
    const sent = !!last?.success
    const reasons = last?.fallReasons ?? []
    return (
      <View style={shared_styles.screen}>
        <View style={s.restHeader}>
          <View style={{ flex: 1 }}>
            <Text style={s.restTitle}>Attempt {attempts.length}</Text>
            <Text style={s.restSub}>Rest{last?.videoId ? " · clip saved 🎥" : ""}</Text>
          </View>
          <AnimatedCircularProgress
            size={92} width={6} fill={fill} rotation={0}
            tintColor={t <= 15 ? C.red : C.green} backgroundColor={C.surface}
          >
            {() => <Text style={s.restTimer}>{t > 0 ? clock(t) : "go!"}</Text>}
          </AnimatedCircularProgress>
        </View>

        <ScrollView contentContainerStyle={s.restContent}>
          <Pressable onPress={toggleSent} style={[s.sentToggle, sent && s.sentToggleOn]}>
            <Text style={[s.sentText, sent && { color: C.bg }]}>{sent ? "Sent! 🎉" : "Sent it?"}</Text>
          </Pressable>

          {!sent && (
            <>
              <Text style={s.sectionLabel}>Why did you come off? <Text style={s.optional}>· optional, pick any</Text></Text>
              <View style={s.chipWrap}>
                {FALL_REASONS.map((r) => {
                  const on = reasons.includes(r.key)
                  return (
                    <Pressable key={r.key} onPress={() => toggleReason(r.key)} style={[s.chip, on && s.chipOn]}>
                      <Text style={[s.chipText, on && s.chipTextOn]}>{r.label}</Text>
                    </Pressable>
                  )
                })}
              </View>
            </>
          )}

          {promptCard}
          {recordNext && (
            <Text style={s.hint}>📹 Your next attempt will be filmed for your coach.</Text>
          )}
        </ScrollView>

        <View style={s.footerRow}>
          <Pressable onPress={undo} hitSlop={8}>
            <Text style={s.linkMuted}>Undo attempt</Text>
          </Pressable>
          <Pressable style={s.pillBtn} onPress={() => setPhase("ready")}>
            <Text style={s.pillBtnText}>Skip rest</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  // ── 5. Time's up ──────────────────────────────────────────────────────────────

  if (phase === "timeUp") {
    return (
      <View style={shared_styles.screen}>
        <TopBar title={blockTitle} />
        <View style={[shared_styles.container, { justifyContent: "center", gap: 14 }]}>
          <Ionicons name="alarm-outline" size={56} color={C.red} />
          <Text style={s.heading}>Time&apos;s up</Text>
          <Text style={s.hint}>{attempts.length} attempt{attempts.length !== 1 ? "s" : ""} on {colourLabel(grade)}.</Text>
          <View style={{ width: "100%", gap: 12, marginTop: 12 }}>
            <CustomButton title="Finish block" onPress={() => setPhase("review")} />
            <Pressable onPress={() => { setOvertime(true); setPhase("ready") }} style={{ alignItems: "center" }} hitSlop={8}>
              <Text style={s.linkMuted}>One more attempt</Text>
            </Pressable>
          </View>
        </View>
      </View>
    )
  }

  // ── 6. Review ─────────────────────────────────────────────────────────────────

  return (
    <View style={shared_styles.screen}>
      <TopBar
        title="Review"
        onBack={startedAt != null && secondsLeft > 0 ? () => setPhase("ready") : undefined}
      />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <ProjectSummaryCard attempts={attempts} />
        <CustomButton title={nextLabel} onPress={goToNextBlock} />
      </ScrollView>
    </View>
  )
}

// ─── Shared pieces (also used by the workout summary and history) ──────────────

export function GradePill({ grade, small }: { grade: string; small?: boolean }) {
  const opt = BoulderLevelOptions.find((o) => o.value === grade)
  return (
    <View style={[s.gradePill, small && s.gradePillSmall, { backgroundColor: opt?.color ?? C.surfaceHigh }]}>
      <Text style={[s.gradePillText, small && { fontSize: 12 }, { color: opt?.on ?? C.textPrimary }]}>{colourLabel(grade)}</Text>
    </View>
  )
}

// Grade · attempts · sent, then the fall-reason counts. `compact` = one line
// of stats and small chips (workout summary rows, coach dashboard).
export function ProjectSummaryCard({ attempts, compact }: { attempts: Attempt[] | any[]; compact?: boolean }) {
  const sum = summarizeProjectAttempts(attempts)
  if (compact) {
    return (
      <View style={{ gap: 6 }}>
        <View style={s.compactRow}>
          {!!sum.grade && <GradePill grade={sum.grade} small />}
          <Text style={s.compactText}>
            {sum.attempts} attempt{sum.attempts !== 1 ? "s" : ""} · {sum.sent ? `Sent ✓${sum.sends > 1 ? ` ×${sum.sends}` : ""}` : "Not sent"}
          </Text>
        </View>
        {sum.reasons.length > 0 && (
          <View style={s.chipWrap}>
            {sum.reasons.map((r) => (
              <View key={r.key} style={s.reasonTag}><Text style={s.reasonTagText}>{fallReasonLabel(r.key)} ×{r.count}</Text></View>
            ))}
          </View>
        )}
      </View>
    )
  }
  return (
    <View style={s.card}>
      <View style={s.statsRow}>
        <View style={s.stat}>
          {sum.grade ? <GradePill grade={sum.grade} /> : <Text style={s.statNum}>—</Text>}
          <Text style={s.statLabel}>grade</Text>
        </View>
        <View style={s.stat}>
          <Text style={s.statNum}>{sum.attempts}</Text>
          <Text style={s.statLabel}>attempt{sum.attempts !== 1 ? "s" : ""}</Text>
        </View>
        <View style={s.stat}>
          <Text style={[s.statNum, { color: sum.sent ? C.green : C.textSecondary }]}>{sum.sent ? (sum.sends > 1 ? `✓ ×${sum.sends}` : "✓") : "✗"}</Text>
          <Text style={s.statLabel}>{sum.sent ? "sent" : "not sent"}</Text>
        </View>
      </View>
      {sum.reasons.length > 0 && (
        <>
          <Text style={s.sectionLabel}>Why they came off</Text>
          {sum.reasons.map((r) => (
            <View key={r.key} style={s.reasonRow}>
              <Text style={s.reasonLabel}>{fallReasonLabel(r.key)}</Text>
              <View style={s.reasonBarTrack}>
                <View style={[s.reasonBar, { flex: r.count }]} />
                <View style={{ flex: Math.max(0, sum.attempts - sum.sends - r.count) }} />
              </View>
              <Text style={s.reasonCount}>{r.count}</Text>
            </View>
          ))}
        </>
      )}
      {sum.clips > 0 && (
        <Text style={s.hint}>
          🎥 {sum.clips} clip{sum.clips !== 1 ? "s" : ""}{sum.reviewClips > 0 ? ` · ${sum.reviewClips} for coach review` : ""}
        </Text>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  heading: { fontSize: 24, fontWeight: "800", color: C.textPrimary },
  hint: { fontSize: 14, color: C.textSecondary, lineHeight: 20, textAlign: "center" },
  introPills: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  infoPill: { backgroundColor: C.surface, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  infoPillText: { fontSize: 14, fontWeight: "700", color: C.textPrimary },

  // Same chips as the 4×4 / constraint-warmup grade pickers.
  gradeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  gradeChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  gradeDot: {
    width: 10, height: 10, borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.45)",
  },
  gradeChipText: { fontSize: 13, fontWeight: "600", color: C.textSecondary },

  gradePill: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 5, alignSelf: "center" },
  gradePillSmall: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 10 },
  gradePillText: { fontSize: 14, fontWeight: "800" },

  timeChip: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center",
    backgroundColor: C.surface, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6,
  },
  timeChipUrgent: { backgroundColor: C.red },
  timeChipText: { fontSize: 20, fontWeight: "800", color: C.textPrimary, fontVariant: ["tabular-nums"] },

  readyBody: { flex: 1, alignItems: "center", justifyContent: "space-evenly", paddingHorizontal: 24 },
  readyTop: { alignItems: "center" },
  readyMeta: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  countNum: { fontSize: 64, fontWeight: "800", color: C.textPrimary, fontVariant: ["tabular-nums"] },
  countLabel: { fontSize: 15, color: C.textSecondary, marginTop: -4 },
  bigButton: {
    width: 230, height: 230, borderRadius: 115, backgroundColor: C.green,
    alignItems: "center", justifyContent: "center", gap: 4,
    shadowColor: C.green, shadowOpacity: 0.35, shadowRadius: 24, shadowOffset: { width: 0, height: 0 }, elevation: 8,
  },
  bigButtonRecord: { backgroundColor: C.yellow, shadowColor: C.yellow },
  bigButtonText: { fontSize: 30, fontWeight: "900", color: C.bg, textAlign: "center" },
  filmLink: { flexDirection: "row", alignItems: "center", gap: 6 },
  linkMuted: { fontSize: 15, fontWeight: "600", color: C.textSecondary },
  footer: { alignItems: "center", paddingBottom: 36, paddingTop: 8 },
  finishText: { fontSize: 16, fontWeight: "700", color: C.textSecondary },
  cameraOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 10, backgroundColor: "#000" },

  restHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 24, paddingTop: 20, paddingBottom: 8, gap: 12 },
  restTitle: { fontSize: 28, fontWeight: "800", color: C.textPrimary },
  restSub: { fontSize: 14, color: C.textSecondary, marginTop: 2 },
  restTimer: { fontSize: 20, fontWeight: "800", color: C.textPrimary, fontVariant: ["tabular-nums"] },
  restContent: { padding: 24, gap: 16, flexGrow: 1 },
  sentToggle: {
    paddingVertical: 18, borderRadius: 16, alignItems: "center",
    borderWidth: 2, borderColor: C.green,
  },
  sentToggleOn: { backgroundColor: C.green },
  sentText: { fontSize: 20, fontWeight: "800", color: C.green },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.6 },
  optional: { textTransform: "none", fontWeight: "500" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 16, paddingVertical: 12, borderRadius: 22,
    borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface,
  },
  chipOn: { backgroundColor: C.red, borderColor: C.red },
  chipText: { fontSize: 15, fontWeight: "600", color: C.textPrimary },
  chipTextOn: { color: "#fff", fontWeight: "800" },
  promptCard: {
    flexDirection: "row", gap: 12, padding: 16, borderRadius: 16, alignSelf: "stretch",
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.yellow,
  },
  promptText: { fontSize: 15, fontWeight: "700", color: C.textPrimary, lineHeight: 21 },
  promptActions: { flexDirection: "row", alignItems: "center", gap: 18 },
  promptYes: { backgroundColor: C.yellow, borderRadius: 18, paddingHorizontal: 20, paddingVertical: 8 },
  promptYesText: { fontSize: 15, fontWeight: "800", color: C.bg },
  footerRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 24, paddingTop: 12, paddingBottom: 36,
  },
  pillBtn: { borderRadius: 20, borderWidth: 1.5, borderColor: C.green, paddingHorizontal: 24, paddingVertical: 10 },
  pillBtnText: { fontSize: 15, fontWeight: "700", color: C.green },

  card: { backgroundColor: C.surface, borderRadius: 16, padding: 16, gap: 12 },
  statsRow: { flexDirection: "row" },
  stat: { flex: 1, alignItems: "center", gap: 6 },
  statNum: { fontSize: 26, fontWeight: "800", color: C.textPrimary, fontVariant: ["tabular-nums"] },
  statLabel: { fontSize: 12, color: C.textSecondary },
  reasonRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  reasonLabel: { width: 120, fontSize: 14, color: C.textPrimary },
  reasonBarTrack: { flex: 1, flexDirection: "row", height: 8, borderRadius: 4, backgroundColor: C.surfaceHigh, overflow: "hidden" },
  reasonBar: { backgroundColor: C.red, borderRadius: 4 },
  reasonCount: { width: 22, textAlign: "right", fontSize: 14, fontWeight: "700", color: C.textPrimary },
  compactRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  compactText: { fontSize: 13, color: C.textSecondary },
  reasonTag: { backgroundColor: C.surfaceHigh, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  reasonTagText: { fontSize: 12, color: C.textSecondary, fontWeight: "600" },
})
