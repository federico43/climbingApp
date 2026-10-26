import { useAuth } from "@/components/auth-context"
import { FeatureIntro } from "@/components/schedule/FeatureIntro"
import { PlanPicker } from "@/components/schedule/PlanPicker"
import {
  CLASS_HOURS, LOW_SESSIONS, WEEK_DAYS, WeekEntry, athleteWeek, formatTime, mondayOf, weekDates, weekdayOf,
} from "@/utils/classSchedule"
import { pendingPlan, useClassSchedule } from "@/utils/classScheduleStore"
import { planById } from "@/utils/clientPlans"
import { C } from "@/utils/theme"
import { Ionicons } from "@expo/vector-icons"
import { useRouter } from "expo-router"
import { useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

// Top of Plan for athletes: today, sessions left and this week's classes.
// Tapping it opens the week (schedule.tsx).
export function ThisWeekCard() {
  const router = useRouter()
  const { role } = useAuth()
  const st = useClassSchedule()
  const [plans, setPlans] = useState(false)
  if (role === "coach") return null

  const now = new Date()
  const today = weekdayOf(now)
  const dates = weekDates(mondayOf(now))
  const wk = st.thisWeek
  const week = athleteWeek(wk.classes, wk.mine, wk.changes, wk.extra)
  const todays = week.find((e) => e.cls.day === today && e.state === "on")
  const next = week.find((e) => e.cls.day > today && e.state !== "skip")
  const dayLabel = (d: number) => `${WEEK_DAYS[d]} ${dates[d].getDate()}`
  const left = st.pkg?.left ?? 0
  const low = !!st.pkg && left <= LOW_SESSIONS
  const asked = pendingPlan(st)
  // No package, or running out: offer the plans (or show the request sent).
  const offer = st.status === "ready" && (!st.pkg || low)

  return (
    <View style={{ gap: 10 }}>
      <FeatureIntro
        id="class-card"
        pages={[
          { icon: "calendar", title: "Your classes, right here", text: "This card shows if you have class today and your classes for the week. Tap it to see the whole week." },
          { icon: "ticket", title: "Your sessions", text: `The big number is the sessions left in your package. We let you know when only ${LOW_SESSIONS} are left.` },
        ]}
      />
      <Pressable
        onPress={() => router.push("/(tabs)/(buttonTabs)/schedule")}
        style={({ pressed }) => [s.card, pressed && { opacity: 0.9 }]}
      >
        <View style={s.top}>
          <View style={{ flex: 1 }}>
            <Text style={s.kicker}>Today · {WEEK_DAYS[today]} {now.getDate()} {MONTHS[now.getMonth()]}</Text>
            <Text style={s.big}>{todays ? `Class at ${formatTime(todays.cls.start)}` : "Rest day"}</Text>
            <Text style={s.sub}>
              {todays
                ? `Until ${formatTime(todays.cls.start + CLASS_HOURS)}`
                : next ? `Next: ${dayLabel(next.cls.day)} at ${formatTime(next.cls.start)}` : "No more classes this week"}
            </Text>
          </View>
          <View style={[s.left, low && s.leftLow]}>
            <Text style={[s.leftN, low && { color: C.yellow }]}>{st.pkg ? left : "–"}</Text>
            <Text style={s.leftL}>sessions{"\n"}left</Text>
          </View>
        </View>
        {low && <Text style={s.lowLine}>{left ? `Only ${left} sessions left.` : "No sessions left."}</Text>}
        {!st.pkg && st.status === "ready" && <Text style={s.lowLine}>No package yet.</Text>}
        {offer && (asked ? (
          <Pressable style={s.planRow} onPress={() => setPlans(true)}>
            <Text style={[s.planText, { color: C.yellow }]}>Request sent: {planById(asked.plan)?.name}. Waiting for your coach.</Text>
          </Pressable>
        ) : (
          <Pressable style={[s.planRow, s.planRowGo]} onPress={() => setPlans(true)}>
            <Text style={[s.planText, { color: C.green }]}>{st.pkg ? "Renew: choose your plan" : "Choose your plan"}</Text>
            <Ionicons name="chevron-forward" size={14} color={C.green} />
          </Pressable>
        ))}
        {st.status === "ready" && !st.defaults.length && <Text style={s.lowLine}>Set your weekly schedule: tap to pick your usual classes.</Text>}
        <View style={s.list}>
          {week.map((e) => <Row key={e.cls.id} e={e} today={today} label={dayLabel(e.cls.day)} />)}
        </View>
        <View style={s.foot}>
          <Text style={s.footText}>{st.pkg ? `Use them by ${st.pkg.useBy}` : ""}</Text>
          <View style={s.see}>
            <Text style={s.seeText}>See the week</Text>
            <Ionicons name="chevron-forward" size={14} color={C.green} />
          </View>
        </View>
      </Pressable>
      <PlanPicker visible={plans} onClose={() => setPlans(false)} />
    </View>
  )
}

function Row({ e, today, label }: { e: WeekEntry; today: number; label: string }) {
  const [word, color] =
    e.state === "skip" ? ["Not going", C.textMuted]
    : e.state === "pending" ? ["Waiting for coach", C.yellow]
    : e.cls.day < today ? ["Done", C.textMuted]
    : e.cls.day === today ? ["Today", C.green]
    : e.extra ? ["Extra", C.textSecondary]
    : ["", C.textSecondary]
  const faded = e.state === "skip" || e.cls.day < today
  return (
    <View style={[s.row, faded && { opacity: 0.45 }]}>
      <Text style={[s.rowDay, e.cls.day === today && { color: C.green }]}>{label}</Text>
      <Text style={[s.rowTime, e.state === "skip" && { textDecorationLine: "line-through" }]}>{formatTime(e.cls.start)}</Text>
      <Text style={[s.rowState, { color }]}>{word}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  card: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 18, padding: 16, gap: 14 },
  top: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  kicker: { fontSize: 12, fontWeight: "700", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 },
  big: { fontSize: 22, fontWeight: "800", color: C.textPrimary, letterSpacing: -0.3 },
  sub: { fontSize: 13, fontWeight: "600", color: C.textSecondary, marginTop: 2 },
  left: { alignItems: "center", backgroundColor: "rgba(111,207,151,0.12)", borderRadius: 14, paddingVertical: 8, paddingHorizontal: 12 },
  leftLow: { backgroundColor: "rgba(254,215,102,0.14)" },
  leftN: { fontSize: 30, fontWeight: "800", color: C.green, lineHeight: 32, fontVariant: ["tabular-nums"] },
  leftL: { fontSize: 11, fontWeight: "700", color: C.textSecondary, textAlign: "center", lineHeight: 13 },
  lowLine: { fontSize: 12, fontWeight: "600", color: C.yellow, marginTop: -4 },
  planRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: -4,
    borderWidth: 1, borderColor: "rgba(254,215,102,0.35)", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12,
  },
  planRowGo: { borderColor: "rgba(111,207,151,0.4)" },
  planText: { flex: 1, fontSize: 13, fontWeight: "700" },
  list: { borderTopWidth: 1, borderTopColor: C.border },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  rowDay: { width: 70, fontSize: 15, fontWeight: "600", color: C.textSecondary, fontVariant: ["tabular-nums"] },
  rowTime: { flex: 1, fontSize: 15, fontWeight: "700", color: C.textPrimary, fontVariant: ["tabular-nums"] },
  rowState: { fontSize: 13, fontWeight: "600" },
  foot: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  footText: { fontSize: 13, color: C.textSecondary },
  see: { flexDirection: "row", alignItems: "center", gap: 2 },
  seeText: { fontSize: 13, fontWeight: "700", color: C.green },
})
