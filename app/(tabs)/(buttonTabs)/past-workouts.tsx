import { C } from "@/utils/theme"
import { ConsumeAuth } from "@/components/auth-context"
import { ScreenGradient } from "@/components/ScreenGradient"
import { SessionDetailModal } from "@/components/SessionDetailModal"
import { SubScreenHeader } from "@/components/SubScreenHeader"
import { useWorkoutContext } from "@/contexts/WorkoutContext"
import { getSessions, SessionRow } from "@/services/BoulderGraphService"
import {
  countSessionsInMonth,
  countUniqueDaysInRange,
  getMondayOfWeek,
  sessionDateStr,
} from "@/utils/sessionDates"
import { useFocusEffect } from "@react-navigation/native"
import { LinearGradient } from "expo-linear-gradient"
import { useCallback, useEffect, useState } from "react"
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
import { Calendar } from "react-native-calendars"
import { SafeAreaView } from "react-native-safe-area-context"

// Settings › Past workouts — training-consistency calendar (tap a trained
// day for its sessions) and weekly / monthly counts. Moved here from Home.
export default function PastWorkoutsScreen() {
  const { User } = ConsumeAuth()
  const workoutCtx = useWorkoutContext()
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  useFocusEffect(
    useCallback(() => {
      if (!User) return
      load()
    }, [User])
  )

  // Reload after a workout ends (refreshKey bumps from the provider)
  useEffect(() => {
    if (User && workoutCtx.refreshKey > 0) load()
  }, [workoutCtx.refreshKey])

  async function load() {
    try {
      setSessions(await getSessions())
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const trainedDays: Record<string, any> = {}
  for (const s of sessions) {
    trainedDays[sessionDateStr(s)] = { marked: true, dotColor: C.textSecondary }
  }

  const today = new Date()
  const sessionsThisMonth = countSessionsInMonth(sessions, today.getFullYear(), today.getMonth())
  const weekStart = getMondayOfWeek(today, 0)
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6)
  const lastWeekStart = getMondayOfWeek(today, -1)
  const lastWeekEnd = new Date(lastWeekStart); lastWeekEnd.setDate(lastWeekEnd.getDate() + 6)
  const daysThisWeek = countUniqueDaysInRange(sessions, weekStart, weekEnd)
  const daysLastWeek = countUniqueDaysInRange(sessions, lastWeekStart, lastWeekEnd)

  return (
    <ScreenGradient>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <SubScreenHeader title="Past workouts" subtitle="Tap a marked day to see its sessions" />

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={C.green} />
        ) : (
          <ScrollView
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={async () => {
                  setRefreshing(true)
                  try { await load() }
                  finally { setRefreshing(false) }
                }}
                tintColor={C.green}
                colors={[C.green]}
              />
            }
          >
            <View style={styles.section}>
              <View style={styles.calendarWrap}>
                <LinearGradient colors={["#1B2420", "#242325", "#242325"]} style={StyleSheet.absoluteFill} />
                <Calendar
                  markedDates={trainedDays}
                  maxDate={today.toISOString().slice(0, 10)}
                  onDayPress={(day) => {
                    if (trainedDays[day.dateString]) setSelectedDate(day.dateString)
                  }}
                  theme={{
                    backgroundColor: "transparent",
                    calendarBackground: "transparent",
                    selectedDayBackgroundColor: C.surfaceHigh,
                    selectedDayTextColor: C.textPrimary,
                    todayTextColor: C.green,
                    dayTextColor: C.textPrimary,
                    textDisabledColor: C.textMuted,
                    arrowColor: C.green,
                    dotColor: C.textSecondary,
                    monthTextColor: C.textPrimary,
                    textDayFontWeight: "500",
                    textMonthFontWeight: "700",
                    textDayHeaderFontWeight: "600",
                  }}
                  style={styles.calendar}
                />
              </View>

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
          </ScrollView>
        )}
      </SafeAreaView>

      <SessionDetailModal
        date={selectedDate}
        sessions={sessions}
        onClose={() => setSelectedDate(null)}
        onDeleted={(id) => setSessions((prev) => prev.filter((s) => s.$id !== id))}
        onUpdated={(updated) => setSessions((prev) => prev.map((s) => (s.$id === updated.$id ? updated : s)))}
      />
    </ScreenGradient>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "transparent" },
  scroll: { paddingHorizontal: 16, paddingBottom: 40 },
  section: { backgroundColor: C.surface, borderRadius: 18, padding: 16, gap: 12 },
  calendarWrap: { borderRadius: 12, overflow: "hidden" },
  calendar: { borderRadius: 12 },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surfaceHigh,
    borderRadius: 14,
    paddingVertical: 14,
  },
  statCard: { flex: 1, alignItems: "center", gap: 4 },
  statDivider: { width: 1, height: 32, backgroundColor: C.border },
  statNum: { fontSize: 26, fontWeight: "800", color: C.green },
  statLabel: { fontSize: 11, color: C.textSecondary, textAlign: "center", lineHeight: 15 },
})
