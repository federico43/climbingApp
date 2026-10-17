import { C } from "@/utils/theme"
import { defaultTrainingDays } from "@/utils/planSchedule"
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native"

// Training days (and an optional time) for the weekly scheduler
// (utils/planSchedule.ts): the coach's plan screen and the athlete's Plan
// page. Controlled — the parent saves.

// Monday first; values are JS weekdays (0 = Sunday).
const WEEK: { day: number; label: string }[] = [
  { day: 1, label: "Mon" }, { day: 2, label: "Tue" }, { day: 3, label: "Wed" }, { day: 4, label: "Thu" },
  { day: 5, label: "Fri" }, { day: 6, label: "Sat" }, { day: 0, label: "Sun" },
]

export function weekdaysLabel(days: number[]): string {
  return WEEK.filter((w) => days.includes(w.day)).map((w) => w.label).join(", ")
}

export function TrainingDaysPicker({
  windowStart,
  days,
  time,
  onChangeDays,
  onChangeTime,
}: {
  windowStart: string
  days: number[]     // empty = the default days
  time: string       // "18:00", or "" for none
  onChangeDays: (days: number[]) => void
  onChangeTime: (time: string) => void
}) {
  const shown = days.length ? days : defaultTrainingDays(windowStart)
  function toggle(day: number) {
    const next = shown.includes(day) ? shown.filter((d) => d !== day) : [...shown, day]
    onChangeDays(next.sort((a, b) => a - b))
  }
  return (
    <View style={s.wrap}>
      <View style={s.days}>
        {WEEK.map(({ day, label }) => {
          const sel = shown.includes(day)
          return (
            <Pressable key={day} style={[s.day, sel && s.daySelected]} onPress={() => toggle(day)}>
              <Text style={[s.dayText, sel && s.dayTextSelected]}>{label}</Text>
            </Pressable>
          )
        })}
      </View>
      <Text style={s.hint}>
        {days.length ? "" : "Default: the plan's days 1 and 4. "}
        Two plan workouts a week, never on back-to-back days.
      </Text>
      <View style={s.timeRow}>
        <Text style={s.timeLabel}>Usual time (optional)</Text>
        <TextInput
          style={s.timeInput}
          value={time}
          onChangeText={onChangeTime}
          placeholder="18:00"
          placeholderTextColor={C.textMuted}
          keyboardType="numbers-and-punctuation"
          maxLength={5}
        />
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { gap: 8 },
  days: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  day: { paddingVertical: 7, paddingHorizontal: 10, borderRadius: 999, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border },
  daySelected: { backgroundColor: C.green, borderColor: C.green },
  dayText: { fontSize: 12.5, fontWeight: "600", color: C.textSecondary },
  dayTextSelected: { color: C.bg },
  hint: { fontSize: 12, color: C.textMuted },
  timeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  timeLabel: { fontSize: 13, fontWeight: "600", color: C.textSecondary },
  timeInput: {
    width: 80, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 10, fontSize: 14, color: C.textPrimary, textAlign: "center",
  },
})
