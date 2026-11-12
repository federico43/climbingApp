import { Card, CardTitle, DayCircle, IconCircle, MintButton, Mono, SectionHeader, usePaper, usePaperStyles } from "@/components/paper"
import { font, type PaperTheme } from "@/theme/paper/tokens"
import { ConsumeAuth } from "@/components/auth-context"
import { getCardioUser, listCardioSessions, saveCardioPlan, type CardioSessionRow } from "@/services/cardio"
import { syncCardioReminders } from "@/services/cardioReminders"
import {
  canTrainToday, commitPlan, formatTime12, protocolLabel, protocolMinutes, todaySession, weekStatus, WEEKDAY_SHORT,
  type CardioPlan, type DayStatus, type Weekday,
} from "@/utils/cardio"
import { localDateStr } from "@/utils/planRotation"
import { Ionicons } from "@expo/vector-icons"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { useFocusEffect } from "@react-navigation/native"
import { useCallback, useEffect, useState } from "react"
import { Alert, Pressable, StyleSheet, Text, View } from "react-native"
import type { DayState } from "@/components/paper"
import { CardioIntro } from "./CardioIntro"
import { CardioSessionModal } from "./CardioSessionModal"

// Jump rope cardio on the Plan screen (docs/cardio-rope.md). Nothing until
// the coach turns it on for the athlete; then an invite card ("Now you can
// train cardio") that opens the intro; after "I'm in", the plan card with
// this week's days, today's session and Start.

const DISMISS_KEY = "cardio-invite-dismissed-at"
const DISMISS_DAYS = 7

export function CardioSection() {
  const { User } = ConsumeAuth()
  const userId = User?.$id
  const [enabled, setEnabled] = useState(false)
  const [plan, setPlan] = useState<CardioPlan | null>(null)
  const [sessions, setSessions] = useState<CardioSessionRow[]>([])
  const [dismissed, setDismissed] = useState(true)
  const [intro, setIntro] = useState<"off" | "full" | "days">("off")
  const [running, setRunning] = useState(false)
  const t = usePaper()
  const s = usePaperStyles(makeStyles)

  const load = useCallback(async () => {
    if (!userId) return
    try {
      const [u, rows] = await Promise.all([getCardioUser(userId), listCardioSessions(userId).catch(() => [])])
      setEnabled(u.enabled)
      setPlan(u.plan)
      setSessions(rows)
      syncCardioReminders(u.enabled ? u.plan : null, localDateStr(new Date()), rows.map((r) => r.date))
    } catch (e) {
      // Columns not created yet, offline… the section just stays hidden.
      console.log("cardio load failed", e)
    }
  }, [userId])

  useFocusEffect(useCallback(() => { load() }, [load]))

  useEffect(() => {
    AsyncStorage.getItem(DISMISS_KEY).then((v) => {
      setDismissed(!!v && Date.now() - Number(v) < DISMISS_DAYS * 86400000)
    }).catch(() => setDismissed(false))
  }, [])

  if (!userId || !enabled) return null

  async function commit(days: Weekday[], time: string) {
    if (!userId) return
    const next = commitPlan(plan, days, time, new Date().toISOString())
    try {
      await saveCardioPlan(userId, next)
      setPlan(next)
      setIntro("off")
      syncCardioReminders(next, localDateStr(new Date()), sessions.map((r) => r.date))
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof Error ? e.message : "Try again.")
    }
  }

  const committed = !!plan?.committedAt
  // Invite hidden for the week and nothing started: no empty "Cardio" header.
  if (!committed && dismissed) return null

  return (
    <View style={s.group}>
      <SectionHeader style={{ marginTop: 16, marginBottom: 0 }}>Cardio</SectionHeader>

      {committed && plan ? (
        <PlanCard
          plan={plan}
          sessions={sessions}
          onStart={() => setRunning(true)}
          onEdit={() => setIntro("days")}
        />
      ) : !dismissed ? (
        <Pressable style={({ pressed }) => [s.invite, pressed && { opacity: 0.9 }]} onPress={() => setIntro("full")}>
          <IconCircle icon="heart-outline" size={44} />
          <View style={{ flex: 1, gap: 2 }}>
            <CardTitle size={22}>Now you can train cardio</CardTitle>
            <Text style={s.muted}>Start your jump rope plan</Text>
          </View>
          <Pressable
            hitSlop={10}
            accessibilityLabel="Hide for a week"
            onPress={() => { setDismissed(true); AsyncStorage.setItem(DISMISS_KEY, String(Date.now())).catch(() => {}) }}
          >
            <Ionicons name="close" size={18} color={t.ink} />
          </Pressable>
        </Pressable>
      ) : null}

      <CardioIntro
        visible={intro !== "off"}
        daysOnly={intro === "days"}
        initialDays={plan?.days}
        initialTime={plan?.reminderTime}
        hasTest={plan?.state == null && plan?.coachStartStep == null}
        onClose={() => setIntro("off")}
        onCommit={commit}
      />
      {plan && (
        <CardioSessionModal
          visible={running}
          userId={userId}
          plan={plan}
          onClose={() => { setRunning(false); load() }}
          onSaved={setPlan}
        />
      )}
    </View>
  )
}

// Cardio day → the shared timeline circle (docs/design-system.md §5).
const CIRCLE: Record<DayStatus, DayState | null> = {
  done: "trained", today: "today", planned: "upcoming", missed: "past", rest: null,
}

const LEGEND: { st: DayStatus; label: string }[] = [
  { st: "done", label: "Done" },
  { st: "today", label: "Today" },
  { st: "planned", label: "Planned" },
  { st: "missed", label: "Missed" },
]

function PlanCard({ plan, sessions, onStart, onEdit }: {
  plan: CardioPlan; sessions: CardioSessionRow[]; onStart: () => void; onEdit: () => void
}) {
  const t = usePaper()
  const s = usePaperStyles(makeStyles)
  const today = localDateStr(new Date())
  const dates = sessions.map((r) => r.date)
  const week = weekStatus(today, plan.days, dates, plan.committedAt ? localDateStr(new Date(plan.committedAt)) : null)
  // Climbed-hard is only known when the session opens; the card shows the plain protocol.
  const next = todaySession(plan, today, false)
  const can = canTrainToday(today, dates, !!plan.state?.painCap)
  const isTrainingDay = plan.days.includes(((new Date().getDay() + 6) % 7) as Weekday)

  const title = next.kind === "test" ? "Starting test" : protocolLabel(next.protocol)
  const status = !can.ok
    ? can.reason === "doneToday" ? "Done for today" : can.reason === "yesterday" ? "Rest today — you jumped yesterday" : "Week complete"
    : isTrainingDay ? "Today" : "Not a cardio day, but you can go"

  return (
    <Card style={{ gap: 12 }}>
      <View style={s.row}>
        <Mono>{next.kind === "deload" ? `Light week · ${status}` : status}</Mono>
        <Pressable onPress={onEdit} hitSlop={10} accessibilityLabel="Change days and reminder">
          <Ionicons name="pencil" size={16} color={t.ink} />
        </Pressable>
      </View>
      <CardTitle size={30} style={{ marginTop: -4 }}>{title}</CardTitle>
      <Text style={s.muted}>
        {next.kind === "test" ? "About 10 min · finds your starting point" : `About ${protocolMinutes(next.protocol)} min`}
      </Text>
      <View style={s.week}>
        {week.map((st, i) => (
          <View key={i} style={s.dayCol}>
            <Mono size={9.5}>{WEEKDAY_SHORT[i][0]}</Mono>
            {CIRCLE[st] ? <DayCircle state={CIRCLE[st]!} size={28} /> : <View style={{ width: 28, height: 28 }} />}
          </View>
        ))}
      </View>
      <View style={s.legend}>
        {LEGEND.map(({ st, label }) => (
          <View key={st} style={s.legendItem}>
            <DayCircle state={CIRCLE[st]!} size={12} />
            <Mono size={9.5}>{label}</Mono>
          </View>
        ))}
      </View>
      {/* Dev builds can start again the same day, to test the flow quickly. */}
      {(can.ok || __DEV__) && <MintButton label="Start" icon="play" onPress={onStart} />}
      <Mono style={{ textAlign: "center" }}>Reminder at {formatTime12(plan.reminderTime)}</Mono>
    </Card>
  )
}

const makeStyles = (t: PaperTheme) => StyleSheet.create({
  group: { gap: 12 },
  invite: {
    flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: t.card, borderRadius: 26,
    borderWidth: 1, borderColor: t.cardBorder, padding: 18,
  },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  muted: { fontFamily: font.body, fontSize: 13, color: t.textMuted },
  week: { flexDirection: "row", justifyContent: "space-between" },
  dayCol: { alignItems: "center", gap: 6 },
  legend: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap", gap: 14 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
})
