import { C } from "@/utils/theme"
import { Ionicons } from "@expo/vector-icons"
import React from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"

// Small pieces the athlete week (schedule.tsx) and the coach's Classes tab
// share, laid out like Google Calendar.

export const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
export const DAYS_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
const MONTHS = MONTHS_LONG.map((m) => m.slice(0, 3))

// "November 2026", or "Nov – Dec 2026" when the week spans two months.
export function monthTitle(dates: Date[]): string {
  const a = dates[0]
  const b = dates[dates.length - 1]
  if (a.getMonth() === b.getMonth()) return `${MONTHS_LONG[a.getMonth()]} ${a.getFullYear()}`
  return `${MONTHS[a.getMonth()]} – ${MONTHS[b.getMonth()]} ${b.getFullYear()}`
}

// "Tuesday, Nov 12"
export const longDay = (dates: Date[], day: number) => `${DAYS_LONG[day]}, ${MONTHS[dates[day].getMonth()]} ${dates[day].getDate()}`

// This week / Next week, as pill tabs. `next` is null when next week can't be shown yet.
export function WeekSwitch({
  value,
  onChange,
  nextNote,
}: {
  value: "this" | "next"
  onChange: (w: "this" | "next") => void
  nextNote?: string | null // why next week is off (e.g. not published yet); null = on
}) {
  return (
    <View style={s.switch}>
      {(["this", "next"] as const).map((w) => {
        const off = w === "next" && !!nextNote
        const on = value === w
        return (
          <Pressable
            key={w}
            disabled={off}
            onPress={() => onChange(w)}
            style={[s.switchBtn, on && s.switchOn, off && { opacity: 0.4 }]}
            accessibilityState={{ selected: on, disabled: off }}
          >
            <Text style={[s.switchText, on && s.switchTextOn]}>{w === "this" ? "This week" : "Next week"}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export type LegendKey = "mine" | "open" | "full" | "pending" | "request"
const LEGEND: Record<LegendKey, { label: string; swatch: object }> = {
  mine: { label: "Your class", swatch: { backgroundColor: C.green } },
  open: { label: "Free spot", swatch: { backgroundColor: "rgba(111,207,151,0.14)", borderLeftWidth: 3, borderLeftColor: C.green } },
  full: { label: "Full", swatch: { backgroundColor: "#26282A", borderWidth: 1, borderColor: C.border } },
  pending: { label: "Waiting for coach", swatch: { backgroundColor: C.yellow } },
  request: { label: "Has a request", swatch: { backgroundColor: "#2F3A35", borderWidth: 2, borderColor: C.yellow } },
}

// What the colors mean, always on screen (new athletes don't read pop-ups).
export function Legend({ keys }: { keys: LegendKey[] }) {
  return (
    <View style={s.legend}>
      {keys.map((k) => (
        <View key={k} style={s.legendItem}>
          <View style={[s.swatch, LEGEND[k].swatch]} />
          <Text style={s.legendText}>{LEGEND[k].label}</Text>
        </View>
      ))}
    </View>
  )
}

// A Google-Calendar event detail row: icon on the left, text on the right.
export function DetailRow({ icon, text, sub, color }: { icon: keyof typeof Ionicons.glyphMap; text: string; sub?: string; color?: string }) {
  return (
    <View style={s.row}>
      <Ionicons name={icon} size={20} color={color ?? C.textSecondary} style={{ width: 24 }} />
      <View style={{ flex: 1 }}>
        <Text style={[s.rowText, color ? { color } : null]}>{text}</Text>
        {sub ? <Text style={s.rowSub}>{sub}</Text> : null}
      </View>
    </View>
  )
}

// One person in a class, with an optional action on the right (the coach's ×).
export function PersonRow({
  name, you, sub, subLow, right,
}: { name: string; you?: boolean; sub?: string; subLow?: boolean; right?: React.ReactNode }) {
  return (
    <View style={s.person}>
      <View style={[s.avatar, you && { backgroundColor: C.green }]}>
        <Text style={[s.avatarText, you && { color: "#10251A" }]}>{name[0]?.toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.personName} numberOfLines={1}>{you ? `${name} (you)` : name}</Text>
        {sub ? <Text style={[s.rowSub, subLow && { color: C.red }]}>{sub}</Text> : null}
      </View>
      {right}
    </View>
  )
}

// An empty spot in a class.
export function OpenSpot({ label = "Free spot", onPress }: { label?: string; onPress?: () => void }) {
  return (
    <Pressable style={s.person} disabled={!onPress} onPress={onPress}>
      <View style={[s.avatar, s.avatarOpen]}>
        <Ionicons name={onPress ? "add" : "person-outline"} size={16} color={onPress ? C.green : C.textMuted} />
      </View>
      <Text style={[s.personName, { color: onPress ? C.green : C.textMuted }]}>{label}</Text>
    </Pressable>
  )
}

// Two-way choice like Google Calendar's "Does not repeat / Weekly on …".
export function RepeatChoice({
  every,
  onChange,
  everyLabel,
  everyOff,
}: {
  every: boolean
  onChange: (every: boolean) => void
  everyLabel: string
  everyOff?: string | null // why "every week" can't be picked
}) {
  const opt = (on: boolean, label: string, value: boolean, off?: string | null) => (
    <Pressable style={[s.radio, off ? { opacity: 0.45 } : null]} disabled={!!off} onPress={() => onChange(value)}>
      <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={20} color={on ? C.green : C.textSecondary} />
      <View style={{ flex: 1 }}>
        <Text style={s.rowText}>{label}</Text>
        {off ? <Text style={s.rowSub}>{off}</Text> : null}
      </View>
    </Pressable>
  )
  return (
    <View style={s.radioBox}>
      {opt(!every, "Just this week", false)}
      {opt(every, everyLabel, true, everyOff)}
    </View>
  )
}

const s = StyleSheet.create({
  switch: { flexDirection: "row", backgroundColor: C.surface, borderRadius: 12, padding: 3, gap: 3 },
  switchBtn: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: "center" },
  switchOn: { backgroundColor: C.surfaceHigh },
  switchText: { fontSize: 13, fontWeight: "700", color: C.textSecondary },
  switchTextOn: { color: C.textPrimary },
  legend: { flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 6 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 16, height: 12, borderRadius: 3 },
  legendText: { fontSize: 12, color: C.textSecondary, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  rowText: { fontSize: 15, color: C.textPrimary, fontWeight: "600" },
  rowSub: { fontSize: 12.5, color: C.textSecondary, marginTop: 2 },
  person: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.surfaceHigh, alignItems: "center", justifyContent: "center" },
  avatarOpen: { backgroundColor: "transparent", borderWidth: 1, borderColor: C.border, borderStyle: "dashed" },
  avatarText: { fontSize: 13, fontWeight: "800", color: C.textSecondary },
  personName: { flex: 1, fontSize: 15, fontWeight: "600", color: C.textPrimary },
  radioBox: { backgroundColor: C.surfaceHigh, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 4 },
  radio: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
})
