import { C } from "@/utils/theme"
import { ConsumeAuth } from "@/components/auth-context"
import { ScalePressable } from "@/components/ScalePressable"
import { HeroIntro } from "@/components/HeroIntro"
import Animated, { FadeInDown } from "react-native-reanimated"
import { SessionDetailModal } from "@/components/SessionDetailModal"
import { DailyCheckInModal } from "@/components/DailyCheckInModal"
import { AthleteCustomizeWorkout } from "@/components/AthleteCustomizeWorkout"
import { CreateSequenceModal } from "@/components/AthleteSequenceCreator"
import { useWorkoutContext } from "@/contexts/WorkoutContext"
import {
  deleteProtocol,
  deleteSprayRoute,
  getCheckinForToday,
  getMySprayRoutes,
  getSessions,
  listAthleteTemplates,
  listProjects,
  markProjectFailed,
  ProtocolRow,
  SessionRow,
  SprayRouteRow,
} from "@/services/BoulderGraphService"
import { useFocusEffect } from "@react-navigation/native"
import { useRouter } from "expo-router"
import { useCallback, useEffect, useState } from "react"
import { LinearGradient } from "expo-linear-gradient"
import { VersionFooter } from "@/components/VersionFooter"
import { Ionicons } from "@expo/vector-icons"
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"
import { Calendar } from "react-native-calendars"
import { SafeAreaView } from "react-native-safe-area-context"

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  // fallback to Appwrite createdAt
  return session.$createdAt.slice(0, 10)
}

function countUniqueDaysInRange(sessions: SessionRow[], start: Date, end: Date): number {
  const s = toDateStr(start)
  const e = toDateStr(end)
  const days = new Set(
    sessions
      .filter((sess) => {
        const d = sessionDateStr(sess)
        return d >= s && d <= e
      })
      .map((sess) => sessionDateStr(sess))
  )
  return days.size
}

function countSessionsInMonth(sessions: SessionRow[], year: number, month: number): number {
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`
  return sessions.filter((s) => sessionDateStr(s).startsWith(prefix)).length
}

// ─── Screen ───────────────────────────────────────────────────────────────────

// Plays the hero intro only on the first Home mount of an app launch.
let heroPlayed = false

export default function HomeScreen() {
  const { User, userName } = ConsumeAuth()
  const router = useRouter()
  const { width } = useWindowDimensions()
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [templates, setTemplates] = useState<ProtocolRow[]>([])
  const [customizing, setCustomizing] = useState<ProtocolRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Athlete-built sequences (self-owned spray-wall routes) — separate from
  // the shared, coach-managed Spray Wall screen.
  const [mySequences, setMySequences] = useState<SprayRouteRow[]>([])
  const [sequenceModal, setSequenceModal] = useState<{ editing: SprayRouteRow | null } | null>(null)


  // Workout state lives in the layout-level provider so the mini bar
  // shows across all tabs.
  const workoutCtx = useWorkoutContext()
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  // Daily readiness check-in — asked once per calendar day, before the rest
  // of Home is usable.
  const [showCheckin, setShowCheckin] = useState(false)

  useFocusEffect(
    useCallback(() => {
      if (!User) return
      load()
    }, [User])
  )

  useEffect(() => {
    if (!User) return
    let cancelled = false
    getCheckinForToday(User.$id).then((row) => {
      if (!cancelled) setShowCheckin(!row)
    })
    return () => { cancelled = true }
  }, [User])

  // Reload after a workout ends (refreshKey bumps from the provider)
  useEffect(() => {
    if (User && workoutCtx.refreshKey > 0) load()
  }, [workoutCtx.refreshKey])

  async function load() {
    setLoading(true)
    try {
      const [sessData, templateRows, projectsData, sequenceRows] = await Promise.all([
        getSessions(),
        listAthleteTemplates(User!.$id, { migrate: false }).catch(() => [] as ProtocolRow[]),
        listProjects().catch(() => [] as Awaited<ReturnType<typeof listProjects>>),
        getMySprayRoutes(User!.$id).catch(() => [] as SprayRouteRow[]),
      ])
      setSessions(sessData)
      setTemplates(templateRows)
      setMySequences(sequenceRows)
      // Auto-fail projects past their deadline
      const todayStr = new Date().toISOString().slice(0, 10)
      const toFail = projectsData.filter((p) => p.status === "active" && p.dueDate < todayStr)
      for (const p of toFail) {
        markProjectFailed(p.$id).catch(console.error)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  // ── Calendar marks ────────────────────────────────────────────────────────────
  const trainedDays: Record<string, any> = {}
  for (const s of sessions) {
    const d = sessionDateStr(s)
    trainedDays[d] = {
      marked: true,
      dotColor: C.textSecondary,
    }
  }

  // ── Consistency stats ─────────────────────────────────────────────────────────
  const today = new Date()
  const sessionsThisMonth = countSessionsInMonth(sessions, today.getFullYear(), today.getMonth())
  const weekStart = getMondayOfWeek(today, 0)
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6)
  const lastWeekStart = getMondayOfWeek(today, -1)
  const lastWeekEnd = new Date(lastWeekStart); lastWeekEnd.setDate(lastWeekEnd.getDate() + 6)
  const daysThisWeek = countUniqueDaysInRange(sessions, weekStart, weekEnd)
  const daysLastWeek = countUniqueDaysInRange(sessions, lastWeekStart, lastWeekEnd)

  // First-launch hero intro. Plays once per app launch (module flag survives tab
  // switches but resets on relaunch). When it finishes, the cards mount and
  // stagger in. The cards mount only after the intro so their entrance is
  // actually visible (it's hidden behind the hero otherwise).
  const [introDone, setIntroDone] = useState(heroPlayed)
  const cardEntering = (i: number) => FadeInDown.duration(420).delay(i * 110)

  // Coach-assigned workouts (start-only) vs. the athlete's own picks from
  // the shared workout library (freely editable/deletable).
  const myWorkouts = templates.filter((t) => t.source !== "library")
  const myLibraryWorkouts = templates.filter((t) => t.source === "library")

  function confirmDeleteLibraryWorkout(p: ProtocolRow) {
    Alert.alert("Delete workout", `Delete "${p.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try {
            await deleteProtocol(p.$id)
            setTemplates((prev) => prev.filter((x) => x.$id !== p.$id))
          } catch (e: any) { Alert.alert("Error", e?.message ?? "Could not delete the workout.") }
        },
      },
    ])
  }

  function openLibraryWorkoutMenu(p: ProtocolRow) {
    Alert.alert(p.name, undefined, [
      { text: "Edit", onPress: () => setCustomizing(p) },
      { text: "Delete", style: "destructive", onPress: () => confirmDeleteLibraryWorkout(p) },
      { text: "Cancel", style: "cancel" },
    ])
  }

  // ── My sequences (athlete-built spray-wall routes) ─────────────────────────

  function tryOutSequence(route: SprayRouteRow) {
    workoutCtx.openWorkout(
      [{
        id: `sequence-${route.$id}`,
        type: "sequence",
        blockName: route.name,
        description: "",
        targetAttempts: 5,
        restTime: 120,
        routeId: route.$id,
        routeName: route.name,
        routeHolds: route.holds,
        startingVariation: "original",
      }],
      route.name,
    )
  }

  function confirmDeleteSequence(route: SprayRouteRow) {
    Alert.alert("Delete sequence", `Delete "${route.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try {
            await deleteSprayRoute(route.$id)
            setMySequences((prev) => prev.filter((r) => r.$id !== route.$id))
          } catch (e: any) { Alert.alert("Error", e?.message ?? "Could not delete the sequence.") }
        },
      },
    ])
  }

  function openSequenceMenu(route: SprayRouteRow) {
    Alert.alert(route.name, undefined, [
      { text: "Edit", onPress: () => setSequenceModal({ editing: route }) },
      { text: "Delete", style: "destructive", onPress: () => confirmDeleteSequence(route) },
      { text: "Cancel", style: "cancel" },
    ])
  }

  return (
    <>
      <LinearGradient colors={["#1B2420", "#242325", "#242325"]} style={{ flex: 1 }}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={{ flex: 1 }}>
        <View style={styles.header}>
          <Text style={styles.greeting}>Hi, {userName}</Text>
          <VersionFooter />
        </View>

        {!introDone || loading ? (
          loading && introDone ? <ActivityIndicator style={{ marginTop: 60 }} /> : null
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
            {/* ── MY WORKOUTS ───────────────────────────────────────────────── */}
            <Animated.View style={styles.section} entering={cardEntering(0)}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>My workouts</Text>
                <Pressable
                  onPress={() => router.push("/(tabs)/(buttonTabs)/workout-library" as any)}
                  hitSlop={8}
                  style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                >
                  <Text style={styles.browseLibraryText}>Browse library</Text>
                  <Text style={styles.browseLibraryArrow}>›</Text>
                </Pressable>
              </View>
              {myWorkouts.length > 0 ? (
                myWorkouts.map((t) => {
                  let blocks: any[] = []
                  try { blocks = JSON.parse(t.blocks) } catch {}
                  return (
                    <ScalePressable
                      key={t.$id}
                      style={styles.workoutCard}
                      onPress={() => workoutCtx.openWorkout(blocks, t.name)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.workoutCardTitle}>{t.name}</Text>
                        <Text style={styles.workoutCardSub}>
                          {blocks.length} block{blocks.length !== 1 ? "s" : ""} · Tap to start
                        </Text>
                      </View>
                      <Text style={styles.workoutCardArrow}>›</Text>
                    </ScalePressable>
                  )
                })
              ) : (
                <View style={styles.workoutCardEmpty}>
                  <Text style={styles.workoutCardEmptyText}>No workouts yet</Text>
                </View>
              )}
            </Animated.View>

            {/* ── MY SEQUENCES (athlete-built spray-wall routes) ──────────────── */}
            <Animated.View style={styles.section} entering={cardEntering(1)}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>My sequences</Text>
                <Pressable
                  onPress={() => setSequenceModal({ editing: null })}
                  hitSlop={8}
                  style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                >
                  <Ionicons name="add" size={16} color={C.green} />
                  <Text style={styles.browseLibraryText}>New sequence</Text>
                </Pressable>
              </View>
              {mySequences.length > 0 ? (
                mySequences.map((route) => (
                  <View key={route.$id} style={styles.workoutCard}>
                    <ScalePressable style={{ flex: 1 }} onPress={() => tryOutSequence(route)}>
                      <Text style={styles.workoutCardTitle}>{route.name}</Text>
                      <Text style={styles.workoutCardSub}>
                        {route.level != null ? `Lvl ${route.level} · ` : ""}Tap to try
                      </Text>
                    </ScalePressable>
                    <Pressable onPress={() => openSequenceMenu(route)} hitSlop={8}>
                      <Ionicons name="ellipsis-vertical" size={18} color={C.textSecondary} />
                    </Pressable>
                  </View>
                ))
              ) : (
                <View style={styles.workoutCardEmpty}>
                  <Text style={styles.workoutCardEmptyText}>No sequences yet — tap "New sequence" to build one</Text>
                </View>
              )}
            </Animated.View>

            {/* ── FROM THE LIBRARY (athlete's own picks, freely editable) ─────── */}
            {myLibraryWorkouts.length > 0 && (
              <Animated.View style={styles.section} entering={cardEntering(2)}>
                <Text style={styles.sectionTitle}>From the library</Text>
                {myLibraryWorkouts.map((t) => {
                  let blocks: any[] = []
                  try { blocks = JSON.parse(t.blocks) } catch {}
                  return (
                    <View key={t.$id} style={styles.workoutCard}>
                      <ScalePressable
                        style={{ flex: 1 }}
                        onPress={() => workoutCtx.openWorkout(blocks, t.name)}
                      >
                        <Text style={styles.workoutCardTitle}>{t.name}</Text>
                        <Text style={styles.workoutCardSub}>
                          {blocks.length} block{blocks.length !== 1 ? "s" : ""} · Tap to start
                        </Text>
                      </ScalePressable>
                      <Pressable onPress={() => openLibraryWorkoutMenu(t)} hitSlop={8}>
                        <Ionicons name="ellipsis-vertical" size={18} color={C.textSecondary} />
                      </Pressable>
                    </View>
                  )
                })}
              </Animated.View>
            )}

            {/* ── MONTHLY CALENDAR ─────────────────────────────────────────── */}
            <Animated.View style={styles.section} entering={cardEntering(3)}>
              <Text style={styles.sectionTitle}>Training consistency</Text>
              <View style={styles.calendarWrap}>
                <LinearGradient
                  colors={["#1B2420", "#242325", "#242325"]}
                  style={StyleSheet.absoluteFill}
                />
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

              {/* ── CONSISTENCY STATS ─────────────────────────────────────── */}
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
            </Animated.View>

            <View style={{ height: 32 }} />
          </ScrollView>
        )}

        {!introDone || loading ? null : (
          <ScalePressable
            style={styles.logFab}
            onPress={() => router.push("/(tabs)/(buttonTabs)/workout-log")}
          >
            <Ionicons name="checkmark" size={28} color={C.bg} />
          </ScalePressable>
        )}
        </View>
      </SafeAreaView>
      </LinearGradient>

      {!introDone && (
        <HeroIntro
          name={userName ?? ""}
          onDone={() => { heroPlayed = true; setIntroDone(true) }}
        />
      )}

      {/* ── DAILY CHECK-IN ──────────────────────────────────────────────────── */}
      <DailyCheckInModal
        visible={introDone && showCheckin}
        onDone={() => setShowCheckin(false)}
        onClose={() => setShowCheckin(false)}
      />

      {/* ── SESSION DETAIL MODAL ────────────────────────────────────────────── */}
      <SessionDetailModal
        date={selectedDate}
        sessions={sessions}
        onClose={() => setSelectedDate(null)}
        onDeleted={(id) => {
          setSessions((prev) => prev.filter((s) => s.$id !== id))
        }}
        onUpdated={(updated) => {
          setSessions((prev) => prev.map((s) => (s.$id === updated.$id ? updated : s)))
        }}
      />


      {/* ── EDIT A LIBRARY-DERIVED WORKOUT ──────────────────────────────────── */}
      {customizing && User && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setCustomizing(null)}>
          <AthleteCustomizeWorkout
            athleteId={User.$id}
            protocol={customizing}
            onClose={() => setCustomizing(null)}
            onSaved={load}
          />
        </Modal>
      )}

      {/* ── CREATE / EDIT A SEQUENCE ────────────────────────────────────────── */}
      {User && (
        <CreateSequenceModal
          visible={sequenceModal !== null}
          athleteId={User.$id}
          editing={sequenceModal?.editing ?? null}
          onClose={() => setSequenceModal(null)}
          onSaved={(route) => {
            setMySequences((prev) => {
              const exists = prev.some((r) => r.$id === route.$id)
              return exists ? prev.map((r) => (r.$id === route.$id ? route : r)) : [route, ...prev]
            })
          }}
        />
      )}

    </>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "transparent" },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  greeting: {
    fontSize: 22,
    fontWeight: "700",
    color: C.textPrimary,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 20,
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
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  browseLibraryText: {
    fontSize: 13,
    fontWeight: "600",
    color: C.green,
  },
  browseLibraryArrow: {
    fontSize: 15,
    fontWeight: "700",
    color: C.green,
  },

  // Workout card — green outline instead of a green fill
  workoutCard: {
    backgroundColor: C.surfaceHigh,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: C.green,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
  },
  workoutCardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: C.textPrimary,
    marginBottom: 4,
  },
  workoutCardSub: {
    fontSize: 13,
    color: C.textSecondary,
  },
  workoutCardArrow: {
    fontSize: 26,
    color: C.green,
    marginLeft: 12,
  },
  workoutCardEmpty: {
    backgroundColor: C.surfaceHigh,
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
  },
  workoutCardEmptyText: {
    fontSize: 14,
    color: C.textMuted,
  },

  // Calendar
  calendarWrap: {
    borderRadius: 12,
    overflow: "hidden",
  },
  calendar: {
    borderRadius: 12,
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
  // Log-workout FAB
  logFab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: C.green,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
})
