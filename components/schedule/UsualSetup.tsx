import { CLASS_STARTS, GymClass, WEEK_DAYS, formatTime, parseSlot, slotKey, usualDayOk } from "@/utils/classSchedule"
import { C } from "@/utils/theme"
import { Ionicons } from "@expo/vector-icons"
import { useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

// Shown instead of the week before the athlete has a usual schedule (and from
// "Change"): first "same days every week?", then the days and the time of each.
export function UsualSetup({
  initial,
  classes,
  busy,
  askFirst,
  onNo,
  onSave,
  onCancel,
}: {
  initial: string[]                 // usual classes already saved, "day@start"
  classes: GymClass[]               // the week's classes, to suggest their times
  busy: boolean
  askFirst: boolean                 // start on the yes / no question
  onNo: () => void
  onSave: (slots: string[]) => void
  onCancel?: () => void
}) {
  const [step, setStep] = useState<"ask" | "pick">(askFirst ? "ask" : "pick")
  // day → start (null until a time is picked)
  const [picked, setPicked] = useState<Record<number, number | null>>(() => {
    const out: Record<number, number | null> = {}
    for (const s of initial.map(parseSlot)) if (s) out[s.day] = s.start
    return out
  })
  const days = Object.keys(picked).map(Number).sort((a, b) => a - b)
  const timesOn = (day: number) => [...new Set(classes.filter((c) => c.day === day).map((c) => c.start))].sort((a, b) => a - b)

  const toggleDay = (day: number) => {
    if (day in picked) {
      const next = { ...picked }
      delete next[day]
      return setPicked(next)
    }
    if (!usualDayOk(days, day)) return
    setPicked({ ...picked, [day]: timesOn(day)[0] ?? null })
  }
  const ready = days.length > 0 && days.every((d) => picked[d] != null)

  if (step === "ask") {
    return (
      <ScrollView contentContainerStyle={s.wrap}>
        <View style={s.icon}><Ionicons name="calendar" size={40} color={C.green} /></View>
        <Text style={s.title}>Your class schedule</Text>
        <Text style={s.lead}>Do you go to class on the same days and times every week?</Text>
        <Pressable style={({ pressed }) => [s.choice, s.choiceYes, pressed && { opacity: 0.85 }]} onPress={() => setStep("pick")}>
          <Text style={[s.choiceTitle, { color: "#10251A" }]}>Yes, I have a fixed schedule</Text>
          <Text style={[s.choiceText, { color: "#1E4430" }]}>Pick your days and times once. You&apos;re signed up every week.</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [s.choice, pressed && { opacity: 0.85 }]} onPress={onNo}>
          <Text style={s.choiceTitle}>No, it changes every week</Text>
          <Text style={s.choiceText}>Pick your classes week by week in the calendar.</Text>
        </Pressable>
      </ScrollView>
    )
  }

  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.title}>Your fixed schedule</Text>
      <Text style={s.lead}>1. Pick your days (1 to 3, with a rest day between them)</Text>
      <View style={s.days}>
        {WEEK_DAYS.map((label, day) => {
          const on = day in picked
          const off = !on && !usualDayOk(days, day)
          return (
            <Pressable key={day} disabled={off} onPress={() => toggleDay(day)} style={[s.day, on && s.dayOn, off && { opacity: 0.3 }]}>
              <Text style={[s.dayText, on && s.dayTextOn]}>{label}</Text>
            </Pressable>
          )
        })}
      </View>

      {days.length > 0 && <Text style={s.lead}>2. Pick the time of each day</Text>}
      {days.map((day) => {
        const coach = timesOn(day)
        const rest = CLASS_STARTS.filter((t) => !coach.includes(t))
        return (
          <View key={day} style={s.dayBox}>
            <Text style={s.dayName}>{DAY_NAMES[day]}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.times}>
              {[...coach, ...rest].map((t, i) => {
                const on = picked[day] === t
                const isClass = i < coach.length
                return (
                  <Pressable key={t} onPress={() => setPicked({ ...picked, [day]: t })} style={[s.time, isClass && s.timeClass, on && s.timeOn]}>
                    <Text style={[s.timeText, on && s.dayTextOn]}>{formatTime(t)}</Text>
                    {isClass && <Text style={[s.timeTag, on && s.dayTextOn]}>class</Text>}
                  </Pressable>
                )
              })}
            </ScrollView>
          </View>
        )
      })}
      {days.length > 0 && !!classes.length && (
        <Text style={s.note}>Times marked &quot;class&quot; are this week&apos;s classes. If your coach has no class at your time, we&apos;ll show you the ones there are.</Text>
      )}

      <Pressable
        disabled={!ready || busy}
        onPress={() => onSave(days.map((d) => slotKey({ day: d, start: picked[d]! })))}
        style={({ pressed }) => [s.save, (!ready || busy) && { opacity: 0.35 }, pressed && { opacity: 0.85 }]}
      >
        {busy ? <ActivityIndicator color="#10251A" /> : <Text style={s.saveText}>Save my schedule</Text>}
      </Pressable>
      {askFirst ? (
        <Pressable style={s.back} onPress={() => setStep("ask")}><Text style={s.backText}>Back</Text></Pressable>
      ) : onCancel ? (
        <Pressable style={s.back} onPress={onCancel}><Text style={s.backText}>Cancel</Text></Pressable>
      ) : null}
    </ScrollView>
  )
}

const s = StyleSheet.create({
  wrap: { padding: 20, gap: 14 },
  icon: {
    width: 80, height: 80, borderRadius: 40, alignSelf: "center", alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(111,207,151,0.12)", marginTop: 12,
  },
  title: { fontSize: 26, fontWeight: "800", color: C.textPrimary, letterSpacing: -0.4 },
  lead: { fontSize: 16, fontWeight: "600", color: C.textPrimary, lineHeight: 22 },
  choice: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 18, gap: 4 },
  choiceYes: { backgroundColor: C.green, borderColor: C.green },
  choiceTitle: { fontSize: 17, fontWeight: "800", color: C.textPrimary },
  choiceText: { fontSize: 14, color: C.textSecondary, lineHeight: 19 },
  days: { flexDirection: "row", gap: 6 },
  day: {
    flex: 1, alignItems: "center", paddingVertical: 14, borderRadius: 12,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  dayOn: { backgroundColor: C.green, borderColor: C.green },
  dayText: { fontSize: 13, fontWeight: "800", color: C.textPrimary },
  dayTextOn: { color: "#10251A" },
  dayBox: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 14, gap: 10 },
  dayName: { fontSize: 16, fontWeight: "800", color: C.textPrimary },
  times: { gap: 8 },
  time: {
    minWidth: 64, alignItems: "center", paddingVertical: 10, paddingHorizontal: 10, borderRadius: 12,
    backgroundColor: C.surfaceHigh, borderWidth: 1, borderColor: C.border,
  },
  timeClass: { borderColor: "rgba(111,207,151,0.6)" },
  timeOn: { backgroundColor: C.green, borderColor: C.green },
  timeText: { fontSize: 15, fontWeight: "800", color: C.textPrimary, fontVariant: ["tabular-nums"] },
  timeTag: { fontSize: 10, fontWeight: "700", color: C.green, marginTop: 1 },
  note: { fontSize: 13, color: C.textSecondary, lineHeight: 18 },
  save: { backgroundColor: C.green, borderRadius: 14, paddingVertical: 15, alignItems: "center", marginTop: 6 },
  saveText: { fontSize: 16, fontWeight: "800", color: "#10251A" },
  back: { alignItems: "center", paddingVertical: 10 },
  backText: { fontSize: 15, fontWeight: "700", color: C.textSecondary },
})
