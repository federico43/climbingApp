import { CLASS_HOURS, GRID_END, GRID_START, formatTime } from "@/utils/classSchedule"
import { C } from "@/utils/theme"
import React from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"

export const HOUR_HEIGHT = 46
const HOURS = Array.from({ length: GRID_END - GRID_START }, (_, i) => GRID_START + i)
const LETTERS = ["M", "T", "W", "T", "F", "S", "S"]

// One week, Google-Calendar style: 7 day columns, 6:00 to 18:00.
export function WeekGrid({
  dates,
  today = -1,
  dimPast = false,
  offDays = [],
  onPressDay,
  onPressTime,
  renderDay,
}: {
  dates: Date[]
  today?: number                  // highlighted day, -1 for none
  dimPast?: boolean               // fade the days before `today`
  offDays?: number[]              // struck-through day numbers (blocked days)
  onPressDay?: (day: number) => void
  onPressTime?: (day: number, y: number) => void
  renderDay: (day: number) => React.ReactNode
}) {
  return (
    <View style={{ flex: 1 }}>
      <View style={s.heads}>
        <View style={s.gutter} />
        {dates.map((d, i) => {
          const isToday = i === today
          const off = offDays.includes(i)
          return (
            <Pressable key={i} style={s.head} disabled={!onPressDay} onPress={() => onPressDay?.(i)}>
              <Text style={[s.letter, isToday && { color: C.green }]}>{LETTERS[i]}</Text>
              <View style={[s.num, isToday && s.numToday]}>
                <Text style={[s.numText, isToday && s.numTextToday, off && s.numOff]}>{d.getDate()}</Text>
              </View>
            </Pressable>
          )
        })}
      </View>
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        <View style={[s.body, { height: HOURS.length * HOUR_HEIGHT }]}>
          <View style={s.gutter}>
            {HOURS.slice(1).map((h) => (
              <Text key={h} style={[s.hour, { top: (h - GRID_START) * HOUR_HEIGHT - 6 }]}>{h}:00</Text>
            ))}
          </View>
          {dates.map((_, day) => (
            <Pressable
              key={day}
              style={[s.col, dimPast && day < today && { opacity: 0.45 }]}
              disabled={!onPressTime}
              onPress={(e) => onPressTime?.(day, e.nativeEvent.locationY)}
            >
              {HOURS.map((h) => (
                <View key={h} pointerEvents="none" style={[s.line, { top: (h - GRID_START) * HOUR_HEIGHT }]} />
              ))}
              {renderDay(day)}
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  )
}

// A block on the grid, from `start` for `hours`.
export function GridBlock({
  start,
  hours = CLASS_HOURS,
  tone,
  text,
  onPress,
}: {
  start: number
  hours?: number
  tone: "mine" | "other" | "full" | "pending" | "skip" | "pick" | "blocked"
  text: string
  onPress?: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      // Without an action, taps go through to the day column (e.g. to pick a time).
      pointerEvents={onPress ? "auto" : "none"}
      style={[s.block, tones[tone], { top: (start - GRID_START) * HOUR_HEIGHT + 1, height: hours * HOUR_HEIGHT - 3 }]}
    >
      <Text style={[s.blockText, toneText[tone]]}>{text}</Text>
    </Pressable>
  )
}

export const blockTime = (start: number) => formatTime(start)

const tones = StyleSheet.create({
  mine: { backgroundColor: C.green },
  other: { backgroundColor: "#2F3A35" },
  full: { backgroundColor: "#26282A" },
  pending: { backgroundColor: C.yellow },
  skip: { backgroundColor: "transparent", borderWidth: 1, borderColor: C.border },
  pick: { backgroundColor: "#2F3A35", borderWidth: 2, borderColor: C.yellow },
  blocked: { backgroundColor: "#202224", borderWidth: 1, borderColor: C.border, borderStyle: "dashed" },
})
const toneText = StyleSheet.create({
  mine: { color: "#10251A" },
  other: { color: C.textSecondary },
  full: { color: C.textMuted },
  pending: { color: "#3A2E00" },
  skip: { color: C.textMuted, textDecorationLine: "line-through" },
  pick: { color: C.textPrimary },
  blocked: { color: C.textMuted },
})

const s = StyleSheet.create({
  heads: { flexDirection: "row", paddingRight: 6, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  gutter: { width: 30 },
  head: { flex: 1, alignItems: "center", gap: 2 },
  letter: { fontSize: 11, fontWeight: "700", color: C.textSecondary },
  num: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  numToday: { backgroundColor: C.green },
  numText: { fontSize: 17, fontWeight: "500", color: C.textSecondary, fontVariant: ["tabular-nums"] },
  numTextToday: { color: "#10251A", fontWeight: "800" },
  numOff: { textDecorationLine: "line-through", color: C.textMuted },
  body: { flexDirection: "row", paddingRight: 6 },
  hour: { position: "absolute", right: 3, fontSize: 9, color: C.textMuted, fontVariant: ["tabular-nums"] },
  col: { flex: 1, borderLeftWidth: 1, borderLeftColor: "rgba(255,255,255,0.05)" },
  line: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: "rgba(255,255,255,0.05)" },
  block: { position: "absolute", left: 1, right: 1, borderRadius: 5, padding: 3, overflow: "hidden" },
  blockText: { fontSize: 9, fontWeight: "700", lineHeight: 11 },
})
