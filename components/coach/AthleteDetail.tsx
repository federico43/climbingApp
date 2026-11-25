import { paperSheet, useC, usePaperScope, useSheet, onInk } from "@/theme/paper/legacy"
import { IconButton, Melt, Mono, PosterHeadline, posterSize } from "@/components/paper"
import { font } from "@/theme/paper/tokens"
import { BoulderLevelOptions } from "@/utils/boulderColours"
import { AthleteWorkoutBuilder } from "@/components/AthleteWorkoutBuilder"
import { AthleteVideos } from "@/components/AthleteVideos"
import { PlanTimelineCard } from "@/components/PlanTimelineCard"
import { SessionDetailModal } from "@/components/SessionDetailModal"
import { AthleteCard, useFlashLevel } from "@/components/coach/AthleteCard"
import { HomeworkCard } from "@/components/coach/HomeworkCard"
import { PlanCard } from "@/components/coach/PlanCard"
import { RecentActivityCard } from "@/components/coach/RecentActivityCard"
import { ActivePill } from "@/components/coach/ActivePill"
import { RolePill } from "@/components/coach/RolePill"
import { StatsCard } from "@/components/coach/StatsCard"
import { useAthleteStats } from "@/hooks/useAthleteStats"
import { TemplatesCard } from "@/components/coach/TemplatesCard"
import { CardioCard } from "./CardioCard"
import { cardSheet } from "@/components/coach/styles"
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
import { addDays, localDateStr, PLAN_WEEKS, planWeek } from "@/utils/planRotation"
import { pauseOn } from "@/utils/planPauses"
import { Ionicons } from "@expo/vector-icons"
import { useRouter } from "expo-router"
import { useCallback, useEffect, useState } from "react"
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native"

type Tab = "overview" | "stats" | "templates" | "videos"
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "stats", label: "Stats" },
  { key: "templates", label: "Templates" },
  { key: "videos", label: "Videos" },
]

const shortDate = (d: string) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })
const todayLabel = () => new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
function daysBetween(from: string, to: string): number {
  let n = 0
  for (let d = from; d < to && n < 400; d = addDays(d, 1)) n++
  return n
}

// One athlete on the coach dashboard (docs/coach-dashboard.md §4.4–4.10).
// `split`: two columns (main + side) on the widest layout, else one.
export function AthleteDetail({
  athlete,
  roster,
  split,
  wide,
  onBack,
  onChanged,
  onRefresh,
  toolbar,
}: {
  athlete: AppUser
  roster: AppUser[]
  split: boolean
  wide: boolean
  onBack?: () => void
  // Homework / plan / sessions changed — the roster's summary is stale.
  onChanged: () => void
  // Pull-to-refresh: the parent reloads this page from the server.
  onRefresh?: () => void
  // Paper: the coach's tool buttons, in the header's top row.
  toolbar?: React.ReactNode
}) {
  const C = useC()
  const P = usePaperScope()
  const { width } = useWindowDimensions()
  const card = useSheet(cardSheet)
  const styles = useSheet(stylesSheet)
  const router = useRouter()
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [homework, setHomework] = useState<ProtocolRow[]>([])
  const [plan, setPlan] = useState<TrainingPlanRow | null>(null)
  const [loadingPlan, setLoadingPlan] = useState(true)
  const [planWorkouts, setPlanWorkouts] = useState<ProtocolRow[]>([])
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [flashLevel, pickFlashLevel] = useFlashLevel(athlete)
  // Header's "New workout": the same builder as Templates' + Add. Bumping
  // the key reloads the Templates card so the new one shows up.
  const [building, setBuilding] = useState(false)
  const [templatesKey, setTemplatesKey] = useState(0)
  // Paper: the page's sections (design chat 2026-11-22). A section mounts
  // the first time it's opened, so Templates and Videos only read Appwrite
  // when the coach looks at them, then stay mounted.
  const [tab, setTab] = useState<Tab>("overview")
  const [seen, setSeen] = useState<Set<Tab>>(() => new Set<Tab>(["overview"]))
  function openTab(t: Tab) {
    setTab(t)
    setSeen((prev) => (prev.has(t) ? prev : new Set(prev).add(t)))
  }

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

  const stats = useAthleteStats({ athlete, plan, sessions, planWorkouts })

  const today = localDateStr(new Date())
  const subtitle = loadingPlan ? " " : !plan ? "No training plan"
    : today < plan.windowStart ? `${plan.name} · starts soon`
      : today > plan.windowEnd ? `${plan.name} · ended`
        : pauseOn(plan.pauses, today) ? `${plan.name} · paused`
          : `${plan.name} · week ${Math.min(Math.max(planWeek(plan.windowStart, today, plan.pauses), 1), PLAN_WEEKS)} of ${PLAN_WEEKS}`

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
      // A created workout also takes Home over: Templates shows it there.
      onHomeworkChanged={() => { reloadHomework(); onChanged(); setTemplatesKey((k) => k + 1) }}
    />
  )
  const timelineCard = plan && (
    <PlanTimelineCard plan={plan} sessions={sessions} homework={homework} squares={!!P} />
  )
  const activityCard = loadingSessions
    ? <View style={card.card}><ActivityIndicator color={C.green} /></View>
    : <RecentActivityCard sessions={sessions} onOpenDay={setOpenDay} />
  const athleteCard = <AthleteCard athlete={athlete} flashLevel={flashLevel} onPickFlashLevel={pickFlashLevel} onHomeworkChanged={() => { reloadHomework(); onChanged() }} />
  const templatesCard = <TemplatesCard key={templatesKey} athlete={athlete} roster={roster} wide={wide} onHomeworkChanged={() => { reloadHomework(); onChanged() }} />
  const statsCard = <StatsCard key={athlete.$id} columns={wide ? 3 : 2} data={stats} />
  const videos = <AthleteVideos athlete={athlete} />
  const cardioCard = <CardioCard key={`cardio-${athlete.$id}`} athlete={athlete} />

  const modals = (
    <>
        <Modal visible={building} transparent animationType="fade" onRequestClose={() => setBuilding(false)}>
          <AthleteWorkoutBuilder
            athlete={athlete}
            roster={roster}
            onClose={() => setBuilding(false)}
            onSaved={() => setTemplatesKey((k) => k + 1)}
          />
        </Modal>

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
    </>
  )

  const refreshControl = onRefresh ? <RefreshControl refreshing={false} onRefresh={onRefresh} tintColor={C.green} colors={[C.green]} /> : undefined

  // Paper Mint page (design chat 2026-11-22): poster header, sticky section
  // tabs, Overview in two columns on the widest layout.
  if (P) {
    const name = (athlete.username || athlete.$id).trim()
    const first = name.split(/\s+/)[0]
    const daysLeft = plan && today >= plan.windowStart && today <= plan.windowEnd ? daysBetween(today, plan.windowEnd) : null
    const flash = BoulderLevelOptions.find((g) => g.value === flashLevel)
    const posterBase = wide ? 132 : 82
    const chips = [
      plan ? `${shortDate(plan.windowStart)} – ${shortDate(plan.windowEnd)}` : null,
      daysLeft !== null ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : null,
      flash ? `Flash · ${flash.label}` : null,
    ].filter(Boolean) as string[]
    const pane = (t: Tab, node: React.ReactNode) => seen.has(t) && (
      <View key={t} style={tab === t ? styles.paneOn : styles.paneOff}>{node}</View>
    )
    return (
      <View style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.pScroll}
          showsVerticalScrollIndicator={false}
          stickyHeaderIndices={[1]}
          refreshControl={refreshControl}
        >
          <View style={styles.pHeader}>
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: "hidden" }]}>
              <Melt top={wide ? 70 : 60} height={wide ? 260 : 210} />
            </View>
            <View style={styles.pTopRow}>
              {onBack && <IconButton icon="chevron-back" onPress={onBack} label="Back to athletes" />}
              <Mono style={{ flex: 1 }} numberOfLines={1}>{`Coach · ${todayLabel()}`}</Mono>
              {toolbar}
            </View>
            <Mono color={P.ink} size={11.5} style={{ marginTop: wide ? 26 : 18 }} numberOfLines={1}>{subtitle.trim() || " "}</Mono>
            <PosterHeadline size={Math.max(48, posterSize(first, posterBase, wide ? 390 : width))} wordPerLine={false} numberOfLines={1} style={{ marginTop: 8 }}>
              {first}
            </PosterHeadline>
            {name !== first && <Text style={styles.pFullName} numberOfLines={1}>{name}</Text>}
            {chips.length > 0 && (
              <View style={styles.pChips}>
                {chips.map((c) => <View key={c} style={styles.pChip}><Text style={styles.pChipText}>{c}</Text></View>)}
              </View>
            )}
            <View style={styles.pActions}>
              <RolePill athlete={athlete} onChanged={onChanged} />
              <ActivePill athlete={athlete} onChanged={onChanged} />
              <View style={{ flex: 1 }} />
              <Pressable style={card.primaryBtn} accessibilityLabel="New workout" onPress={() => setBuilding(true)}>
                <Ionicons name="add" size={17} color={P.onMint} />
                <Text style={card.primaryBtnText}>New workout</Text>
              </Pressable>
            </View>
          </View>

          {/* Sticky section tabs. */}
          <View style={styles.pTabsWrap}>
            <View style={styles.pTabs}>
              {TABS.map((t) => {
                const on = tab === t.key
                return (
                  <Pressable
                    key={t.key}
                    onPress={() => openTab(t.key)}
                    style={[styles.pTab, on && styles.pTabOn]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.pTabText, on && styles.pTabTextOn]}>{t.label}</Text>
                  </Pressable>
                )
              })}
            </View>
          </View>

          <View style={styles.pBody}>
            {pane("overview", split ? (
              <View style={styles.columns}>
                <View style={styles.mainCol}>
                  {planCard}
                  {timelineCard}
                  {activityCard}
                </View>
                <View style={styles.sideCol}>
                  {athleteCard}
                  {homeworkCard}
                  {cardioCard}
                </View>
              </View>
            ) : (
              // One column: homework first — it's the reason to open the screen.
              <View style={styles.stack}>
                {homeworkCard}
                {planCard}
                {timelineCard}
                {athleteCard}
                {cardioCard}
                {activityCard}
              </View>
            ))}
            {pane("stats", statsCard)}
            {pane("templates", templatesCard)}
            {pane("videos", videos)}
          </View>
          <View style={{ height: 40 }} />
        </ScrollView>
        {modals}
      </View>
    )
  }

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
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{athlete.username || athlete.$id}</Text>
            <RolePill athlete={athlete} onChanged={onChanged} />
            <ActivePill athlete={athlete} onChanged={onChanged} />
          </View>
          <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
        </View>
        <Pressable style={[card.primaryBtn, { alignSelf: "center" }]} accessibilityLabel="New workout" onPress={() => setBuilding(true)}>
          <Ionicons name="add" size={wide ? 15 : 18} color={C.bg} />
          <Text style={card.primaryBtnText}>{wide ? "New workout" : "New"}</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}
      >
        {split ? (
          <View style={styles.columns}>
            <View style={styles.mainCol}>
              {planCard}
              {timelineCard}
              {statsCard}
              {templatesCard}
              {videos}
            </View>
            <View style={styles.sideCol}>
              {homeworkCard}
              {activityCard}
              {cardioCard}
              {athleteCard}
            </View>
          </View>
        ) : (
          // One column: homework first — it's the reason to open the screen.
          <>
            {homeworkCard}
            {planCard}
            {timelineCard}
            {statsCard}
            {activityCard}
            {cardioCard}
            {athleteCard}
            {templatesCard}
            {videos}
          </>
        )}
        <View style={{ height: 32 }} />
      </ScrollView>


      {modals}
    </View>
  )
}

const stylesSheet = paperSheet((C, P) => StyleSheet.create({
  // Paper Mint page.
  pScroll: { paddingBottom: 24 },
  pHeader: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 18 },
  pTopRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  pFullName: { fontSize: 18, fontWeight: "800", color: C.textPrimary, marginTop: 6, paddingLeft: 2 },
  pChips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  pChip: {
    borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5,
    backgroundColor: P?.card, borderWidth: 1, borderColor: P?.cardBorder,
  },
  pChipText: { fontFamily: font.mono, fontSize: 11, letterSpacing: 0.5, color: P?.ink },
  pActions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, marginTop: 16 },
  pTabsWrap: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10 },
  pTabs: {
    flexDirection: "row", alignSelf: "flex-start", gap: 2, padding: 5, borderRadius: 999,
    backgroundColor: P?.mode === "dark" ? "rgba(20,17,26,0.92)" : "rgba(251,249,245,0.94)",
    borderWidth: 1, borderColor: P?.cardBorder,
    shadowColor: "#121014", shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 3,
  },
  pTab: { paddingHorizontal: 15, paddingVertical: 8, borderRadius: 999 },
  pTabOn: { backgroundColor: P?.ink },
  pTabText: { fontFamily: font.bold, fontSize: 14, color: P?.ink },
  pTabTextOn: { color: P ? onInk(P) : C.textPrimary },
  pBody: { paddingHorizontal: 16, paddingTop: 4 },
  paneOn: {},
  paneOff: { display: "none" },
  stack: { gap: 14 },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  back: { marginRight: -4 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: C.green, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 18, fontWeight: "800", color: C.bg },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { flexShrink: 1, fontSize: 22, fontWeight: "800", color: C.textPrimary, letterSpacing: -0.3 },
  subtitle: { fontSize: 13, color: C.textSecondary },
  scroll: { paddingHorizontal: 16, paddingTop: 4, gap: 14 },
  columns: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  mainCol: { flex: 1, gap: 14, minWidth: 0 },
  sideCol: { width: 360, gap: 14 },
}))
