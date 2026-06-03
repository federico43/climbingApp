import { C } from "@/utils/theme"
import CustomButton from "@/components/customButton"
import { PlacedHold } from "@/components/SprayWallBuilder"
import { SprayWallViewer } from "@/components/SprayWallViewer"
import VideoRecorder from "@/components/VideoRecorder"
import type { Attempt } from "@/hooks/WorkoutHook"
import { getSprayRoute, getSprayWall } from "@/services/BoulderGraphService"
import { Ionicons } from "@expo/vector-icons"
import React, { useEffect, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { AnimatedCircularProgress } from "react-native-circular-progress"
import { shared_styles, TopBar } from "@/utils/BlockStyles"
import { saveVideoLocally } from "@/utils/saveVideo"
import {
  parseVariations,
  variationHolds,
  availableVariations,
  VARIATION_LABEL,
  type RouteVariations,
  type VariationKey,
} from "@/utils/sequenceVariations"

const WALL_IMAGE = require("@/assets/images/spraywall.jpg")

type SequencePhase = "intro" | "active" | "recording" | "rest1" | "rest2" | "calibrate" | "review"
type Outcome = "sent" | "fell"

interface Props {
  block: any
  logAttempt: (attempt: Omit<Attempt, "blockIndex" | "type" | "timestamp">) => void
  restTimeRemaining: number | null
  startRestTimer: (duration: number) => void
  attempts: Attempt[]
  goToNextBlock: () => void
  goToPreviousBlock?: () => void
}

export function SequenceBlock({
  block,
  logAttempt,
  restTimeRemaining,
  startRestTimer,
  attempts,
  goToNextBlock,
  goToPreviousBlock,
}: Props) {
  const targetAttempts: number = block.targetAttempts ?? 5
  const restTime: number       = block.restTime ?? 120
  const blockTitle: string     = block.blockName || "Sequence"
  const attemptsDone           = attempts.length

  // Revisiting a block that already met its target lands on the review state
  // (not the logging UI), so attempts are preserved and can't be over-logged.
  const [phase, setPhase]               = useState<SequencePhase>(() =>
    attemptsDone >= targetAttempts ? "review" : "intro"
  )
  const [postRestPhase, setPostRestPhase] = useState<"active" | "review">("active")
  const [pendingVideoUri, setPendingVideoUri] = useState<string | null>(null)
  const [outcome, setOutcome]           = useState<Outcome | null>(null)
  const [highPoint, setHighPoint]       = useState<number>(1)
  const [rpe, setRpe]                   = useState<string>("")
  const [rest1Step, setRest1Step]       = useState<"outcome" | "rpe">("outcome")
  // Never display more than the target (clamps a stray over-log at N/N).
  const displayDone            = Math.min(attemptsDone, targetAttempts)

  // Route variations + which one we're on. The block was authored with a
  // snapshot of routeHolds (the original) at design time, but the route may
  // have been edited since — we re-fetch by routeId on mount for the current
  // variations. We start on the Original; the first-attempt calibration and the
  // manual switcher move between the available variations.
  const [variations, setVariations] = useState<RouteVariations>(() => {
    try { return { original: JSON.parse(block.routeHolds ?? "[]") } } catch { return { original: [] } }
  })
  const [activeVariation, setActiveVariation] = useState<VariationKey>("original")
  const holds: PlacedHold[] = variationHolds(variations, activeVariation)
  const availableVars = availableVariations(variations)

  const [routeName, setRouteName] = useState<string>(block.routeName ?? "")
  const [refreshing, setRefreshing] = useState(false)
  const [wallImageSource, setWallImageSource] = useState<any>(WALL_IMAGE)

  async function applyRouteRow(row: Awaited<ReturnType<typeof getSprayRoute>>) {
    setVariations(parseVariations(row))
    if (row.name) setRouteName(row.name)
    if (row.wallId) {
      const wall = await getSprayWall(row.wallId)
      if (wall?.imageUri) setWallImageSource({ uri: wall.imageUri })
    }
  }

  async function refreshRoute() {
    if (!block.routeId || refreshing) return
    setRefreshing(true)
    try {
      await applyRouteRow(await getSprayRoute(block.routeId))
    } catch { /* keep current */ }
    finally { setRefreshing(false) }
  }

  useEffect(() => {
    if (!block.routeId) return
    let cancelled = false
    getSprayRoute(block.routeId)
      .then((row) => { if (!cancelled) applyRouteRow(row) })
      .catch(() => {/* keep snapshot on failure */})
    return () => { cancelled = true }
  }, [block.routeId])

  const moveCount = holds.filter((h) => h.type === "move").length
  // Move slots, counting "match" holds as two (they show two move numbers).
  const moveSlots = holds.filter((h) => h.type === "move").reduce((s, h) => s + (h.match ? 2 : 1), 0)
  // The reach to the top/finish hold isn't a "move" but you can still fall on
  // it, so add one extra step when the route has a finish hold.
  const hasFinish = holds.some((h) => h.type === "finish")
  const maxMove   = Math.max(1, moveSlots + (hasFinish ? 1 : 0))
  // RPE is only asked on the second and final attempts of the sequence.
  const askRpe    = attemptsDone === 1 || attemptsDone + 1 >= targetAttempts

  useEffect(() => {
    if ((phase === "rest1" || phase === "rest2") && restTimeRemaining === 0) {
      setPhase(postRestPhase)
    }
  }, [phase, restTimeRemaining, postRestPhase])

  function enterRest() {
    const next = attemptsDone + 1
    setPostRestPhase(next >= targetAttempts ? "review" : "active")
    setOutcome(null)
    setHighPoint(1)
    setRpe("")
    setRest1Step("outcome")
    startRestTimer(restTime)
    setPhase("rest1")
  }

  function handleSaveAttempt() {
    const success = outcome === "sent"
    const isFirst = attemptsDone === 0
    logAttempt({
      success,
      video: pendingVideoUri ?? undefined,
      rpe: rpe ? Number(rpe) : undefined,
      highPoint: outcome === "fell" ? highPoint : undefined,
      routeId: block.routeId,
      variation: activeVariation,
    })
    setPendingVideoUri(null)
    // After the very first attempt, calibrate difficulty — but only when there
    // are multiple variations AND more attempts to apply it to.
    const showCalibrate = isFirst && availableVars.length > 1 && targetAttempts > 1
    setPhase(showCalibrate ? "calibrate" : "rest2")
  }

  // ── 1. Intro ──────────────────────────────────────────────────────────────────

  if (phase === "intro") {
    return (
      <View style={shared_styles.screen}>
        <TopBar title={blockTitle} onBack={goToPreviousBlock} hideBorder />

        <ScrollView contentContainerStyle={styles.introContent}>
          <View style={styles.typePill}>
            <Text style={styles.typePillText}>Sequence</Text>
          </View>

          {!!block.description && (
            <Text style={styles.infoCardDesc}>{block.description}</Text>
          )}

          {/* Stats card */}
          <View style={styles.statsCard}>
            {moveCount > 0 && (
              <>
                <View style={styles.statItem}>
                  <Text style={styles.statNum}>{moveCount}</Text>
                  <Text style={styles.statLabel}>moves</Text>
                </View>
                <View style={styles.statDivider} />
              </>
            )}
            <View style={styles.statItem}>
              <Text style={styles.statNum}>{targetAttempts}</Text>
              <Text style={styles.statLabel}>attempts</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNum}>{restTime >= 60 ? `${Math.round(restTime / 60)}m` : `${restTime}s`}</Text>
              <Text style={styles.statLabel}>rest</Text>
            </View>
          </View>

          {/* Route preview */}
          {holds.length > 0 && (
            <View style={styles.previewWrapper}>
              {!!routeName && <Text style={styles.routeLabel}>{routeName}</Text>}
              <View>
                <SprayWallViewer imageSource={wallImageSource} holds={holds} style={styles.previewWall} interactive={false} />
                {!!block.routeId && (
                  <Pressable style={styles.reloadBtn} onPress={refreshRoute} hitSlop={8}>
                    <Ionicons
                      name={refreshing ? "sync" : "refresh"}
                      size={18}
                      color="#fff"
                    />
                  </Pressable>
                )}
              </View>
            </View>
          )}
        </ScrollView>

        {/* Fixed start button */}
        <View style={styles.introFooter}>
          <Pressable style={styles.startBtn} onPress={() => setPhase("active")}>
            <Text style={styles.startBtnText}>Start</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  // ── 2. Active ─────────────────────────────────────────────────────────────────

  if (phase === "active") {
    return (
      <View style={shared_styles.screen}>
        <TopBar
          title={`${blockTitle} · ${displayDone}/${targetAttempts}`}
          onBack={() => setPhase("intro")}
          hideBorder
        />
        <View style={{ flex: 1 }}>
          <SprayWallViewer imageSource={wallImageSource} holds={holds} style={{ flex: 1 }} freeGesture />
          {!!block.routeId && (
            <Pressable style={styles.reloadBtn} onPress={refreshRoute} hitSlop={8}>
              <Ionicons
                name={refreshing ? "sync" : "refresh"}
                size={20}
                color="#fff"
              />
            </Pressable>
          )}
        </View>
        {availableVars.length > 1 && (
          <View style={styles.varSwitchRow}>
            {availableVars.map((k) => (
              <Pressable
                key={k}
                style={[styles.varSwitchChip, activeVariation === k && styles.varSwitchChipActive]}
                onPress={() => setActiveVariation(k)}
              >
                <Text style={[styles.varSwitchText, activeVariation === k && styles.varSwitchTextActive]}>
                  {VARIATION_LABEL[k]}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        <View style={styles.activeControls}>
          <Pressable style={styles.recordBtn} onPress={() => setPhase("recording")}>
            <Text style={styles.recordBtnText}>Record attempt</Text>
          </Pressable>
          <Pressable style={styles.noRecordBtn} onPress={enterRest}>
            <Text style={styles.noRecordBtnText}>Log without video</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  // ── 3. Recording ──────────────────────────────────────────────────────────────

  if (phase === "recording") {
    return (
      <VideoRecorder
        onFinish={async (uri: string) => {
          const saved = await saveVideoLocally(uri, "sequence")
          setPendingVideoUri(saved ?? uri)
          enterRest()
        }}
        onClose={() => setPhase("active")}
      />
    )
  }

  // ── 3b. Calibrate — after the first attempt, preview and pick the variation ───

  if (phase === "calibrate") {
    return (
      <View style={[shared_styles.screen, { backgroundColor: C.bg }]}>
        <View style={styles.calibrateHeader}>
          <Text style={styles.calibrateTitle}>Pick your variation</Text>
          <Text style={styles.calibrateSub}>Preview each one — you can change it anytime.</Text>
        </View>
        <View style={{ flex: 1 }}>
          <SprayWallViewer imageSource={wallImageSource} holds={holds} style={{ flex: 1 }} interactive={false} />
        </View>
        <View style={styles.varSwitchRow}>
          {availableVars.map((k) => (
            <Pressable
              key={k}
              style={[styles.varSwitchChip, activeVariation === k && styles.varSwitchChipActive]}
              onPress={() => setActiveVariation(k)}
            >
              <Text style={[styles.varSwitchText, activeVariation === k && styles.varSwitchTextActive]}>
                {VARIATION_LABEL[k]}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.calibrateFooter}>
          <Pressable style={styles.calibrateContinue} onPress={() => setPhase("rest2")}>
            <Text style={styles.calibrateContinueText}>Continue with {VARIATION_LABEL[activeVariation]}</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  // ── 4. Rest phase 1 — data entry ──────────────────────────────────────────────

  if (phase === "rest1") {
    const timerDisplay = restTimeRemaining != null && restTimeRemaining > 0
      ? `${Math.floor(restTimeRemaining / 60)}:${String(restTimeRemaining % 60).padStart(2, "0")}`
      : "go!"

    // ── Step 1: outcome
    if (rest1Step === "outcome") {
      return (
        <View style={[shared_styles.screen, { backgroundColor: C.bg }]}>
          <View style={styles.rest1Header}>
            <Text style={styles.rest1Question}>How did it go?</Text>
            <View style={styles.pillTimer}>
              <Text style={styles.pillTimerText}>{timerDisplay}</Text>
            </View>
          </View>
          <ScrollView contentContainerStyle={styles.rest1Content}>

            <View style={styles.outcomeRow}>
              {(["sent", "fell"] as Outcome[]).map((o) => (
                <Pressable
                  key={o}
                  style={[
                    styles.outcomeChip,
                    outcome === o && (o === "sent" ? styles.outcomeChipSent : styles.outcomeChipFell),
                  ]}
                  onPress={() => setOutcome(o)}
                >
                  <Text style={[styles.outcomeChipText, outcome === o && styles.outcomeChipTextSelected]}>
                    {o === "sent" ? "Sent" : "Fell"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {outcome === "fell" && (
              <>
                <Text style={styles.sectionLabel}>High point</Text>
                <View style={styles.stepperRow}>
                  <Pressable
                    style={styles.stepperBtn}
                    onPress={() => setHighPoint((p) => Math.max(1, p - 1))}
                  >
                    <Text style={styles.stepperBtnText}>−</Text>
                  </Pressable>
                  <View style={styles.stepperValue}>
                    <Text style={styles.stepperValueText}>
                      {hasFinish && highPoint === maxMove ? "Top" : `Move ${highPoint}`}
                    </Text>
                    <Text style={styles.stepperValueSub}>of {maxMove}</Text>
                  </View>
                  <Pressable
                    style={styles.stepperBtn}
                    onPress={() => setHighPoint((p) => Math.min(maxMove, p + 1))}
                  >
                    <Text style={styles.stepperBtnText}>+</Text>
                  </Pressable>
                </View>
              </>
            )}

          </ScrollView>
          <View style={styles.rest1Footer}>
            <View />
            <Pressable
              style={[styles.rest1NextBtn, !outcome && styles.rest1NextBtnDisabled]}
              onPress={() => { if (!outcome) return; askRpe ? setRest1Step("rpe") : handleSaveAttempt() }}
            >
              <Text style={[styles.rest1NextBtnText, !outcome && styles.rest1NextBtnTextDisabled]}>{askRpe ? "Next" : "Save"}</Text>
            </Pressable>
          </View>
        </View>
      )
    }

    // ── Step 2: RPE
    return (
      <View style={[shared_styles.screen, { backgroundColor: C.bg }]}>
        <View style={styles.rest1Header}>
          <Text style={styles.rest1Question}>How hard was it?</Text>
          <View style={styles.pillTimer}>
            <Text style={styles.pillTimerText}>{timerDisplay}</Text>
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.rest1Content}>

          <Text style={styles.sectionLabel}>RPE</Text>
          <View style={styles.rpeRow}>
            {["6", "7", "8", "9", "10"].map((val) => (
              <Pressable
                key={val}
                style={[styles.rpeChip, rpe === val && styles.rpeChipSelected]}
                onPress={() => setRpe(val)}
              >
                <Text style={[styles.rpeChipText, rpe === val && styles.rpeChipTextSelected]}>
                  {val}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.rpeNote}>Rate this set only — not the whole sequence.</Text>

        </ScrollView>
        <View style={styles.rest1Footer}>
          <Pressable style={[styles.rest1NextBtn, { borderColor: C.border }]} onPress={() => setRest1Step("outcome")}>
            <Text style={[styles.rest1NextBtnText, { color: C.textSecondary }]}>Back</Text>
          </Pressable>
          <Pressable style={[styles.rest1NextBtn, !rpe && styles.rest1NextBtnDisabled]} onPress={handleSaveAttempt}>
            <Text style={[styles.rest1NextBtnText, !rpe && styles.rest1NextBtnTextDisabled]}>Save</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  // ── 5. Rest phase 2 — timer ───────────────────────────────────────────────────

  if (phase === "rest2") {
    const fillPercent = restTimeRemaining != null && restTime
      ? (restTimeRemaining / restTime) * 100
      : 0
    const urgent = (restTimeRemaining ?? 99) <= 15

    return (
      <View style={styles.rest2Container}>
        <View style={styles.rest2Header}>
          <Text style={styles.rest2Label}>{blockTitle}</Text>
          <Text style={styles.rest2Sub}>Rest</Text>
        </View>
        <View style={styles.rest2Circle}>
          <AnimatedCircularProgress
            size={300} width={10} fill={fillPercent}
            tintColor={urgent ? C.red : C.green}
            backgroundColor={C.surface}
            rotation={0}
          >
            {() => {
              const t = restTimeRemaining ?? 0
              const display = t > 0
                ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`
                : "go!"
              return <Text style={styles.timerText}>{display}</Text>
            }}
          </AnimatedCircularProgress>
        </View>
        <View style={styles.rest2Footer}>
          <Pressable style={styles.skipBtn} onPress={() => setPhase("rest1")}>
            <Text style={styles.skipBtnText}>Back</Text>
          </Pressable>
          <Pressable style={styles.skipBtn} onPress={() => setPhase(postRestPhase)}>
            <Text style={styles.skipBtnText}>Skip rest</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  // ── 6. Review ─────────────────────────────────────────────────────────────────

  if (phase === "review") {
    return (
      <View style={shared_styles.screen}>
        <TopBar title="Review" />
        <ScrollView contentContainerStyle={styles.reviewContent}>
          <Text style={shared_styles.title}>
            {attemptsDone} attempt{attemptsDone !== 1 ? "s" : ""}
          </Text>

          {attempts.map((a, i) => (
            <View key={i} style={styles.reviewRow}>
              <View style={styles.reviewRowLeft}>
                <Text style={styles.reviewAttemptNum}>#{i + 1}</Text>
                <View>
                  <Text style={[
                    styles.reviewOutcome,
                    a.success ? styles.reviewSent : styles.reviewFell,
                  ]}>
                    {a.success ? "Sent" : "Fell"}
                  </Text>
                  {!a.success && a.highPoint != null && (
                    <Text style={styles.reviewFellAt}>
                      at move {a.highPoint}{maxMove > 1 ? ` / ${maxMove}` : ""}
                    </Text>
                  )}
                </View>
              </View>
              <View style={styles.reviewRowRight}>
                {a.rpe != null && (
                  <Text style={styles.reviewDetail}>RPE {a.rpe}</Text>
                )}
                {a.video && (
                  <Text style={styles.reviewDetail}>📹</Text>
                )}
              </View>
            </View>
          ))}

          <CustomButton title="Continue" onPress={goToNextBlock} />
        </ScrollView>
      </View>
    )
  }

  return null
}

const styles = StyleSheet.create({
  // ── Intro
  introContent: { padding: 20, gap: 16, paddingBottom: 8 },
  infoCardDesc: { fontSize: 13, color: C.textSecondary, lineHeight: 18 },
  typePill: {
    alignSelf: "flex-start",
    backgroundColor: C.surfaceHigh,
    borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  typePillText: {
    fontSize: 11, fontWeight: "700", color: C.textSecondary,
    textTransform: "uppercase", letterSpacing: 0.6,
  },
  statsCard: {
    flexDirection: "row", backgroundColor: C.surface,
    borderRadius: 16, paddingVertical: 18,
    borderWidth: 1, borderColor: C.border,
  },
  statItem: { flex: 1, alignItems: "center", gap: 4 },
  statNum: { fontSize: 26, fontWeight: "800", color: C.green, fontVariant: ["tabular-nums"] },
  statLabel: { fontSize: 12, color: C.textSecondary },
  statDivider: { width: 1, backgroundColor: C.border, marginVertical: 4 },
  previewWrapper: { gap: 8 },
  routeLabel: { fontSize: 13, fontWeight: "600", color: C.textSecondary },
  previewWall: { height: 300, borderRadius: 14, overflow: "hidden" },
  reloadBtn: {
    position: "absolute", top: 12, right: 12,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center", justifyContent: "center",
  },
  introFooter: {
    backgroundColor: C.bg, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 36,
  },
  startBtn: {
    backgroundColor: C.surfaceHigh, borderRadius: 24,
    paddingVertical: 14, alignItems: "center",
  },
  startBtnText: { color: C.textPrimary, fontSize: 16, fontWeight: "700" },
  rest1Footer: {
    backgroundColor: C.bg, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 36,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  rest1NextBtn: {
    borderRadius: 20, borderWidth: 1.5, borderColor: C.green,
    paddingHorizontal: 28, paddingVertical: 10,
  },
  rest1NextBtnDisabled: { borderColor: C.border },
  rest1NextBtnText: { fontSize: 15, fontWeight: "700", color: C.green },
  rest1NextBtnTextDisabled: { color: C.textMuted },

  // ── Active
  activeControls: {
    backgroundColor: C.bg, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20,
    flexDirection: "row", gap: 10,
  },
  recordBtn: {
    flex: 1, backgroundColor: C.surfaceHigh, borderRadius: 22,
    paddingVertical: 12, alignItems: "center",
  },
  recordBtnText: { color: C.textPrimary, fontSize: 15, fontWeight: "700" },
  noRecordBtn: {
    flex: 1, borderRadius: 22, borderWidth: 1, borderColor: C.border,
    paddingVertical: 12, alignItems: "center",
  },
  noRecordBtnText: { fontSize: 14, fontWeight: "600", color: C.textSecondary },

  // Variation switcher (active phase)
  varSwitchRow: {
    flexDirection: "row", gap: 8, justifyContent: "center",
    backgroundColor: C.bg, paddingHorizontal: 16, paddingTop: 8,
  },
  varSwitchChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  varSwitchChipActive: { backgroundColor: C.green, borderColor: C.green },
  varSwitchText: { fontSize: 13, fontWeight: "700", color: C.textSecondary },
  varSwitchTextActive: { color: C.bg },

  // Calibration screen
  calibrateHeader: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 4, gap: 4 },
  calibrateTitle: { fontSize: 22, fontWeight: "800", color: C.textPrimary },
  calibrateSub: { fontSize: 13, color: C.textSecondary },
  calibrateFooter: {
    backgroundColor: C.bg, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 36,
  },
  calibrateContinue: {
    backgroundColor: C.green, borderRadius: 24, paddingVertical: 14, alignItems: "center",
  },
  calibrateContinueText: { color: C.bg, fontSize: 16, fontWeight: "800" },

  // ── Rest 1
  pillTimer: {
    backgroundColor: C.surface, borderRadius: 30,
    paddingHorizontal: 28, paddingVertical: 10, minWidth: 120, alignItems: "center",
  },
  pillTimerText: { fontSize: 20, fontWeight: "700", color: C.textPrimary },
  rest1Header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 24, paddingTop: 20, paddingBottom: 8,
  },
  rest1Question: {
    fontSize: 26, fontWeight: "700", color: C.textPrimary, flex: 1,
  },
  rest1Content: { padding: 24, gap: 16, flexGrow: 1 },
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
  stepperRow: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: C.surface, borderRadius: 14, overflow: "hidden",
  },
  stepperBtn: {
    width: 56, paddingVertical: 18, alignItems: "center", justifyContent: "center",
  },
  stepperBtnText: { fontSize: 26, fontWeight: "300", color: C.textPrimary },
  stepperValue: { flex: 1, alignItems: "center", gap: 2 },
  stepperValueText: { fontSize: 18, fontWeight: "700", color: C.textPrimary },
  stepperValueSub: { fontSize: 12, color: C.textMuted },
  rpeRow: { flexDirection: "row", gap: 8 },
  rpeChip: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    borderWidth: 1, borderColor: C.border, alignItems: "center",
  },
  rpeChipSelected: { backgroundColor: C.green, borderColor: C.green },
  rpeChipText: { fontSize: 15, fontWeight: "600", color: C.textSecondary },
  rpeChipTextSelected: { color: C.bg },
  rpeNote: { fontSize: 12, color: C.textMuted, fontStyle: "italic" },

  // ── Rest 2
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

  // ── Review
  reviewContent: { padding: 20, gap: 10 },
  reviewRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: C.surface, borderRadius: 12, padding: 14,
  },
  reviewRowLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  reviewRowRight: { flexDirection: "row", gap: 10, alignItems: "center" },
  reviewAttemptNum: { fontSize: 13, fontWeight: "600", color: C.textMuted },
  reviewOutcome: { fontSize: 15, fontWeight: "700" },
  reviewSent: { color: C.green },
  reviewFell: { color: C.red },
  reviewDetail: { fontSize: 13, color: C.textSecondary },
  reviewFellAt: { fontSize: 12, color: C.textMuted, marginTop: 2 },
})
