import { C } from "@/utils/theme"
import { ScalePressable } from "@/components/ScalePressable"
import { SessionDetailModal } from "@/components/SessionDetailModal"
import {
  AppUser,
  getAthletes,
  getSessionsByUserId,
  SessionRow,
} from "@/services/BoulderGraphService"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useEffect, useState } from "react"
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { Calendar } from "react-native-calendars"
import { SafeAreaView } from "react-native-safe-area-context"
import { weeklyFrequency, sessionBars, trainingStats } from "@/utils/athleteAnalytics"
import { SessionBarsChart } from "@/components/SessionBarsChart"
import { ADAPTATION_COLOR, ADAPTATION_LABEL } from "@/utils/adaptations"

// ─── Helpers (mirrored from home screen) ─────────────────────────────────────

function getMondayOfWeek(date: Date, weekOffset = 0): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? 6 : day - 1
  d.setDate(d.getDate() - diff + weekOffset * 7)
  d.setHours(0, 0, 0, 0)
  return d
}

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10)
}

function sessionDateStr(session: SessionRow): string {
  try {
    const attempts = JSON.parse(session.attempts)
    if (attempts.length > 0 && attempts[0].timestamp) {
      return new Date(attempts[0].timestamp).toISOString().slice(0, 10)
    }
  } catch {}
  return session.$createdAt.slice(0, 10)
}

function countUniqueDaysInRange(sessions: SessionRow[], start: Date, end: Date): number {
  const s = toDateStr(start)
  const e = toDateStr(end)
  const days = new Set(
    sessions
      .filter((sess) => { const d = sessionDateStr(sess); return d >= s && d <= e })
      .map((sess) => sessionDateStr(sess))
  )
  return days.size
}

function countSessionsInMonth(sessions: SessionRow[], year: number, month: number): number {
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`
  return sessions.filter((s) => sessionDateStr(s).startsWith(prefix)).length
}

function extractSCExercises(sessions: SessionRow[]): string[] {
  const names = new Set<string>()
  for (const session of sessions) {
    let attempts: any[] = []
    try { attempts = JSON.parse(session.attempts) } catch {}
    for (const a of attempts) {
      if (a.type !== "strength_conditioning") continue
      if (a.scData?.exerciseName) {
        names.add(a.scData.exerciseName)
      } else {
        const name = (a.notes ?? "").split(" · ")[0]
        if (name) names.add(name)
      }
    }
  }
  return Array.from(names).sort()
}

// ─── Athlete avatar chip ──────────────────────────────────────────────────────

function AthleteChip({
  athlete,
  selected,
  onPress,
}: {
  athlete: AppUser
  selected: boolean
  onPress: () => void
}) {
  const initial = (athlete.username ?? athlete.$id)[0].toUpperCase()
  return (
    <ScalePressable style={styles.chip} onPress={onPress}>
      <View style={[styles.avatar, selected && styles.avatarSelected]}>
        <Text style={[styles.avatarInitial, selected && styles.avatarInitialSelected]}>
          {initial}
        </Text>
      </View>
      <Text
        style={[styles.chipName, selected && styles.chipNameSelected]}
        numberOfLines={1}
      >
        {athlete.username ?? athlete.$id}
      </Text>
      {selected && <View style={styles.chipDot} />}
    </ScalePressable>
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const router = useRouter()
  // Optional deep-link target: open straight to one athlete (e.g. tapped from
  // the Design hub's athletes strip).
  const params = useLocalSearchParams<{ athleteId?: string }>()

  const [athletes, setAthletes] = useState<AppUser[]>([])
  const [loadingAthletes, setLoadingAthletes] = useState(true)
  const [selectedAthlete, setSelectedAthlete] = useState<AppUser | null>(null)
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  useEffect(() => {
    getAthletes()
      .then(setAthletes)
      .catch(console.error)
      .finally(() => setLoadingAthletes(false))
  }, [])

  // Auto-select the deep-linked athlete once the roster is loaded (or when the
  // target changes from a fresh navigation).
  useEffect(() => {
    if (!params.athleteId || athletes.length === 0) return
    const found = athletes.find((a) => a.$id === params.athleteId)
    if (found && found.$id !== selectedAthlete?.$id) selectAthlete(found)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.athleteId, athletes])

  async function selectAthlete(athlete: AppUser) {
    if (selectedAthlete?.$id === athlete.$id) return
    setSelectedAthlete(athlete)
    setSelectedDate(null)
    setLoadingSessions(true)
    try {
      setSessions(await getSessionsByUserId(athlete.$id))
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingSessions(false)
    }
  }

  // ── Calendar marks ──────────────────────────────────────────────────────────
  const trainedDays: Record<string, any> = {}
  for (const s of sessions) {
    const d = sessionDateStr(s)
    trainedDays[d] = { selected: true, selectedColor: C.green, selectedTextColor: C.bg }
  }

  // ── Stats ───────────────────────────────────────────────────────────────────
  const today = new Date()
  const sessionsThisMonth = countSessionsInMonth(sessions, today.getFullYear(), today.getMonth())
  const weekStart = getMondayOfWeek(today, 0)
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6)
  const lastWeekStart = getMondayOfWeek(today, -1)
  const lastWeekEnd = new Date(lastWeekStart); lastWeekEnd.setDate(lastWeekEnd.getDate() + 6)
  const daysThisWeek = countUniqueDaysInRange(sessions, weekStart, weekEnd)
  const daysLastWeek = countUniqueDaysInRange(sessions, lastWeekStart, lastWeekEnd)
  const scExercises = extractSCExercises(sessions)

  // ── Analytics over the cycle ──────────────────────────────────────────────
  const freqData = weeklyFrequency(sessions)
  const { bars: focusBars, present: focusAdaptations } = sessionBars(sessions)
  const stats = trainingStats(sessions)

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backArrow}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Dashboard</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* ── Athlete picker ─────────────────────────────────────────────────── */}
      <View style={styles.athleteSection}>
        <Text style={styles.athleteSectionLabel}>Athletes</Text>
        {loadingAthletes ? (
          <ActivityIndicator style={{ marginVertical: 12 }} color={C.green} />
        ) : athletes.length === 0 ? (
          <Text style={styles.noAthletes}>No athletes found</Text>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {athletes.map((athlete) => (
              <AthleteChip
                key={athlete.$id}
                athlete={athlete}
                selected={selectedAthlete?.$id === athlete.$id}
                onPress={() => selectAthlete(athlete)}
              />
            ))}
          </ScrollView>
        )}
      </View>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      {!selectedAthlete ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>👆</Text>
          <Text style={styles.emptyTitle}>Pick an athlete</Text>
          <Text style={styles.emptyText}>Their training history will appear here</Text>
        </View>
      ) : loadingSessions ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={C.green} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Calendar */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Training consistency</Text>
            <Calendar
              markedDates={trainedDays}
              maxDate={today.toISOString().slice(0, 10)}
              onDayPress={(day) => {
                if (trainedDays[day.dateString]) setSelectedDate(day.dateString)
              }}
              theme={{
                backgroundColor: C.surface,
                calendarBackground: C.surface,
                selectedDayBackgroundColor: C.green,
                selectedDayTextColor: C.bg,
                todayTextColor: C.green,
                dayTextColor: C.textPrimary,
                textDisabledColor: C.textMuted,
                arrowColor: C.green,
                monthTextColor: C.textPrimary,
                textDayFontWeight: "500",
                textMonthFontWeight: "700",
                textDayHeaderFontWeight: "600",
              }}
              style={styles.calendar}
            />

            {/* Stats row */}
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statNum}>{sessionsThisMonth}</Text>
                <Text style={styles.statLabel}>sessions{"\n"}this month</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statCard}>
                <Text style={styles.statNum}>{daysThisWeek}</Text>
                <Text style={styles.statLabel}>days trained{"\n"}this week</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statCard}>
                <Text style={styles.statNum}>{daysLastWeek}</Text>
                <Text style={styles.statLabel}>days trained{"\n"}last week</Text>
              </View>
            </View>
          </View>

          {/* Frequency over time — one horizontal bar per week */}
          {freqData.length > 1 && (() => {
            const maxCount = Math.max(1, ...freqData.map((b) => b.value))
            return (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Frequency</Text>
                <Text style={styles.sectionSub}>
                  {stats.total} sessions · {stats.avgPerWeek}/week avg
                </Text>
                <View style={styles.freqList}>
                  {freqData.map((b) => (
                    <View key={b.label} style={styles.freqRow}>
                      <Text style={styles.freqLabel}>{b.label}</Text>
                      <View style={styles.freqTrack}>
                        <View style={[styles.freqBar, { width: `${(b.value / maxCount) * 100}%` }]} />
                      </View>
                      <Text style={styles.freqCount}>{b.value}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )
          })()}

          {/* Training focus — one bar per session, split by adaptation */}
          {focusBars.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Training focus</Text>
              <Text style={styles.sectionSub}>Each bar is a session · height = volume</Text>
              <SessionBarsChart
                bars={focusBars}
                onPressBar={(bar) => setSelectedDate(bar.dateStr)}
              />
              <View style={styles.legendRow}>
                {focusAdaptations.map((a) => (
                  <View key={a} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: ADAPTATION_COLOR[a] }]} />
                    <Text style={styles.legendText}>{ADAPTATION_LABEL[a]}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* S/C exercises */}
          {scExercises.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Strength & conditioning</Text>
              <Text style={styles.sectionSub}>Tap an exercise to see progress</Text>
              <View style={styles.exerciseList}>
                {scExercises.map((name, i) => (
                  <Pressable
                    key={name}
                    style={({ pressed }) => [
                      styles.exerciseRow,
                      i === scExercises.length - 1 && { borderBottomWidth: 0 },
                      pressed && { opacity: 0.5 },
                    ]}
                    onPress={() =>
                      router.push({
                        pathname: "/(tabs)/(buttonTabs)/exerciseProgress",
                        params: { name, athleteId: selectedAthlete.$id },
                      })
                    }
                  >
                    <Text style={styles.exerciseName}>{name}</Text>
                    <Text style={styles.exerciseChevron}>›</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* ── Session detail modal ────────────────────────────────────────────── */}
      <SessionDetailModal
        date={selectedDate}
        sessions={sessions}
        onClose={() => setSelectedDate(null)}
        onDeleted={(id) => setSessions((prev) => prev.filter((s) => s.$id !== id))}
        onUpdated={(updated) =>
          setSessions((prev) => prev.map((s) => (s.$id === updated.$id ? updated : s)))
        }
      />
    </SafeAreaView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: { width: 40, justifyContent: "center" },
  backArrow: { fontSize: 34, color: C.textSecondary, lineHeight: 36 },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
    color: C.textPrimary,
  },

  // Athlete picker
  athleteSection: {
    paddingTop: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 4,
  },
  athleteSectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: C.textMuted,
    textTransform: "uppercase",
    letterSpacing: 1,
    paddingHorizontal: 20,
  },
  chipRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  chip: {
    alignItems: "center",
    gap: 6,
    width: 64,
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: C.surfaceHigh,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  avatarSelected: {
    backgroundColor: C.green,
    borderColor: C.green,
  },
  avatarInitial: {
    fontSize: 20,
    fontWeight: "700",
    color: C.textSecondary,
  },
  avatarInitialSelected: {
    color: C.bg,
  },
  chipName: {
    fontSize: 11,
    color: C.textMuted,
    textAlign: "center",
    fontWeight: "500",
  },
  chipNameSelected: {
    color: C.green,
    fontWeight: "700",
  },
  chipDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: C.green,
  },
  noAthletes: {
    fontSize: 14,
    color: C.textMuted,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },

  // Empty state
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 40,
  },
  emptyIcon: { fontSize: 36, marginBottom: 4 },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: C.textPrimary },
  emptyText: { fontSize: 14, color: C.textSecondary, textAlign: "center" },

  // Scroll content
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 16,
  },

  section: {
    backgroundColor: C.surface,
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: C.textPrimary,
  },
  sectionSub: {
    fontSize: 12,
    color: C.textSecondary,
    marginTop: -8,
  },

  // Charts
  freqList: { gap: 6, marginTop: 8 },
  freqRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  freqLabel: { width: 38, fontSize: 11, color: C.textMuted, textAlign: "right" },
  freqTrack: { flex: 1, height: 14, borderRadius: 5, backgroundColor: C.surfaceHigh, overflow: "hidden" },
  freqBar: { height: 14, borderRadius: 5, backgroundColor: C.green, minWidth: 2 },
  freqCount: { width: 20, fontSize: 11, color: C.textSecondary, textAlign: "right" },
  legendRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, color: C.textSecondary },

  // Calendar
  calendar: {
    borderRadius: 12,
    overflow: "hidden",
  },

  // Stats
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surfaceHigh,
    borderRadius: 14,
    paddingVertical: 14,
  },
  statCard: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: C.border,
  },
  statNum: {
    fontSize: 26,
    fontWeight: "800",
    color: C.green,
  },
  statLabel: {
    fontSize: 11,
    color: C.textSecondary,
    textAlign: "center",
    lineHeight: 15,
  },

  // S/C exercises
  exerciseList: {},
  exerciseRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 13,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  exerciseName: {
    fontSize: 15,
    fontWeight: "500",
    color: C.textPrimary,
  },
  exerciseChevron: {
    fontSize: 20,
    color: C.textMuted,
  },
})
