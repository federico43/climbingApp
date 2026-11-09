import { C } from "@/utils/theme"
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
      <View style={s.groupLabel}>
        <Ionicons name="pulse" size={14} color={C.green} />
        <Text style={s.groupLabelText}>Cardio</Text>
        <View style={s.groupLabelLine} />
      </View>

      {committed && plan ? (
        <PlanCard
          plan={plan}
          sessions={sessions}
          onStart={() => setRunning(true)}
          onEdit={() => setIntro("days")}
        />
      ) : !dismissed ? (
        <Pressable style={({ pressed }) => [s.card, s.invite, pressed && { opacity: 0.9 }]} onPress={() => setIntro("full")}>
          <View style={s.inviteIcon}><Ionicons name="heart-outline" size={26} color={C.green} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.cardTitle}>Now you can train cardio</Text>
            <Text style={s.muted}>Start your jump rope plan</Text>
          </View>
          <Pressable
            hitSlop={10}
            accessibilityLabel="Hide for a week"
            onPress={() => { setDismissed(true); AsyncStorage.setItem(DISMISS_KEY, String(Date.now())).catch(() => {}) }}
          >
            <Ionicons name="close" size={18} color={C.textSecondary} />
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

const DOT: Record<DayStatus, { bg: string; fg: string; border?: string }> = {
  done: { bg: C.green, fg: "#10251A" },
  today: { bg: "transparent", fg: C.green, border: C.green },
  planned: { bg: C.surfaceHigh, fg: C.textPrimary },
  missed: { bg: "transparent", fg: C.textMuted, border: C.surfaceHigh },
  rest: { bg: "transparent", fg: C.textMuted },
}

function PlanCard({ plan, sessions, onStart, onEdit }: {
  plan: CardioPlan; sessions: CardioSessionRow[]; onStart: () => void; onEdit: () => void
}) {
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
    <View style={s.card}>
      <View style={s.row}>
        <Text style={s.kicker}>{next.kind === "deload" ? `Light week · ${status}` : status}</Text>
        <Pressable onPress={onEdit} hitSlop={10} accessibilityLabel="Change days and reminder">
          <Ionicons name="pencil" size={16} color={C.textSecondary} />
        </Pressable>
      </View>
      <Text style={s.title}>{title}</Text>
      {next.kind !== "test" && (
        <Text style={s.muted}>
          About {protocolMinutes(next.protocol)} min · Step {next.step} · Cycle {next.cycle}
        </Text>
      )}
      <View style={s.week}>
        {week.map((st, i) => {
          const d = DOT[st]
          return (
            <View key={i} style={s.dayCol}>
              <Text style={s.dayLabel}>{WEEKDAY_SHORT[i][0]}</Text>
              <View style={[s.dot, { backgroundColor: d.bg, borderColor: d.border ?? "transparent" }]}>
                {st === "done" ? <Ionicons name="checkmark" size={14} color={d.fg} />
                  : st === "missed" ? <Ionicons name="remove" size={14} color={d.fg} /> : null}
              </View>
            </View>
          )
        })}
      </View>
      {/* Dev builds can start again the same day, to test the flow quickly. */}
      {(can.ok || __DEV__) && (
        <Pressable style={({ pressed }) => [s.btn, pressed && { opacity: 0.85 }]} onPress={onStart}>
          <Ionicons name="play" size={16} color="#10251A" />
          <Text style={s.btnText}>Start</Text>
        </Pressable>
      )}
      <Text style={s.small}>Reminder at {formatTime12(plan.reminderTime)}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  group: { gap: 12, marginBottom: 16 },
  groupLabel: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 },
  groupLabelText: { fontSize: 13, fontWeight: "800", color: C.textPrimary, textTransform: "uppercase", letterSpacing: 1 },
  groupLabelLine: { flex: 1, height: 1, backgroundColor: C.border },
  card: { backgroundColor: C.surface, borderRadius: 18, borderWidth: 1, borderColor: C.border, padding: 16, gap: 12 },
  invite: { flexDirection: "row", alignItems: "center", gap: 14 },
  inviteIcon: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(111,207,151,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  cardTitle: { fontSize: 16, fontWeight: "700", color: C.textPrimary },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  kicker: { fontSize: 12, fontWeight: "700", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.8 },
  title: { marginTop: -6, fontSize: 22, fontWeight: "800", color: C.textPrimary, letterSpacing: -0.3 },
  muted: { fontSize: 13, color: C.textSecondary },
  small: { fontSize: 12, color: C.textMuted, textAlign: "center" },
  week: { flexDirection: "row", justifyContent: "space-between" },
  dayCol: { alignItems: "center", gap: 6 },
  dayLabel: { fontSize: 11, fontWeight: "700", color: C.textSecondary },
  dot: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  btn: {
    flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
    backgroundColor: C.green, borderRadius: 24, paddingVertical: 13,
  },
  btnText: { fontSize: 15, fontWeight: "800", color: "#10251A" },
})
