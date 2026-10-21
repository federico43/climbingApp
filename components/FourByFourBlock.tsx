import { C } from "@/utils/theme"
import CustomButton from "@/components/customButton"
import { BoulderLevelOptions } from "@/components/ProjectPickerModal"
import { ConsumeAuth } from "@/components/auth-context"
import type { Attempt } from "@/hooks/WorkoutHook"
import { getSessions, getUsers } from "@/services/BoulderGraphService"
import { findBlockRuns } from "@/utils/blockHistory"
import { useBlockTimer } from "@/utils/blockTimer"
import { colourIndex, colourLabel } from "@/utils/boulderColours"
import {
  attemptGrades, authoredGrades, fitGrades, liveStepDown, pendingStepDowns, suggestNextFourByFour,
  type FourByFourSuggestion,
} from "@/utils/progression/fourByFour"
import { FOUR_BY_FOUR_RULES } from "@/utils/progression/profiles"
import AsyncStorage from "@react-native-async-storage/async-storage"
import React, { useEffect, useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { AnimatedCircularProgress } from "react-native-circular-progress"
import { shared_styles, TopBar } from "@/utils/BlockStyles"
import { useNextBlockLabel } from "@/utils/blockNav"

// 4×4 power-endurance protocol: N sets of M boulders, resting between sets.
// Each boulder slot has its own colour (block.boulderGrades); each set logs
// how many boulders were topped plus the slot colours climbed (scData.grades).
//
// Phases: preview (colours) → active (which set) → rest (timer + tops) →
//         …repeat… → review.
//
// Progression (spec §3.3, utils/progression/fourByFour.ts): on a fresh start
// the suggested colours are preloaded with a banner that stays until the
// athlete overrides it by picking one colour for every boulder (the coach
// already approved the colours in the editor, so there's no "planned" option). In session, a fall in
// sets 1–2 lowers one boulder for the remaining sets (liveStepDown).

type Phase = "preview" | "active" | "rest" | "review"

// The "one set = all the boulders, logged once" line shows until the athlete
// has logged their first set on this device (an athlete once logged every
// boulder as if it were a set).
const INTRO_SEEN_KEY = "fourByFour.introSeen"

interface Props {
  block: any
  logAttempt: (attempt: Omit<Attempt, "blockIndex" | "type" | "timestamp">) => void
  restTimeRemaining: number | null
  startRestTimer: (duration: number) => void
  attempts: Attempt[]
  goToNextBlock: () => void
  goToPreviousBlock?: () => void
}

export function FourByFourBlock({
  block,
  logAttempt,
  restTimeRemaining,
  startRestTimer,
  attempts,
  goToNextBlock,
  goToPreviousBlock,
}: Props) {
  const nextLabel = useNextBlockLabel("Continue")
  const sets: number = block.sets ?? 4
  const bouldersPerSet: number = block.bouldersPerSet ?? 4
  const restTime: number = block.restTime ?? 240
  const blockTitle: string = block.blockName || "4×4"
  const attemptsDone = attempts.length
  const isLastSet = attemptsDone + 1 >= sets

  // Revisiting a finished block lands on review. Resuming mid-block (grade
  // already chosen) skips the preview straight to the active set.
  const [phase, setPhase] = useState<Phase>(() =>
    attemptsDone >= sets ? "review" : attemptsDone > 0 ? "active" : "preview"
  )
  // The slot colours being climbed. Resuming → the last logged set's, plus a
  // step-down the log shows was owed (app closed right after a fall); fresh
  // → the coach's colours until the suggestion loads (empty = athlete picks).
  const [grades, setGrades] = useState<string[]>(() => {
    let g = attemptGrades(attempts[attempts.length - 1], bouldersPerSet)
    if (!g) return authoredGrades(block) ?? []
    if (attemptsDone < sets) {
      for (let k = pendingStepDowns(attempts, bouldersPerSet); k > 0; k--) {
        const step = liveStepDown(g)
        if (!step) break
        g = step.grades
      }
    }
    return g
  })
  // Shown on the next set after a live step-down.
  const [stepNotice, setStepNotice] = useState<string | null>(null)
  // True once the athlete chose to pick one colour themselves.
  const [pickOwn, setPickOwn] = useState(false)
  const [tops, setTops] = useState<number>(bouldersPerSet)
  const blockTimer = useBlockTimer()
  const { User } = ConsumeAuth()
  const [showIntro, setShowIntro] = useState(false)
  useEffect(() => {
    AsyncStorage.getItem(INTRO_SEEN_KEY).then((v) => setShowIntro(v !== "1")).catch(() => {})
  }, [])
  const introLine = `One set = all ${bouldersPerSet} boulders, back to back. Log it once, when the whole set is done — not after each boulder.`

  const [suggestion, setSuggestion] = useState<FourByFourSuggestion | null>(null)
  const [suggestionReady, setSuggestionReady] = useState(attemptsDone > 0)
  useEffect(() => {
    if (attemptsDone > 0) return   // not applied on resume
    let cancelled = false
    Promise.all([getSessions(), User?.$id ? getUsers(User.$id) : Promise.resolve(null)])
      .then(([sessions, user]) => {
        if (cancelled) return
        const runs = findBlockRuns(sessions, { type: "four_by_four", blockName: block.blockName, libraryBlockId: block.libraryBlockId })
        const sug = suggestNextFourByFour(runs, {
          bouldersPerSet, flashLevel: (user as any)?.flashLevel, authored: authoredGrades(block),
        })
        if (!sug) return
        setSuggestion(sug)
        setGrades(sug.grades)
      })
      .catch(console.error)
      .finally(() => { if (!cancelled) setSuggestionReady(true) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Override: the athlete picks one colour for every boulder (Start waits
  // for the pick). The banner goes with it.
  function declineSuggestion() {
    setSuggestion(null)
    setGrades([])
    setPickOwn(true)
  }
  const ready = grades.length === bouldersPerSet

  function startSetRest() {
    setTops(bouldersPerSet)
    startRestTimer(restTime)
    setPhase("rest")
  }

  function logSet() {
    // The set is logged as completed; `tops` is the real metric (in scData).
    // `level` = the hardest slot, for anything that reads one colour per attempt.
    const hardest = grades.reduce((a, b) => (colourIndex(b) > colourIndex(a) ? b : a), grades[0])
    const set = attemptsDone + 1
    logAttempt({ success: true, level: hardest, scData: { tops, set, grades } })
    setStepNotice(null)
    if (showIntro) {
      setShowIntro(false)
      AsyncStorage.setItem(INTRO_SEEN_KEY, "1").catch(() => {})
    }
    // Fell in set 1–2 → one boulder one colour easier for the remaining sets.
    if (!isLastSet && tops < bouldersPerSet && set <= FOUR_BY_FOUR_RULES.earlyFallSets) {
      const step = liveStepDown(grades)
      if (step) {
        setGrades(step.grades)
        setStepNotice(`Fell in set ${set} — boulder ${step.slot + 1} is now ${colourLabel(step.grades[step.slot])} for the rest of the sets.`)
      }
    }
    setPhase(isLastSet ? "review" : "active")
  }

  // ── Preview ───────────────────────────────────────────────────────────────
  if (phase === "preview") {
    return (
      <View style={shared_styles.screen}>
        <TopBar title={blockTitle} onBack={goToPreviousBlock} />
        <ScrollView contentContainerStyle={styles.content}>
          {!!block.description && <Text style={styles.desc}>{block.description}</Text>}
          {showIntro && <Text style={styles.intro}>{introLine}</Text>}

          <View style={styles.statsCard}>
            <View style={styles.statItem}><Text style={styles.statNum}>{sets}</Text><Text style={styles.statLabel}>sets</Text></View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}><Text style={styles.statNum}>{bouldersPerSet}</Text><Text style={styles.statLabel}>boulders per set</Text></View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}><Text style={styles.statNum}>{restTime >= 60 ? `${Math.round(restTime / 60)}m` : `${restTime}s`}</Text><Text style={styles.statLabel}>rest</Text></View>
          </View>

          {/* Progression suggestion — stays until the athlete overrides it
              (same persistent pattern as S&C and sequence). */}
          {!!suggestion && (
            <View style={styles.suggestionBanner}>
              <Text style={styles.suggestionBannerLast}>{suggestion.lastTime}</Text>
              <Text style={styles.suggestionBannerText}>{suggestion.note}</Text>
              <Pressable onPress={declineSuggestion} hitSlop={8}>
                <Text style={styles.suggestionDecline}>Choose my own colour</Text>
              </Pressable>
            </View>
          )}

          {!suggestionReady ? (
            <ActivityIndicator color={C.green} />
          ) : (ready && !pickOwn) ? (
            <>
              <Text style={styles.sectionLabel}>Boulders in each set</Text>
              <BoulderList grades={grades} />
            </>
          ) : (
            <>
              {/* No colours set (or the athlete overrode them): one colour for every boulder. */}
              <Text style={styles.sectionLabel}>What grade?</Text>
              <View style={styles.gradeRow}>
                {BoulderLevelOptions.map((g) => {
                  const sel = ready && grades.every((x) => x === g.value)
                  return (
                    <Pressable
                      key={g.value}
                      style={[styles.gradeChip, sel && { backgroundColor: g.color, borderColor: g.color }]}
                      onPress={() => setGrades(fitGrades([g.value], bouldersPerSet) ?? [])}
                    >
                      <View style={[styles.gradeDot, { backgroundColor: g.color }, sel && { backgroundColor: g.on }]} />
                      <Text style={[styles.gradeText, sel && { color: g.on, fontWeight: "700" }]}>{g.label}</Text>
                    </Pressable>
                  )
                })}
              </View>
            </>
          )}
        </ScrollView>
        <View style={styles.footer}>
          <CustomButton title="Start" onPress={() => { blockTimer.start(); setPhase("active") }} disabled={!ready} />
        </View>
      </View>
    )
  }

  // ── Active — which set ──────────────────────────────────────────────────────
  // One button for the whole set: the boulders are a reference list, not
  // things to log one by one.
  if (phase === "active") {
    const setNo = attemptsDone + 1
    return (
      <View style={shared_styles.screen}>
        <TopBar title={blockTitle} />
        <ScrollView contentContainerStyle={styles.activeContent}>
          <Text style={styles.setKicker}>Set {setNo} of {sets}</Text>
          <SetDots done={attemptsDone} total={sets} />
          {showIntro && <Text style={styles.intro}>{introLine}</Text>}
          {ready && (
            <>
              <Text style={styles.sectionLabel}>Climb these {bouldersPerSet}, back to back</Text>
              <BoulderList grades={grades} />
            </>
          )}
          {!!stepNotice && <Text style={styles.stepNotice}>{stepNotice}</Text>}
        </ScrollView>
        <View style={styles.footer}>
          <CustomButton title={`Set done (all ${bouldersPerSet} boulders)`} onPress={startSetRest} />
        </View>
      </View>
    )
  }

  // ── Rest — timer + how many tops ────────────────────────────────────────────
  if (phase === "rest") {
    const fill = restTime ? ((restTimeRemaining ?? 0) / restTime) * 100 : 0
    const urgent = (restTimeRemaining ?? 99) <= 15
    const t = restTimeRemaining ?? 0
    const display = t > 0 ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}` : "go!"
    return (
      <View style={styles.restContainer}>
        <View style={styles.restHeader}>
          <Text style={styles.restTitle}>Set {attemptsDone + 1} of {sets} done</Text>
          <Text style={styles.restSub}>How many of the {bouldersPerSet} boulders did you top?</Text>
        </View>

        <View style={styles.topsRow}>
          <Pressable style={styles.stepBtn} onPress={() => setTops((p) => Math.max(0, p - 1))}>
            <Text style={styles.stepTxt}>−</Text>
          </Pressable>
          <View style={styles.topsValue}>
            <Text style={styles.topsNum}>{tops}</Text>
            <Text style={styles.topsOf}>of {bouldersPerSet}</Text>
          </View>
          <Pressable style={styles.stepBtn} onPress={() => setTops((p) => Math.min(bouldersPerSet, p + 1))}>
            <Text style={styles.stepTxt}>+</Text>
          </Pressable>
        </View>

        <View style={styles.restCircle}>
          <AnimatedCircularProgress
            size={230} width={10} fill={fill}
            tintColor={urgent ? C.red : C.green} backgroundColor={C.surface} rotation={0}
          >
            {() => <Text style={styles.timerText}>{display}</Text>}
          </AnimatedCircularProgress>
        </View>

        <View style={styles.restFooter}>
          <CustomButton title={isLastSet ? "Save set · finish" : `Save set · on to set ${attemptsDone + 2}`} onPress={logSet} />
        </View>
      </View>
    )
  }

  // ── Review ──────────────────────────────────────────────────────────────────
  const totalTops = attempts.reduce((s, a) => s + (a.scData?.tops ?? 0), 0)
  return (
    <View style={shared_styles.screen}>
      <TopBar title="Review" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={shared_styles.title}>{totalTops} tops</Text>
        <Text style={styles.reviewGrade}>{attempts.length} set{attempts.length !== 1 ? "s" : ""}</Text>
        {attempts.map((a, i) => (
          <View key={i} style={styles.reviewRow}>
            <Text style={styles.reviewSet}>Set {i + 1}</Text>
            <View style={styles.reviewDots}>
              {(attemptGrades(a, bouldersPerSet) ?? []).map((g, j) => (
                <View key={j} style={[styles.reviewDot, { backgroundColor: BoulderLevelOptions.find((o) => o.value === g)?.color ?? C.border }]} />
              ))}
            </View>
            <Text style={styles.reviewTops}>{a.scData?.tops ?? 0} / {bouldersPerSet} tops</Text>
          </View>
        ))}
        <View style={{ marginTop: 8 }}>
          <CustomButton title={nextLabel} onPress={goToNextBlock} />
        </View>
      </ScrollView>
    </View>
  )
}

// The boulder slots in climbing order — a plain reference list (colour dot,
// "Boulder n", colour), deliberately not tappable or button-like.
function BoulderList({ grades }: { grades: string[] }) {
  return (
    <View style={styles.boulderList}>
      {grades.map((g, i) => {
        const opt = BoulderLevelOptions.find((o) => o.value === g)
        return (
          <View key={i} style={[styles.boulderRow, i > 0 && styles.boulderRowSep]}>
            <View style={[styles.boulderDot, { backgroundColor: opt?.color ?? C.border }]} />
            <Text style={styles.boulderName}>Boulder {i + 1}</Text>
            <Text style={styles.boulderColour}>{opt?.label ?? g}</Text>
          </View>
        )
      })}
    </View>
  )
}

// Sets done / to go: filled = logged, ringed = this one, faint = to come.
function SetDots({ done, total }: { done: number; total: number }) {
  return (
    <View style={styles.setDots}>
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={[styles.setDot, i < done && styles.setDotDone, i === done && styles.setDotCurrent]} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 16, paddingBottom: 8 },
  desc: { fontSize: 13, color: C.textSecondary, lineHeight: 18 },

  statsCard: {
    flexDirection: "row", backgroundColor: C.surface, borderRadius: 16,
    paddingVertical: 18, borderWidth: 1, borderColor: C.border,
  },
  statItem: { flex: 1, alignItems: "center", gap: 4 },
  statNum: { fontSize: 26, fontWeight: "800", color: C.green, fontVariant: ["tabular-nums"] },
  statLabel: { fontSize: 12, color: C.textSecondary },
  statDivider: { width: 1, backgroundColor: C.border, marginVertical: 4 },

  sectionLabel: {
    fontSize: 12, color: C.textMuted, textTransform: "uppercase",
    letterSpacing: 0.6, marginBottom: -8,
  },
  gradeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  gradeChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  gradeDot: {
    width: 10, height: 10, borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.45)",
  },
  gradeText: { fontSize: 13, fontWeight: "600", color: C.textSecondary },

  footer: { backgroundColor: C.bg, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 36 },

  intro: {
    fontSize: 14, fontWeight: "600", color: C.textPrimary, lineHeight: 20,
    borderLeftWidth: 3, borderLeftColor: C.green, paddingLeft: 10,
  },

  // Active
  activeContent: { padding: 20, gap: 16, paddingBottom: 8 },
  setKicker: { fontSize: 34, fontWeight: "800", color: C.textPrimary, fontVariant: ["tabular-nums"], marginTop: 8 },
  setDots: { flexDirection: "row", gap: 8, marginTop: -6 },
  setDot: { flex: 1, height: 6, borderRadius: 3, backgroundColor: C.surfaceHigh },
  setDotDone: { backgroundColor: C.green },
  setDotCurrent: { backgroundColor: "rgba(111,207,151,0.45)" },
  boulderList: { paddingHorizontal: 4 },
  boulderRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  boulderRowSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border },
  boulderDot: {
    width: 14, height: 14, borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.45)",
  },
  boulderName: { flex: 1, fontSize: 15, color: C.textSecondary, fontVariant: ["tabular-nums"] },
  boulderColour: { fontSize: 15, fontWeight: "600", color: C.textPrimary },

  suggestionBanner: {
    backgroundColor: "rgba(111,207,151,0.12)", borderWidth: 1, borderColor: C.green,
    borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, gap: 6,
  },
  suggestionBannerLast: { fontSize: 12.5, color: C.textSecondary, lineHeight: 17 },
  suggestionBannerText: { fontSize: 12.5, fontWeight: "600", color: C.green, lineHeight: 17 },
  suggestionDecline: { fontSize: 12.5, fontWeight: "600", color: C.textSecondary, textDecorationLine: "underline" },

  // Rest
  restContainer: { flex: 1, backgroundColor: C.bg, paddingTop: 16, paddingBottom: 36, paddingHorizontal: 24 },
  restHeader: { alignItems: "center", gap: 4 },
  restTitle: { fontSize: 22, fontWeight: "700", color: C.textPrimary },
  restSub: { fontSize: 14, color: C.textMuted, textAlign: "center" },
  topsRow: {
    flexDirection: "row", alignItems: "center", marginTop: 20,
    backgroundColor: C.surface, borderRadius: 16, overflow: "hidden",
  },
  stepBtn: { width: 64, paddingVertical: 18, alignItems: "center", justifyContent: "center" },
  stepTxt: { fontSize: 28, fontWeight: "300", color: C.textPrimary },
  topsValue: { flex: 1, alignItems: "center", gap: 2 },
  topsNum: { fontSize: 32, fontWeight: "800", color: C.green, fontVariant: ["tabular-nums"] },
  topsOf: { fontSize: 12, color: C.textMuted },
  restCircle: { flex: 1, alignItems: "center", justifyContent: "center" },
  timerText: { fontSize: 56, fontWeight: "700", color: C.textPrimary },
  restFooter: { width: "100%" },

  // Review
  reviewGrade: { fontSize: 14, color: C.textSecondary, fontWeight: "600", marginTop: -8, marginBottom: 4 },
  reviewRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: C.surface, borderRadius: 12, padding: 14,
  },
  reviewSet: { fontSize: 15, fontWeight: "700", color: C.textPrimary },
  reviewTops: { fontSize: 14, color: C.green, fontWeight: "700" },
  reviewDots: { flex: 1, flexDirection: "row", gap: 4, marginHorizontal: 12 },
  reviewDot: { width: 10, height: 10, borderRadius: 5 },
  stepNotice: { fontSize: 13, fontWeight: "600", color: C.textSecondary },
})
