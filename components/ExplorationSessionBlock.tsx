import CustomButton from "@/components/customButton"
import { BlockNotes } from "@/components/BlockNotes"
import { paperSheet, useC, useSheet } from "@/theme/paper/legacy"
import { account } from "@/components/AppWrite"
import { getBoulderLevels, logRecord } from "@/services/BoulderGraphService"
import { shared_stylesSheet, topBar_stylesSheet, TopBar } from "@/utils/BlockStyles"
import { ID } from "appwrite"
import { useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useNextBlockLabel } from "@/utils/blockNav"
import { WALLS, wallLabel } from "@/utils/routeExploration"
import { useBlockTimerAlert } from "@/hooks/useBlockTimerAlert"

// ─── Types ────────────────────────────────────────────────────────────────────

interface DbLevel {
  $id: string
  label: string
  color: string
  difficulty: number
}

interface ClimbEntry {
  id: string
  levelId: string
  levelLabel: string
  levelColor: string
  levelDifficulty: number
  attempts: number // the go it went on (3 = "3+"); 0 = not sent
  attemptsLabel: string
  wall: string
}

const ATTEMPT_OPTIONS = [
  { label: "Flash", short: "Flash", value: 1 },
  { label: "2nd go", short: "2nd", value: 2 },
  { label: "3+", short: "3+", value: 3 },
  // Not sent (coach 2026-11-10): logged so the flash colour can be read from
  // the test (utils/densityFlash.ts); no points, not in boulders_realizados.
  { label: "Not sent", short: "No", value: 0 },
]

const sent = (c: ClimbEntry) => c.attempts > 0
const climbPoints = (c: ClimbEntry) => (sent(c) ? c.levelDifficulty : 0)

function calcScore(climbs: ClimbEntry[]): number {
  return climbs.reduce((sum, c) => sum + climbPoints(c), 0)
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

// ─── Block ────────────────────────────────────────────────────────────────────

interface Props {
  block: any
  logAttempt: (attempt: { success: boolean; level?: string; notes?: string; wall?: string; tries?: number }) => void
  goToNextBlock: () => void
  goToPreviousBlock?: () => void
}

export function ExplorationSessionBlock({ block, logAttempt, goToNextBlock, goToPreviousBlock }: Props) {
  const C = useC()
  const shared_styles = useSheet(shared_stylesSheet)
  const styles = useSheet(sheet)
  const topBar_styles = useSheet(topBar_stylesSheet)
  const nextLabel = useNextBlockLabel("Continue")
  const timeLimitSeconds = (block?.timeLimit ?? 0) * 60

  const [levels, setLevels] = useState<DbLevel[]>([])
  const [loadingLevels, setLoadingLevels] = useState(true)
  const [climbs, setClimbs] = useState<ClimbEntry[]>([])
  const [selectedLevelId, setSelectedLevelId] = useState<string | null>(null)
  const [selectedAttempts, setSelectedAttempts] = useState(1)
  // The wall (coach 2026-11-10, like Route exploration): kept between climbs.
  const [wall, setWall] = useState<string | null>(null)
  const [phase, setPhase] = useState<"intro" | "active" | "review">("intro")
  const [saving, setSaving] = useState(false)
  const [timeRemaining, setTimeRemaining] = useState<number | null>(
    timeLimitSeconds > 0 ? timeLimitSeconds : null
  )
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerEndRef = useRef<number | null>(null)
  // When the running time limit ends (null when none) — beeps / notifies.
  const [endsAt, setEndsAt] = useState<number | null>(null)
  useBlockTimerAlert(endsAt, block?.blockName || "Exploration session")
  const climbsRef   = useRef<ClimbEntry[]>([])

  // keep ref in sync so the timer callback can access latest climbs
  useEffect(() => { climbsRef.current = climbs }, [climbs])

  useEffect(() => {
    async function load() {
      try {
        const rows = await getBoulderLevels()
        const sorted = (rows as any[])
          .map((r) => ({
            $id: r.$id,
            label: r.label,
            color: r.color,
            difficulty: r.difficulty ?? 0,
          }))
          .sort((a, b) => a.difficulty - b.difficulty)
        setLevels(sorted)
        if (sorted.length > 0) setSelectedLevelId(sorted[0].$id)
      } catch {}
      finally { setLoadingLevels(false) }
    }
    load()
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  function stopTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    setEndsAt(null)
  }

  function startTimer() {
    if (!timeLimitSeconds) return
    timerEndRef.current = Date.now() + timeLimitSeconds * 1000
    setEndsAt(timerEndRef.current)
    setTimeRemaining(timeLimitSeconds)
    timerRef.current = setInterval(() => {
      const remaining = Math.ceil((timerEndRef.current! - Date.now()) / 1000)
      if (remaining <= 0) {
        clearInterval(timerRef.current!)
        timerRef.current = null
        setTimeRemaining(0)
        finishSession(climbsRef.current)
      } else {
        setTimeRemaining(remaining)
      }
    }, 200)
  }

  function addClimb() {
    if (!selectedLevelId || !wall) return
    const level = levels.find((l) => l.$id === selectedLevelId)
    if (!level) return
    const opt = ATTEMPT_OPTIONS.find((o) => o.value === selectedAttempts)!
    setClimbs((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).slice(2),
        levelId: level.$id,
        levelLabel: level.label,
        levelColor: level.color,
        levelDifficulty: level.difficulty,
        attempts: selectedAttempts,
        attemptsLabel: opt.label,
        wall,
      },
    ])
  }

  function removeClimb(id: string) {
    setClimbs((prev) => prev.filter((c) => c.id !== id))
  }

  // Track which climbs have already been committed to the DB / attempts log,
  // so the user can go back from review, add more, and re-finish without
  // duplicating previous writes.
  const committedRef = useRef<Set<string>>(new Set())

  async function finishSession(currentClimbs: ClimbEntry[]) {
    stopTimer()
    // Only commit climbs that weren't already committed in a prior finish
    const newClimbs = currentClimbs.filter((c) => !committedRef.current.has(c.id))
    const newTops = newClimbs.filter(sent)
    setSaving(true)
    try {
      if (newTops.length > 0) {
        const user = await account.get()
        const now = new Date()
        await Promise.all(
          newTops.map((c) =>
            logRecord("boulders_realizados", {
              $id: ID.unique(),
              fecha: now,
              nivelesBoulder: c.levelId,
              attempts: c.attempts,
              userID: String(user.$id),
            })
          )
        )
      }
    } catch {}
    finally { setSaving(false) }

    for (const c of newClimbs) {
      logAttempt({
        success: sent(c), level: c.levelId, notes: `${c.levelLabel} · ${c.attemptsLabel}`,
        wall: c.wall, tries: sent(c) ? c.attempts : 3,
      })
      committedRef.current.add(c.id)
    }
    setPhase("review")
  }

  async function handleFinishSession() {
    if (saving) return
    const hasClimbs = climbs.length > 0
    Alert.alert(
      "Finish session?",
      hasClimbs
        ? `End the session with ${climbs.length} climb${climbs.length !== 1 ? "s" : ""}? You can go back from the summary to add more.`
        : "End the session with no climbs logged?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Finish", onPress: () => finishSession(climbs) },
      ]
    )
  }

  // ── Intro ───────────────────────────────────────────────────────────────────

  if (phase === "intro") {
    const title = block?.blockName || "Boulder Logger"
    const defaultDesc = "Log every boulder you try during this session: the wall, its grade and the go it went on (or not sent). Only tops score.\n\nHave fun!"
    const description = block?.description?.trim() || defaultDesc

    return (
      <View style={shared_styles.screen}>
        <TopBar title={title} onBack={goToPreviousBlock} poster />
        <ScrollView contentContainerStyle={shared_styles.introContent}>
          <BlockNotes text={description} title={block?.description?.trim() ? "Coach notes" : "How it works"} />
          {(block?.timeLimit ?? 0) > 0 && (
            <View style={styles.timeLimitPill}>
              <Text style={styles.timeLimitText}>⏱ {block.timeLimit} min timer</Text>
            </View>
          )}
        </ScrollView>
        <View style={shared_styles.footer}>
          <CustomButton title="Start" onPress={() => { setPhase("active"); if (timeLimitSeconds) startTimer() }} />
        </View>
      </View>
    )
  }

  // ── Review ──────────────────────────────────────────────────────────────────

  if (phase === "review") {
    const score = calcScore(climbs)
    const byLevel = new Map<string, { label: string; color: string; count: number; tried: number; flashes: number; points: number }>()
    for (const c of climbs) {
      if (!byLevel.has(c.levelId)) {
        byLevel.set(c.levelId, { label: c.levelLabel, color: c.levelColor, count: 0, tried: 0, flashes: 0, points: 0 })
      }
      const entry = byLevel.get(c.levelId)!
      entry.tried++
      if (sent(c)) entry.count++
      if (c.attempts === 1) entry.flashes++
      entry.points += climbPoints(c)
    }
    // Per wall: tops of the boulders tried (old climbs have no wall).
    const byWall = WALLS
      .map((w) => {
        const here = climbs.filter((c) => c.wall === w.key)
        return { key: w.key, label: w.label, tried: here.length, tops: here.filter(sent).length, flashes: here.filter((c) => c.attempts === 1).length }
      })
      .filter((w) => w.tried > 0)
    const tops = climbs.filter(sent).length

    return (
      <View style={shared_styles.screen}>
      <TopBar
        title="Session complete"
        onBack={() => setPhase("active")}
      />
      <ScrollView contentContainerStyle={styles.reviewScroll}>

        {/* Score hero */}
        <View style={styles.scoreCard}>
          <Text style={styles.scoreLabel}>Total score</Text>
          <Text style={styles.scoreValue}>{score % 1 === 0 ? score : score.toFixed(1)}</Text>
          <Text style={styles.scoreSub}>{tops} top{tops !== 1 ? "s" : ""} of {climbs.length} tried</Text>
        </View>

        {byLevel.size > 0 && (
          <View style={styles.breakdownCard}>
            <Text style={styles.breakdownTitle}>Breakdown</Text>
            {Array.from(byLevel.values()).map((item) => (
              <View key={item.label} style={styles.breakdownRow}>
                <View style={[styles.levelDot, { backgroundColor: item.color }]} />
                <Text style={styles.breakdownLabel}>{item.label}</Text>
                <Text style={styles.breakdownCount}>
                  {item.flashes} flash · {item.count}/{item.tried} · <Text style={{ fontWeight: "700" }}>{item.points % 1 === 0 ? item.points : item.points.toFixed(1)} pts</Text>
                </Text>
              </View>
            ))}
          </View>
        )}

        {byWall.length > 0 && (
          <View style={styles.breakdownCard}>
            <Text style={styles.breakdownTitle}>By wall</Text>
            {byWall.map((w) => (
              <View key={w.key} style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>{w.label}</Text>
                <Text style={styles.breakdownCount}>{w.flashes} flash · {w.tops}/{w.tried} tops</Text>
              </View>
            ))}
          </View>
        )}

        <Pressable style={[styles.primaryButton, { width: "100%" }]} onPress={goToNextBlock}>
          <Text style={styles.primaryButtonText}>{nextLabel}</Text>
        </Pressable>
      </ScrollView>
      </View>
    )
  }

  // ── Active ──────────────────────────────────────────────────────────────────

  const score = calcScore(climbs)

  return (
    <View style={shared_styles.screen}>
      {/* Active phase top bar — same visual style as TopBar */}
      <View style={topBar_styles.bar}>
        <Pressable
          onPress={() => { stopTimer(); setPhase("intro") }}
          style={{ width: 40, justifyContent: "center" }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={topBar_styles.backText}>←</Text>
        </Pressable>
        <Text style={topBar_styles.title} numberOfLines={1}>
          {block?.blockName || "Boulder Logger"}
        </Text>
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          {timeRemaining !== null && (
            <View style={[styles.timerBadge, timeRemaining <= 60 && styles.timerBadgeUrgent]}>
              <Text style={[styles.timerText, timeRemaining <= 60 && styles.timerTextUrgent]}>
                {formatTime(timeRemaining)}
              </Text>
            </View>
          )}
          {climbs.length > 0 && (
            <View style={styles.scoreBadge}>
              <Text style={styles.scoreBadgeText}>
                {score % 1 === 0 ? score : score.toFixed(1)} pts
              </Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.container}>
      {loadingLevels ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : (
        <>
          {/* Wall selector */}
          <View style={styles.pickerSection}>
            <Text style={styles.pickerLabel}>Wall</Text>
            <View style={styles.chipRow}>
              {WALLS.map((w) => {
                const isSelected = wall === w.key
                return (
                  <Pressable
                    key={w.key}
                    style={[styles.attemptsChip, isSelected && styles.attemptsChipSelected]}
                    onPress={() => setWall(w.key)}
                  >
                    <Text style={[styles.attemptsChipText, isSelected && styles.attemptsChipTextSelected]}>{w.label}</Text>
                  </Pressable>
                )
              })}
            </View>
          </View>

          {/* Grade selector */}
          <View style={styles.pickerSection}>
            <Text style={styles.pickerLabel}>Grade</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {levels.map((level) => {
                const isSelected = selectedLevelId === level.$id
                return (
                  <Pressable
                    key={level.$id}
                    style={[
                      styles.gradeChip,
                      { borderColor: level.color },
                      isSelected && { backgroundColor: level.color },
                    ]}
                    onPress={() => setSelectedLevelId(level.$id)}
                  >
                    <Text style={[styles.gradeChipText, isSelected && styles.gradeChipTextSelected]}>
                      {level.label}
                    </Text>
                  </Pressable>
                )
              })}
            </ScrollView>
          </View>

          {/* Attempts selector */}
          <View style={styles.pickerSection}>
            <Text style={styles.pickerLabel}>Attempts</Text>
            <View style={[styles.chipRow, { flexWrap: "wrap" }]}>
              {ATTEMPT_OPTIONS.map((opt) => {
                const isSelected = selectedAttempts === opt.value
                return (
                  <Pressable
                    key={opt.value}
                    style={[styles.attemptsChip, isSelected && styles.attemptsChipSelected]}
                    onPress={() => setSelectedAttempts(opt.value)}
                  >
                    <Text style={[styles.attemptsChipText, isSelected && styles.attemptsChipTextSelected]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          </View>

          {/* Logged climbs */}
          <ScrollView
            style={styles.climbList}
            contentContainerStyle={styles.climbListContent}
            showsVerticalScrollIndicator={false}
          >
            {climbs.length === 0 ? (
              <Text style={styles.emptyText}>
                {wall ? "Select a grade and tap \"Log climb\" to record your first boulder." : "Pick the wall, then log each boulder you try."}
              </Text>
            ) : (
              [...climbs].reverse().map((c) => (
                <View key={c.id} style={styles.climbRow}>
                  <View style={[styles.climbLevelBar, { backgroundColor: c.levelColor }]} />
                  <Text style={styles.climbLevelText}>{c.levelLabel}{c.wall ? ` · ${wallLabel(c.wall)}` : ""}</Text>
                  <Text style={styles.climbAttemptsText}>{c.attemptsLabel}</Text>
                  <Text style={styles.climbScore}>
                    +{climbPoints(c) % 1 === 0 ? climbPoints(c) : climbPoints(c).toFixed(1)}
                  </Text>
                  <Pressable onPress={() => removeClimb(c.id)} hitSlop={10} style={styles.deleteBtn}>
                    <Text style={styles.deleteBtnText}>✕</Text>
                  </Pressable>
                </View>
              ))
            )}
          </ScrollView>

          {/* Footer: log climb (left, green, fills) + finish pill (right) */}
          <View style={styles.footer}>
            <Pressable
              style={[styles.logBoulderBtn, (!selectedLevelId || !wall) && { opacity: 0.35 }]}
              onPress={addClimb}
              disabled={!selectedLevelId || !wall}
            >
              <Text style={styles.logBoulderBtnText}>+ Log climb</Text>
            </Pressable>
            <Pressable
              style={[styles.finishPill, saving && { opacity: 0.6 }]}
              onPress={handleFinishSession}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color={C.textPrimary} />
              ) : (
                <Text style={styles.finishPillText}>
                  {climbs.length === 0
                    ? "Finish"
                    : `Finish · ${climbs.length} · ${score % 1 === 0 ? score : score.toFixed(1)}pt`}
                </Text>
              )}
            </Pressable>
          </View>
        </>
      )}
      </View>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const sheet = paperSheet((C) => StyleSheet.create({
  container: {
    flex: 1,
    width: "100%",
    paddingHorizontal: 20,
    paddingTop: 8,
  },

  // Badges
  countBadge: {
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  countBadgeText: { color: C.textPrimary, fontSize: 13, fontWeight: "700" },
  scoreBadge: {
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  scoreBadgeText: { color: C.green, fontSize: 13, fontWeight: "700" },
  timerBadge: {
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  timerBadgeUrgent: { backgroundColor: "rgba(219,80,74,0.15)" },
  timerText: { fontSize: 14, fontWeight: "700", color: C.textSecondary, fontVariant: ["tabular-nums"] },
  timerTextUrgent: { color: C.red },

  // Pickers
  pickerSection: { marginBottom: 12, gap: 6 },
  pickerLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: C.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
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

  // Log button
  logButton: {
    backgroundColor: C.surface, borderRadius: 12,
    paddingVertical: 12, alignItems: "center", marginBottom: 14,
  },
  logButtonText: { fontSize: 16, fontWeight: "600", color: C.green },

  // Climb list
  climbList: { flex: 1 },
  climbListContent: { gap: 8, paddingBottom: 8 },
  emptyText: { fontSize: 14, color: C.textMuted, textAlign: "center", paddingTop: 16, lineHeight: 20 },
  climbRow: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: C.surface, borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 12, gap: 10,
  },
  climbLevelBar: { width: 4, height: 28, borderRadius: 2 },
  climbLevelText: { fontSize: 15, fontWeight: "600", color: C.textPrimary, flex: 1 },
  climbAttemptsText: { fontSize: 13, color: C.textSecondary, fontWeight: "500" },
  climbScore: { fontSize: 13, fontWeight: "700", color: C.green },
  deleteBtn: { paddingLeft: 8 },
  deleteBtnText: { fontSize: 14, color: C.textMuted, fontWeight: "600" },

  // Footer
  footer: {
    paddingTop: 10,
    flexDirection: "row", alignItems: "center", gap: 10,
  },
  logBoulderBtn: {
    flex: 1,
    backgroundColor: C.green, borderRadius: 14,
    paddingVertical: 14, alignItems: "center", justifyContent: "center",
  },
  logBoulderBtnText: { fontSize: 15, fontWeight: "700", color: C.onAccent },
  finishPill: {
    borderRadius: 22, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 18, paddingVertical: 11,
    backgroundColor: C.surface,
  },
  finishPillText: { fontSize: 14, fontWeight: "700", color: C.textSecondary, fontVariant: ["tabular-nums"] },
  primaryButton: {
    backgroundColor: C.green, borderRadius: 14,
    paddingVertical: 15, alignItems: "center",
  },
  startButton: {
    backgroundColor: C.green, borderRadius: 14,
    paddingVertical: 15, alignItems: "center",
  },
  startButtonText: { color: C.onAccent, fontSize: 16, fontWeight: "700", padding: 10 },
  primaryButtonText: { color: C.onAccent, fontSize: 16, fontWeight: "700", padding: 10 },

  // Review
  reviewScroll: { flexGrow: 1, padding: 20, alignItems: "center", gap: 12 },
  scoreCard: {
    width: "100%", backgroundColor: C.surface,
    borderRadius: 16, padding: 20, alignItems: "center", gap: 4,
  },
  scoreLabel: { fontSize: 12, fontWeight: "600", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  scoreValue: { fontSize: 64, fontWeight: "800", color: C.yellow, lineHeight: 72, letterSpacing: -2 },
  scoreSub: { fontSize: 14, color: C.textSecondary },
  breakdownCard: {
    width: "100%", backgroundColor: C.surface,
    borderRadius: 14, padding: 16, gap: 10, marginBottom: 8,
  },
  breakdownTitle: {
    fontSize: 13, fontWeight: "700", color: C.textSecondary,
    textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2,
  },
  breakdownRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  levelDot: { width: 12, height: 12, borderRadius: 6 },
  breakdownLabel: { fontSize: 15, fontWeight: "600", flex: 1, color: C.textPrimary },
  breakdownCount: { fontSize: 14, color: C.textSecondary },

  // Timer pill shown on intro when timeLimit > 0
  timeLimitPill: {
    alignSelf: "flex-start",
    backgroundColor: C.surface,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  timeLimitText: { fontSize: 14, fontWeight: "600", color: C.textSecondary },
}))
