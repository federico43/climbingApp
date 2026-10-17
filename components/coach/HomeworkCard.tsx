import { C } from "@/utils/theme"
import { HomeworkCoachSheet } from "@/components/HomeworkCoachSheet"
import { card } from "@/components/coach/styles"
import { ProtocolRow, SessionRow } from "@/services/BoulderGraphService"
import { HOMEWORK_STATE_LABEL, dueByOf, homeworkStatus, shortDay, type HomeworkState } from "@/utils/homework"
import { addDays, localDateStr } from "@/utils/planRotation"
import { Ionicons } from "@expo/vector-icons"
import { useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"

const STATE_COLOR: Record<HomeworkState, string> = {
  not_scheduled: C.textMuted,
  scheduled: C.textPrimary,
  missed: C.yellow,
  cant_attend: C.red,
  overdue: C.red,
  done: C.green,
}

// The athlete's homework: pending first, then the last 3 weeks' done ones.
// Tap a pending one to move its deadline (HomeworkCoachSheet).
export function HomeworkCard({ homework, sessions, onChanged }: {
  homework: ProtocolRow[]
  sessions: SessionRow[]
  onChanged: () => void
}) {
  const [managing, setManaging] = useState<ProtocolRow | null>(null)
  const today = localDateStr(new Date())
  const cutoff = addDays(today, -21)
  const rows = homework.map((hw) => ({ hw, status: homeworkStatus(hw, sessions, today) }))
  const pending = rows.filter((r) => r.status.state !== "done")
    .sort((a, b) => dueByOf(a.hw).localeCompare(dueByOf(b.hw)))
  const done = rows.filter((r) => r.status.state === "done" && dueByOf(r.hw) >= cutoff)
  const urgent = pending.some((r) => r.status.state === "overdue" || r.status.state === "cant_attend")

  return (
    <View style={card.card}>
      <View style={card.headerRow}>
        <Text style={card.title}>Homework</Text>
        {pending.length > 0 && (
          <View style={[styles.count, { backgroundColor: urgent ? C.red : C.yellow }]}>
            {urgent && <Ionicons name="alert" size={11} color={C.bg} />}
            <Text style={styles.countText}>{pending.length} pending</Text>
          </View>
        )}
      </View>

      {pending.length === 0 && done.length === 0 && <Text style={card.empty}>No homework.</Text>}

      {pending.map(({ hw, status }) => (
        <Pressable key={hw.$id} style={styles.row} onPress={() => setManaging(hw)}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>{hw.name}</Text>
            <Text style={styles.due}>
              Due {shortDay(dueByOf(hw))}
              {hw.planIndex ? ` · workout ${hw.planIndex}` : ""}
            </Text>
            {status.state === "cant_attend" && !!hw.homeworkNote && (
              <Text style={styles.note}>“{hw.homeworkNote}”</Text>
            )}
          </View>
          <Text style={[styles.state, { color: STATE_COLOR[status.state] }]}>
            {HOMEWORK_STATE_LABEL[status.state]}{status.date ? ` ${shortDay(status.date)}` : ""}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
        </Pressable>
      ))}

      {done.length > 0 && (
        <>
          <Text style={styles.divider}>Done · last 3 weeks</Text>
          {done.map(({ hw, status }) => (
            <View key={hw.$id} style={styles.doneRow}>
              <Ionicons name="checkmark-circle" size={15} color={C.green} />
              <Text style={[styles.name, styles.doneName]} numberOfLines={1}>{hw.name}</Text>
              <Text style={styles.due}>{status.date ? shortDay(status.date) : ""}</Text>
            </View>
          ))}
        </>
      )}

      {managing && (
        <HomeworkCoachSheet hw={managing} onClose={() => setManaging(null)} onChanged={onChanged} />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  count: { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  countText: { fontSize: 11, fontWeight: "800", color: C.bg },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.border },
  name: { fontSize: 14, fontWeight: "600", color: C.textPrimary },
  due: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  note: { fontSize: 12, color: C.textSecondary, fontStyle: "italic", marginTop: 4 },
  state: { fontSize: 12, fontWeight: "700" },
  divider: { fontSize: 11, fontWeight: "700", color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 4 },
  doneRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  doneName: { flex: 1, color: C.textSecondary, fontWeight: "500" },
})
