import { useAuth } from "@/components/auth-context"
import { FeatureIntro } from "@/components/schedule/FeatureIntro"
import {
  CLASS_HOURS, LOW_SESSIONS, WEEK_DAYS, WeekEntry, athleteWeek, formatTime, mondayOf, weekDates, weekdayOf,
} from "@/utils/classSchedule"
import { useClassSchedule } from "@/utils/classScheduleStore"
import { CardTitle, Mono, usePaper, usePaperStyles } from "@/components/paper"
import { font, radius, type PaperTheme } from "@/theme/paper/tokens"
import { Ionicons } from "@expo/vector-icons"
import { useRouter } from "expo-router"
import { Pressable, StyleSheet, Text, View } from "react-native"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

// Top of Plan for athletes: today, sessions left and this week's classes.
// Tapping it opens the week (schedule.tsx).
export function ThisWeekCard() {
  const router = useRouter()
  const { role } = useAuth()
  const st = useClassSchedule()
  const t = usePaper()
  const s = usePaperStyles(makeStyles)
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
            <Mono style={{ marginBottom: 6 }}>Today · {WEEK_DAYS[today]} {now.getDate()} {MONTHS[now.getMonth()]}</Mono>
            <CardTitle size={30}>{todays ? `Class at ${formatTime(todays.cls.start)}` : "Rest day"}</CardTitle>
            <Text style={s.sub}>
              {todays
                ? `Until ${formatTime(todays.cls.start + CLASS_HOURS)}`
                : next ? `Next: ${dayLabel(next.cls.day)} at ${formatTime(next.cls.start)}` : "No more classes this week"}
            </Text>
          </View>
          <View style={[s.left, low && s.leftLow]}>
            <Text style={[s.leftN, low && { color: t.ink }]}>{st.pkg ? left : "–"}</Text>
            <Text style={[s.leftL, low && { color: t.label }]}>sessions{"\n"}left</Text>
          </View>
        </View>
        {low && <Text style={s.lowLine}>{left ? `Only ${left} sessions left.` : "No sessions left."} Talk to your coach to renew your package.</Text>}
        {!st.pkg && st.status === "ready" && <Text style={s.lowLine}>No package yet. Ask your coach to add one.</Text>}
        {st.status === "ready" && !st.defaults.length && <Text style={s.lowLine}>Set your weekly schedule: tap to pick your usual classes.</Text>}
        <View style={s.list}>
          {week.map((e) => <Row key={e.cls.id} e={e} today={today} label={dayLabel(e.cls.day)} />)}
        </View>
        <View style={s.foot}>
          <Text style={s.footText}>{st.pkg ? `Use them by ${st.pkg.useBy}` : ""}</Text>
          <View style={s.see}>
            <Text style={s.seeText}>See the week</Text>
            <Ionicons name="chevron-forward" size={14} color={t.mintText} />
          </View>
        </View>
      </Pressable>
    </View>
  )
}

function Row({ e, today, label }: { e: WeekEntry; today: number; label: string }) {
  const t = usePaper()
  const s = usePaperStyles(makeStyles)
  const [word, color] =
    e.state === "skip" ? ["Not going", t.label]
    : e.state === "pending" ? ["Waiting for coach", t.ink]
    : e.cls.day < today ? ["Done", t.label]
    : e.cls.day === today ? ["Today", t.mintText]
    : e.extra ? ["Extra", t.textMuted]
    : ["", t.textMuted]
  const faded = e.state === "skip" || e.cls.day < today
  return (
    <View style={[s.row, faded && { opacity: 0.45 }]}>
      <Text style={[s.rowDay, e.cls.day === today && { color: t.mintText }]}>{label}</Text>
      <Text style={[s.rowTime, e.state === "skip" && { textDecorationLine: "line-through" }]}>{formatTime(e.cls.start)}</Text>
      <Text style={[s.rowState, { color }]}>{word}</Text>
    </View>
  )
}

const makeStyles = (t: PaperTheme) => StyleSheet.create({
  card: { backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder, borderRadius: radius.card, padding: 18, gap: 14 },
  top: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  sub: { fontFamily: font.body, fontSize: 13, color: t.textMuted, marginTop: 4 },
  left: { alignItems: "center", backgroundColor: t.iconCircle, borderRadius: 18, paddingVertical: 8, paddingHorizontal: 12 },
  leftLow: { backgroundColor: "transparent", borderWidth: 2, borderColor: t.ink },
  leftN: { fontFamily: font.title, fontSize: 32, color: t.mint, lineHeight: 34 },
  leftL: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: t.mode === "dark" ? t.label : "#B9B0C6", textAlign: "center", lineHeight: 12 },
  lowLine: { fontFamily: font.bold, fontSize: 12, color: t.ink, marginTop: -4 },
  list: { borderTopWidth: 1, borderTopColor: t.hairline },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.hairline },
  rowDay: { width: 70, fontFamily: font.mono, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: t.label },
  rowTime: { flex: 1, fontFamily: font.bodyBold, fontSize: 15, color: t.ink },
  rowState: { fontFamily: font.mono, fontSize: 10, letterSpacing: 1, textTransform: "uppercase" },
  foot: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  footText: { fontFamily: font.body, fontSize: 13, color: t.textMuted },
  see: { flexDirection: "row", alignItems: "center", gap: 2 },
  seeText: { fontFamily: font.bold, fontSize: 13, color: t.mintText },
})
