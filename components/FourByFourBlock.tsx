import { C } from "@/utils/theme"
import CustomButton from "@/components/customButton"
import { BoulderLevelOptions } from "@/components/ProjectPickerModal"
import type { Attempt } from "@/hooks/WorkoutHook"
import React, { useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { AnimatedCircularProgress } from "react-native-circular-progress"
import { shared_styles, TopBar } from "@/utils/BlockStyles"

// 4×4 endurance protocol: N sets of M boulders at a chosen grade, resting
// between sets. Each set logs how many of the boulders were topped.
//
// Phases: preview (pick grade) → active (which set) → rest (timer + tops) →
//         …repeat… → review.

type Phase = "preview" | "active" | "rest" | "review"

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
  const [grade, setGrade] = useState<string>(() => attempts[0]?.level ?? "")
  const [tops, setTops] = useState<number>(bouldersPerSet)

  function startSetRest() {
    setTops(bouldersPerSet)
    startRestTimer(restTime)
    setPhase("rest")
  }

  function logSet() {
    // The set is logged as completed; `tops` is the real metric (in scData).
    logAttempt({ success: true, level: grade, scData: { tops, set: attemptsDone + 1 } })
    setPhase(isLastSet ? "review" : "active")
  }

  // ── Preview ───────────────────────────────────────────────────────────────
  if (phase === "preview") {
    return (
      <View style={shared_styles.screen}>
        <TopBar title={blockTitle} onBack={goToPreviousBlock} />
        <ScrollView contentContainerStyle={styles.content}>
          {!!block.description && <Text style={styles.desc}>{block.description}</Text>}

          <View style={styles.statsCard}>
            <View style={styles.statItem}><Text style={styles.statNum}>{sets}</Text><Text style={styles.statLabel}>sets</Text></View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}><Text style={styles.statNum}>{bouldersPerSet}</Text><Text style={styles.statLabel}>boulders</Text></View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}><Text style={styles.statNum}>{restTime >= 60 ? `${Math.round(restTime / 60)}m` : `${restTime}s`}</Text><Text style={styles.statLabel}>rest</Text></View>
          </View>

          <Text style={styles.sectionLabel}>What grade?</Text>
          <View style={styles.gradeRow}>
            {BoulderLevelOptions.map((g) => {
              const sel = grade === g.value
              return (
                <Pressable
                  key={g.value}
                  style={[styles.gradeChip, sel && { backgroundColor: g.color, borderColor: g.color }]}
                  onPress={() => setGrade(g.value)}
                >
                  <View style={[styles.gradeDot, { backgroundColor: g.color }, sel && { backgroundColor: g.on }]} />
                  <Text style={[styles.gradeText, sel && { color: g.on, fontWeight: "700" }]}>{g.label}</Text>
                </Pressable>
              )
            })}
          </View>
        </ScrollView>
        <View style={styles.footer}>
          <CustomButton title="Start" onPress={() => setPhase("active")} disabled={!grade} />
        </View>
      </View>
    )
  }

  // ── Active — which set ──────────────────────────────────────────────────────
  if (phase === "active") {
    const gradeOpt = BoulderLevelOptions.find((g) => g.value === grade)
    return (
      <View style={shared_styles.screen}>
        <TopBar title={blockTitle} />
        <View style={[shared_styles.container, { justifyContent: "center", gap: 6 }]}>
          <Text style={styles.setLabel}>Set</Text>
          <Text style={styles.setBig}>
            {attemptsDone + 1}
            <Text style={styles.setOf}> / {sets}</Text>
          </Text>
          {gradeOpt && (
            <View style={[styles.gradePill, { backgroundColor: gradeOpt.color }]}>
              <Text style={[styles.gradePillText, { color: gradeOpt.on }]}>
                {gradeOpt.label} · {bouldersPerSet} boulders
              </Text>
            </View>
          )}
          <View style={{ width: "100%", marginTop: 28 }}>
            <CustomButton title="Done — log tops" onPress={startSetRest} />
          </View>
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
          <Text style={styles.restTitle}>Set {attemptsDone + 1} done</Text>
          <Text style={styles.restSub}>How many tops?</Text>
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
          <CustomButton title={isLastSet ? "Finish" : "Next set"} onPress={logSet} />
        </View>
      </View>
    )
  }

  // ── Review ──────────────────────────────────────────────────────────────────
  const totalTops = attempts.reduce((s, a) => s + (a.scData?.tops ?? 0), 0)
  const gradeOpt = BoulderLevelOptions.find((g) => g.value === (attempts[0]?.level ?? grade))
  return (
    <View style={shared_styles.screen}>
      <TopBar title="Review" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={shared_styles.title}>{totalTops} tops</Text>
        {gradeOpt && (
          <Text style={styles.reviewGrade}>{gradeOpt.label} · {attempts.length} set{attempts.length !== 1 ? "s" : ""}</Text>
        )}
        {attempts.map((a, i) => (
          <View key={i} style={styles.reviewRow}>
            <Text style={styles.reviewSet}>Set {i + 1}</Text>
            <Text style={styles.reviewTops}>{a.scData?.tops ?? 0} / {bouldersPerSet} tops</Text>
          </View>
        ))}
        <View style={{ marginTop: 8 }}>
          <CustomButton title="Continue" onPress={goToNextBlock} />
        </View>
      </ScrollView>
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

  // Active
  setLabel: { fontSize: 14, color: C.textSecondary, textTransform: "uppercase", letterSpacing: 1 },
  setBig: { fontSize: 80, fontWeight: "800", color: C.textPrimary, fontVariant: ["tabular-nums"] },
  setOf: { fontSize: 36, fontWeight: "700", color: C.textMuted },
  gradePill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18, marginTop: 8 },
  gradePillText: { fontSize: 14, fontWeight: "800" },

  // Rest
  restContainer: { flex: 1, backgroundColor: C.bg, paddingTop: 16, paddingBottom: 36, paddingHorizontal: 24 },
  restHeader: { alignItems: "center", gap: 4 },
  restTitle: { fontSize: 22, fontWeight: "700", color: C.textPrimary },
  restSub: { fontSize: 14, color: C.textMuted },
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
})
