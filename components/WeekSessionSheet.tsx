import { C } from "@/utils/theme"
import {
  DURATIONS, WEEK_DAYS, clampHours, formatHours, formatTime, stepStart,
} from "@/utils/weekSchedule"
import { Ionicons } from "@expo/vector-icons"
import { useEffect, useState } from "react"
import { Modal, Pressable, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

export interface SessionDraft {
  id: string | null // null → a new session
  days: number[]    // a new session can go on several days at once
  start: number
  hours: number
}

interface Props {
  draft: SessionDraft | null // null → hidden
  onSave: (draft: SessionDraft) => void
  onDelete: (id: string) => void
  onClose: () => void
}

// Bottom sheet to add or edit a session in the default week (Settings › My week).
export function WeekSessionSheet({ draft, onSave, onDelete, onClose }: Props) {
  const insets = useSafeAreaInsets()
  const [d, setD] = useState<SessionDraft | null>(draft)
  useEffect(() => setD(draft), [draft])

  const editing = !!d?.id
  const toggleDay = (day: number) => {
    if (!d) return
    if (editing) return setD({ ...d, days: [day] })
    setD({ ...d, days: d.days.includes(day) ? d.days.filter((x) => x !== day) : [...d.days, day] })
  }

  return (
    <Modal visible={!!draft} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} />
      {d && (
        <View style={[s.sheet, { paddingBottom: 20 + insets.bottom }]}>
          <View style={s.grab} />
          <Text style={s.title}>{editing ? "Edit training" : "New training"}</Text>

          <Text style={s.label}>{editing ? "Day" : "Days"}</Text>
          <View style={s.chips}>
            {WEEK_DAYS.map((name, i) => {
              const sel = d.days.includes(i)
              return (
                <Pressable key={name} onPress={() => toggleDay(i)} style={[s.chip, sel && s.chipSel]}>
                  <Text style={[s.chipText, sel && s.chipTextSel]}>{name[0]}</Text>
                </Pressable>
              )
            })}
          </View>

          <View>
            <Text style={s.label}>Start</Text>
            <View style={s.stepper}>
              <Pressable hitSlop={8} onPress={() => setD({ ...d, start: stepStart(d.start, -1) })}>
                <Ionicons name="chevron-back" size={18} color={C.textSecondary} />
              </Pressable>
              <Text style={s.stepperText}>{formatTime(d.start)}</Text>
              <Pressable hitSlop={8} onPress={() => setD({ ...d, start: stepStart(d.start, 1) })}>
                <Ionicons name="chevron-forward" size={18} color={C.textSecondary} />
              </Pressable>
            </View>
          </View>
          <View>
            <Text style={s.label}>Duration</Text>
            <View style={s.durs}>
              {DURATIONS.map((h) => {
                const sel = d.hours === h
                return (
                  <Pressable key={h} onPress={() => setD({ ...d, hours: h })} style={[s.dur, sel && s.chipSel]}>
                    <Text style={[s.chipText, sel && s.chipTextSel]}>{formatHours(h)}</Text>
                  </Pressable>
                )
              })}
            </View>
          </View>

          <View style={s.actions}>
            <Pressable
              style={[s.secondary, editing && s.danger]}
              onPress={() => (editing ? onDelete(d.id!) : onClose())}
            >
              <Text style={[s.secondaryText, editing && { color: C.red }]}>{editing ? "Delete" : "Cancel"}</Text>
            </Pressable>
            <Pressable
              disabled={!d.days.length}
              style={[s.primary, !d.days.length && s.primaryOff]}
              onPress={() => onSave({ ...d, hours: clampHours(d.start, d.hours) })}
            >
              <Text style={[s.primaryText, !d.days.length && { color: C.textMuted }]}>{editing ? "Done" : "Add"}</Text>
            </Pressable>
          </View>
        </View>
      )}
    </Modal>
  )
}

const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 10,
  },
  grab: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.surfaceHigh, alignSelf: "center", marginBottom: 12 },
  title: { fontSize: 20, fontWeight: "800", color: C.textPrimary, letterSpacing: -0.3, marginBottom: 6 },
  label: {
    fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase",
    color: C.textSecondary, marginTop: 14, marginBottom: 8,
  },
  chips: { flexDirection: "row", gap: 6 },
  chip: {
    flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: "center",
    backgroundColor: C.surfaceHigh, borderWidth: 1, borderColor: C.border,
  },
  chipSel: { backgroundColor: C.green, borderColor: C.green },
  chipText: { fontSize: 13, fontWeight: "700", color: C.textSecondary },
  chipTextSel: { color: "#10251A" },
  stepper: {
    alignSelf: "flex-start", minWidth: 150, gap: 16,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: C.surfaceHigh, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    paddingVertical: 10, paddingHorizontal: 10,
  },
  stepperText: { fontSize: 15, fontWeight: "700", color: C.textPrimary, fontVariant: ["tabular-nums"] },
  durs: { flexDirection: "row", gap: 6 },
  dur: {
    flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: "center",
    backgroundColor: C.surfaceHigh, borderWidth: 1, borderColor: C.border,
  },
  actions: { flexDirection: "row", gap: 10, marginTop: 22 },
  secondary: {
    flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: "center",
    borderWidth: 1, borderColor: C.border,
  },
  danger: { borderColor: "rgba(219,80,74,0.35)" },
  secondaryText: { fontSize: 15, fontWeight: "700", color: C.textSecondary },
  primary: { flex: 2, paddingVertical: 14, borderRadius: 14, alignItems: "center", backgroundColor: C.green },
  primaryOff: { backgroundColor: C.surfaceHigh },
  primaryText: { fontSize: 15, fontWeight: "800", color: "#10251A" },
})
