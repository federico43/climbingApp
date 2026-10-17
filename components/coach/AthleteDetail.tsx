import { C } from "@/utils/theme"
import { AthleteVideos } from "@/components/AthleteVideos"
import { PlanTimelineCard } from "@/components/PlanTimelineCard"
import { SessionDetailModal } from "@/components/SessionDetailModal"
import { AthleteCard, useFlashLevel } from "@/components/coach/AthleteCard"
import { HomeworkCard } from "@/components/coach/HomeworkCard"
import { PlanCard } from "@/components/coach/PlanCard"
import { RecentActivityCard } from "@/components/coach/RecentActivityCard"
import { TemplatesCard } from "@/components/coach/TemplatesCard"
import { card } from "@/components/coach/styles"
import {
  AppUser,
  getActiveTrainingPlan,
  getSessionsByUserId,
  listAthleteHomework,
  listPlanWorkouts,
  ProtocolRow,
  SessionRow,
  TrainingPlanRow,
} from "@/services/BoulderGraphService"
import { localDateStr, PLAN_WEEKS, planWeek } from "@/utils/planRotation"
import { Ionicons } from "@expo/vector-icons"
import { useRouter } from "expo-router"
import { useCallback, useEffect, useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"

// One athlete on the coach dashboard (docs/coach-dashboard.md §4.4–4.10).
// `split`: two columns (main + side) on the widest layout, else one.
export function AthleteDetail({
  athlete,
  roster,
  split,
  wide,
  onBack,
  onChanged,
}: {
  athlete: AppUser
  roster: AppUser[]
  split: boolean
  wide: boolean
  onBack?: () => void
  // Homework / plan / sessions changed — the roster's summary is stale.
  onChanged: () => void
}) {
  const router = useRouter()
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [homework, setHomework] = useState<ProtocolRow[]>([])
  const [plan, setPlan] = useState<TrainingPlanRow | null>(null)
  const [loadingPlan, setLoadingPlan] = useState(true)
  const [planWorkouts, setPlanWorkouts] = useState<ProtocolRow[]>([])
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [flashLevel, pickFlashLevel] = useFlashLevel(athlete)

  useEffect(() => {
    let cancelled = false
    setLoadingSessions(true)
    setSessions([])
    setOpenDay(null)
    getSessionsByUserId(athlete.$id)
      .then((rows) => { if (!cancelled) setSessions(rows) })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoadingSessions(false) })
    return () => { cancelled = true }
  }, [athlete.$id])

  // Homework is read through its planPart column — fine to fail quietly.
  const reloadHomework = useCallback(() => {
    listAthleteHomework(athlete.$id).then(setHomework).catch(console.error)
  }, [athlete.$id])
  useEffect(() => {
    let cancelled = false
    setHomework([])
    listAthleteHomework(athlete.$id).then((rows) => { if (!cancelled) setHomework(rows) }).catch(console.error)
    return () => { cancelled = true }
  }, [athlete.$id])

  useEffect(() => {
    let cancelled = false
    setLoadingPlan(true)
    setPlan(null)
    getActiveTrainingPlan(athlete.$id)
      .then((p) => { if (!cancelled) setPlan(p) })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoadingPlan(false) })
    return () => { cancelled = true }
  }, [athlete.$id])

  // Workouts already built from the active plan (incl. split-off S&C ones).
  const planId = plan?.$id
  useEffect(() => {
    let cancelled = false
    setPlanWorkouts([])
    if (!planId) return
    listPlanWorkouts(planId)
      .then((rows) => { if (!cancelled) setPlanWorkouts(rows) })
      .catch(console.error)
    return () => { cancelled = true }
  }, [planId])

  const today = localDateStr(new Date())
  const subtitle = loadingPlan ? " " : !plan ? "No training plan"
    : today < plan.windowStart ? `${plan.name} · starts soon`
      : today > plan.windowEnd ? `${plan.name} · ended`
        : `${plan.name} · week ${Math.min(Math.max(planWeek(plan.windowStart, today), 1), PLAN_WEEKS)} of ${PLAN_WEEKS}`

  const homeworkCard = (
    <HomeworkCard
      homework={homework}
      sessions={sessions}
      onChanged={() => { reloadHomework(); onChanged() }}
    />
  )
  const planCard = (
    <PlanCard
      athlete={athlete}
      plan={plan}
      loading={loadingPlan}
      planWorkouts={planWorkouts}
      sessions={sessions}
      homework={homework}
      flashLevel={flashLevel}
      onPlanChanged={(p) => { setPlan(p); onChanged() }}
      onSessions={setSessions}
      onPlanWorkouts={setPlanWorkouts}
      onHomeworkChanged={() => { reloadHomework(); onChanged() }}
    />
  )
  const timelineCard = plan && <PlanTimelineCard plan={plan} sessions={sessions} homework={homework} planWorkouts={planWorkouts} />
  const activityCard = loadingSessions
    ? <View style={card.card}><ActivityIndicator color={C.green} /></View>
    : <RecentActivityCard sessions={sessions} onOpenDay={setOpenDay} />
  const athleteCard = <AthleteCard athlete={athlete} flashLevel={flashLevel} onPickFlashLevel={pickFlashLevel} />
  const templatesCard = <TemplatesCard athlete={athlete} roster={roster} wide={wide} />
  const videos = <AthleteVideos athlete={athlete} />

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        {onBack && (
          <Pressable onPress={onBack} hitSlop={10} style={styles.back} accessibilityLabel="Back to athletes">
            <Ionicons name="chevron-back" size={24} color={C.textPrimary} />
          </Pressable>
        )}
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(athlete.username || "?")[0].toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{athlete.username || athlete.$id}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
        </View>
        <Pressable
          style={card.outlineBtn}
          accessibilityLabel="Log a session"
          onPress={() => router.push({
            pathname: "/(tabs)/(buttonTabs)/workout-log",
            params: { athleteId: athlete.$id, athleteName: athlete.username },
          })}
        >
          <Ionicons name="checkmark-circle-outline" size={wide ? 15 : 18} color={C.green} />
          {wide && <Text style={card.outlineBtnText}>Log session</Text>}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {split ? (
          <View style={styles.columns}>
            <View style={styles.mainCol}>
              {planCard}
              {timelineCard}
              {templatesCard}
              {videos}
            </View>
            <View style={styles.sideCol}>
              {homeworkCard}
              {activityCard}
              {athleteCard}
            </View>
          </View>
        ) : (
          // One column: homework first — it's the reason to open the screen.
          <>
            {homeworkCard}
            {planCard}
            {timelineCard}
            {activityCard}
            {athleteCard}
            {templatesCard}
            {videos}
          </>
        )}
        <View style={{ height: 32 }} />
      </ScrollView>

      <SessionDetailModal
        date={openDay}
        sessions={sessions}
        onClose={() => setOpenDay(null)}
        onDeleted={(id) => { setSessions((prev) => prev.filter((s) => s.$id !== id)); onChanged() }}
        onUpdated={(updated) => setSessions((prev) => prev.map((s) => (s.$id === updated.$id ? updated : s)))}
        canGiveFeedback
        onOpenExercise={(name) => {
          setOpenDay(null)
          router.push({ pathname: "/(tabs)/(buttonTabs)/exerciseProgress", params: { name, athleteId: athlete.$id } })
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  back: { marginRight: -4 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: C.green, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 18, fontWeight: "800", color: C.bg },
  name: { fontSize: 22, fontWeight: "800", color: C.textPrimary, letterSpacing: -0.3 },
  subtitle: { fontSize: 13, color: C.textSecondary },
  scroll: { paddingHorizontal: 16, paddingTop: 4, gap: 14 },
  columns: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  mainCol: { flex: 1, gap: 14, minWidth: 0 },
  sideCol: { width: 360, gap: 14 },
})
