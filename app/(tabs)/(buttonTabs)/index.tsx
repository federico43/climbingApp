import { C } from "@/utils/theme"
import { ConsumeAuth } from "@/components/auth-context"
import { ScalePressable } from "@/components/ScalePressable"
import Animated, { FadeInDown } from "react-native-reanimated"
import { introAlreadyPlayed, LaunchExtras } from "@/components/LaunchExtras"
import { LatestWorkoutCard, pickLatestWorkout, startWorkout } from "@/components/LatestWorkoutCard"
import { NewSequenceButton } from "@/components/NewSequenceButton"
import { HomeworkSection } from "@/components/HomeworkSection"
import { SettingsButton } from "@/components/SettingsButton"
import { useActivePlan } from "@/contexts/ActivePlanContext"
import { useWorkoutContext } from "@/contexts/WorkoutContext"
import { getUsers, listAthleteTemplates, ProtocolRow } from "@/services/BoulderGraphService"
import { useFocusEffect } from "@react-navigation/native"
import { Redirect, useRouter } from "expo-router"
import { useCallback, useEffect, useState } from "react"
import { LinearGradient } from "expo-linear-gradient"
import { Ionicons } from "@expo/vector-icons"
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

// Home = the most recently built workout, full screen, ready to start.
// Only for athletes without a training plan — with one, the Plan tab is
// home (docs/redesign.md §9). Everything else is in Settings.
export default function HomeScreen() {
  const { plan } = useActivePlan()
  if (plan) return <Redirect href={"/(tabs)/(buttonTabs)/plan" as any} />
  return <HomeContent />
}

function HomeContent() {
  const { User, userName } = ConsumeAuth()
  const router = useRouter()
  const [templates, setTemplates] = useState<ProtocolRow[]>([])
  const [homeWorkoutId, setHomeWorkoutId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Workout state lives in the layout-level provider so the mini bar
  // shows across all tabs.
  const workoutCtx = useWorkoutContext()

  const load = useCallback(async () => {
    try {
      const [rows, me] = await Promise.all([
        listAthleteTemplates(User!.$id, { migrate: false }).catch(() => [] as ProtocolRow[]),
        // Fresh each time: the coach may have picked another workout for Home.
        getUsers(User!.$id).catch(() => null),
      ])
      setTemplates(rows)
      setHomeWorkoutId((me as any)?.homeWorkoutId ?? null)
    } finally {
      setLoading(false)
    }
  }, [User])

  useFocusEffect(
    useCallback(() => {
      if (!User) return
      load()
    }, [User, load])
  )

  // Reload after a workout ends (refreshKey bumps from the provider)
  useEffect(() => {
    if (User && workoutCtx.refreshKey > 0) load()
  }, [User, load, workoutCtx.refreshKey])


  // The workout card mounts only after the launch intro so its entrance is
  // actually visible.
  const [introDone, setIntroDone] = useState(introAlreadyPlayed())
  const { workout, scPart } = pickLatestWorkout(templates, homeWorkoutId)
  const homework = templates.filter((t) => t.planPart === "homework")
  const ready = introDone && !loading

  return (
    <>
      <LinearGradient colors={["#1B2420", "#242325", "#242325"]} style={{ flex: 1 }}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.header}>
          <Text style={styles.greeting} numberOfLines={1}>Hi, {userName}</Text>
          <View style={styles.headerActions}>
            <NewSequenceButton />
            <SettingsButton />
          </View>
        </View>

        {!ready ? (
          introDone ? <ActivityIndicator style={{ marginTop: 60 }} color={C.green} /> : null
        ) : (
          <View style={{ flex: 1 }}>
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
              {homework.length > 0 && (
                <View style={{ marginBottom: 16 }}>
                  <HomeworkSection homework={homework} onStart={(hw) => startWorkout(workoutCtx, hw)} onChanged={load} />
                </View>
              )}
              {workout ? (
                <LatestWorkoutCard workout={workout} scPart={scPart} fill />
              ) : (
                <Animated.View style={styles.emptyCard} entering={FadeInDown.duration(420)}>
                  <Ionicons name="barbell-outline" size={36} color={C.textMuted} />
                  <Text style={styles.emptyTitle}>No workout yet</Text>
                  <Text style={styles.emptyText}>Your coach hasn&apos;t built a workout for you yet.</Text>
                  <Pressable
                    onPress={() => router.push("/(tabs)/(buttonTabs)/workout-library" as any)}
                    hitSlop={8}
                  >
                    <Text style={styles.emptyLink}>Browse the workout library ›</Text>
                  </Pressable>
                </Animated.View>
              )}
            </ScrollView>

            {workout && (
              <View style={styles.startWrap} pointerEvents="box-none">
                <LinearGradient
                  colors={["rgba(36,35,37,0)", "#242325"]}
                  style={styles.startFade}
                  pointerEvents="none"
                />
                <ScalePressable style={styles.startBtn} onPress={() => startWorkout(workoutCtx, workout)}>
                  <Ionicons name="play" size={20} color={C.bg} />
                  <Text style={styles.startBtnText}>Start workout</Text>
                </ScalePressable>
              </View>
            )}
          </View>
        )}
      </SafeAreaView>
      </LinearGradient>

      <LaunchExtras onIntroDone={() => setIntroDone(true)} />
    </>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const START_AREA = 96

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "transparent" },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  greeting: { flexShrink: 1, fontSize: 22, fontWeight: "700", color: C.textPrimary },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 10 },

  scroll: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: START_AREA,
  },

  emptyCard: {
    flexGrow: 1,
    backgroundColor: C.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: C.textPrimary },
  emptyText: { fontSize: 14, color: C.textSecondary, textAlign: "center" },
  emptyLink: { marginTop: 6, fontSize: 14, fontWeight: "600", color: C.green },

  // Start button pinned above the tab bar, over a fade so the list scrolls under it.
  startWrap: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingBottom: 16 },
  startFade: { position: "absolute", left: 0, right: 0, bottom: 0, height: START_AREA + 16 },
  startBtn: {
    height: 58,
    borderRadius: 18,
    backgroundColor: C.green,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  startBtnText: { fontSize: 17, fontWeight: "800", color: C.bg },
})
