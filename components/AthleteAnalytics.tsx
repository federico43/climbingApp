import { C } from "@/utils/theme"
import { SessionDetailModal } from "@/components/SessionDetailModal"
import { SessionBarsChart } from "@/components/SessionBarsChart"
import { ADAPTATION_COLOR, ADAPTATION_LABEL } from "@/utils/adaptations"
import { sessionBars, trainingStats, weeklyFrequency } from "@/utils/athleteAnalytics"
import { AppUser, getSessionsByUserId, SessionRow } from "@/services/BoulderGraphService"
import { useRouter } from "expo-router"
import { useEffect, useState } from "react"
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native"
import { Calendar } from "react-native-calendars"

// ─── Date helpers ─────────────────────────────────────────────────────────────

function getMondayOfWeek(date: Date, weekOffset = 0): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? 6 : day - 1
  d.setDate(d.getDate() - diff + weekOffset * 7)
  d.setHours(0, 0, 0, 0)
  return d
}
function toDateStr(d: Date) { return d.toISOString().slice(0, 10) }
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
  const s = toDateStr(start), e = toDateStr(end)
  return new Set(
    sessions.filter((x) => { const d = sessionDateStr(x); return d >= s && d <= e }).map(sessionDateStr)
  ).size
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
      if (a.scData?.exerciseName) names.add(a.scData.exerciseName)
      else { const n = (a.notes ?? "").split(" · ")[0]; if (n) names.add(n) }
    }
  }
  return Array.from(names).sort()
}

// ─── Component ────────────────────────────────────────────────────────────────

// Per-athlete training history: calendar + frequency + training-focus bars +
// S/C exercise progress links. Renders bare sections — host provides the scroll.
export function AthleteAnalytics({ athlete }: { athlete: AppUser }) {
  const router = useRouter()
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setSelectedDate(null)
    getSessionsByUserId(athlete.$id)
      .then((s) => { if (!cancelled) setSessions(s) })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [athlete.$id])

  if (loading) return <ActivityIndicator style={{ marginTop: 40 }} color={C.green} />

  const trainedDays: Record<string, any> = {}
  for (const s of sessions) {
    trainedDays[sessionDateStr(s)] = { selected: true, selectedColor: C.green, selectedTextColor: C.bg }
  }

  const today = new Date()
  const sessionsThisMonth = countSessionsInMonth(sessions, today.getFullYear(), today.getMonth())
  const weekStart = getMondayOfWeek(today, 0)
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6)
  const lastWeekStart = getMondayOfWeek(today, -1)
  const lastWeekEnd = new Date(lastWeekStart); lastWeekEnd.setDate(lastWeekEnd.getDate() + 6)
  const daysThisWeek = countUniqueDaysInRange(sessions, weekStart, weekEnd)
  const daysLastWeek = countUniqueDaysInRange(sessions, lastWeekStart, lastWeekEnd)
  const scExercises = extractSCExercises(sessions)

  const freqData = weeklyFrequency(sessions)
  const { bars: focusBars, present: focusAdaptations } = sessionBars(sessions)
  const stats = trainingStats(sessions)
  const maxCount = Math.max(1, ...freqData.map((b) => b.value))

  return (
    <>
      {/* Calendar + consistency */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Training consistency</Text>
        <Calendar
          markedDates={trainedDays}
          maxDate={today.toISOString().slice(0, 10)}
          onDayPress={(day) => { if (trainedDays[day.dateString]) setSelectedDate(day.dateString) }}
          theme={{
            backgroundColor: C.surface, calendarBackground: C.surface,
            selectedDayBackgroundColor: C.green, selectedDayTextColor: C.bg,
            todayTextColor: C.green, dayTextColor: C.textPrimary,
            textDisabledColor: C.textMuted, arrowColor: C.green, monthTextColor: C.textPrimary,
            textDayFontWeight: "500", textMonthFontWeight: "700", textDayHeaderFontWeight: "600",
          }}
          style={styles.calendar}
        />
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

      {/* Frequency */}
      {freqData.length > 1 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Frequency</Text>
          <Text style={styles.sectionSub}>{stats.total} sessions · {stats.avgPerWeek}/week avg</Text>
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
      )}

      {/* Training focus */}
      {focusBars.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Training focus</Text>
          <Text style={styles.sectionSub}>Each bar is a session · width = volume</Text>
          <SessionBarsChart bars={focusBars} onPressBar={(bar) => setSelectedDate(bar.dateStr)} />
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
          <View>
            {scExercises.map((name, i) => (
              <Pressable
                key={name}
                style={({ pressed }) => [
                  styles.exerciseRow,
                  i === scExercises.length - 1 && { borderBottomWidth: 0 },
                  pressed && { opacity: 0.5 },
                ]}
                onPress={() => router.push({
                  pathname: "/(tabs)/(buttonTabs)/exerciseProgress",
                  params: { name, athleteId: athlete.$id },
                })}
              >
                <Text style={styles.exerciseName}>{name}</Text>
                <Text style={styles.exerciseChevron}>›</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <SessionDetailModal
        date={selectedDate}
        sessions={sessions}
        onClose={() => setSelectedDate(null)}
        onDeleted={(id) => setSessions((prev) => prev.filter((s) => s.$id !== id))}
        onUpdated={(updated) => setSessions((prev) => prev.map((s) => (s.$id === updated.$id ? updated : s)))}
      />
    </>
  )
}

const styles = StyleSheet.create({
  section: { backgroundColor: C.surface, borderRadius: 18, padding: 16, gap: 12 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: C.textPrimary },
  sectionSub: { fontSize: 12, color: C.textSecondary, marginTop: -8 },
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
  calendar: { borderRadius: 12, overflow: "hidden" },
  statsRow: { flexDirection: "row", alignItems: "center", backgroundColor: C.surfaceHigh, borderRadius: 14, paddingVertical: 14 },
  statCard: { flex: 1, alignItems: "center", gap: 4 },
  statDivider: { width: 1, height: 32, backgroundColor: C.border },
  statNum: { fontSize: 26, fontWeight: "800", color: C.green },
  statLabel: { fontSize: 11, color: C.textSecondary, textAlign: "center", lineHeight: 15 },
  exerciseRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 13, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  exerciseName: { fontSize: 15, fontWeight: "500", color: C.textPrimary },
  exerciseChevron: { fontSize: 20, color: C.textMuted },
})
