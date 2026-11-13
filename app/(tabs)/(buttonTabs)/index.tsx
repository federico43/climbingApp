import { ConsumeAuth } from "@/components/auth-context"
import Animated, { FadeInDown } from "react-native-reanimated"
import { introAlreadyPlayed, LaunchExtras } from "@/components/LaunchExtras"
import { LatestWorkoutCard, pickLatestWorkout, startWorkout } from "@/components/LatestWorkoutCard"
import { NewSequenceButton } from "@/components/NewSequenceButton"
import { HomeworkSection } from "@/components/HomeworkSection"
import { SettingsButton } from "@/components/SettingsButton"
import { useActivePlan } from "@/contexts/ActivePlanContext"
import { Body, Card, CardTitle, GhostButton, Melt, Mono, PaperScreen, PosterHeadline, PrimaryCTA, StickyFooter, usePaper } from "@/components/paper"
import { useWorkoutContext } from "@/contexts/WorkoutContext"
import { getUsers, listAthleteTemplates, ProtocolRow } from "@/services/BoulderGraphService"
import { useFocusEffect } from "@react-navigation/native"
import { Redirect, useRouter } from "expo-router"
import { useCallback, useEffect, useState } from "react"
import { Ionicons } from "@expo/vector-icons"
import {
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native"

// Home = the most recently built workout, full screen, ready to start.
// Only for athletes without a training plan — with one, the Plan tab is
// home (docs/redesign.md §9). Everything else is in Settings.
export default function HomeScreen() {
  const { plan } = useActivePlan()
  if (plan) return <Redirect href={"/(tabs)/(buttonTabs)/plan" as any} />
  return <HomeContent />
}

function HomeContent() {
  const t = usePaper()
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

  // Poster: the workout on screen (Paper Mint §1), its name melting into the card.
  const eyebrow = workout ? "Your next workout" : "Welcome"
  const headline = workout?.name?.trim() || "Training"

  return (
    <>
      <PaperScreen
        bottomPad={workout ? START_AREA + 24 : 48}
        header={
          <View style={styles.header}>
            <Body weight={800} size={24} numberOfLines={1} style={{ flex: 1 }}>
              {userName ? `Hi, ${userName}` : "Home"}
            </Body>
            <View style={styles.headerActions}>
              <NewSequenceButton paper />
              <SettingsButton paper />
            </View>
          </View>
        }
        scrollProps={{
          contentContainerStyle: { flexGrow: 1 },
          refreshControl: (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true)
                try { await load() }
                finally { setRefreshing(false) }
              }}
              tintColor={t.mintDeep}
              colors={[t.mintDeep]}
            />
          ),
        }}
        footer={
          ready && workout ? (
            <StickyFooter>
              <PrimaryCTA label="Start workout" onPress={() => startWorkout(workoutCtx, workout)} />
            </StickyFooter>
          ) : undefined
        }
      >
        {!ready ? (
          introDone ? <ActivityIndicator style={{ marginTop: 60 }} color={t.mintDeep} /> : null
        ) : (
          <>
            <View style={{ marginTop: 20, marginBottom: 40 }}>
              <Melt top={40} />
              <Mono>{eyebrow}</Mono>
              <PosterHeadline style={{ marginTop: 8 }}>{headline}</PosterHeadline>
            </View>
            {homework.length > 0 && (
              <View style={{ marginBottom: 12 }}>
                <HomeworkSection homework={homework} onStart={(hw) => startWorkout(workoutCtx, hw)} onChanged={load} />
              </View>
            )}
            {workout ? (
              <LatestWorkoutCard workout={workout} scPart={scPart} />
            ) : (
              <Animated.View entering={FadeInDown.duration(420)}>
                <Card style={{ alignItems: "center", paddingVertical: 36, gap: 10 }}>
                  <Ionicons name="barbell-outline" size={34} color={t.label} />
                  <CardTitle size={26} style={{ textAlign: "center" }}>No workout yet</CardTitle>
                  <Body muted size={14} style={{ textAlign: "center" }}>
                    Your coach hasn&apos;t built a workout for you yet.
                  </Body>
                  <GhostButton
                    label="Browse the workout library"
                    compact
                    style={{ marginTop: 6 }}
                    onPress={() => router.push("/(tabs)/(buttonTabs)/workout-library" as any)}
                  />
                </Card>
              </Animated.View>
            )}
          </>
        )}
      </PaperScreen>

      <LaunchExtras onIntroDone={() => setIntroDone(true)} />
    </>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const START_AREA = 96

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 12,
  },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 10 },
})
