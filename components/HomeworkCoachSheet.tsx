import { C } from "@/utils/theme"
import { deleteProtocol, setHomeworkDeadline, type ProtocolRow } from "@/services/BoulderGraphService"
import { notifyHomeworkAssigned } from "@/services/homework"
import { dueByOf, shortDay } from "@/utils/homework"
import { addDays, localDateStr } from "@/utils/planRotation"
import { useState } from "react"
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native"

// Coach: one homework's actions (docs/training-plan-implementation.md §11) —
// extend its deadline (clears a "can't attend", pushes the athlete) or
// cancel it (deletes the homework workout).
export function HomeworkCoachSheet({ hw, onClose, onChanged }: {
  hw: ProtocolRow
  onClose: () => void
  onChanged: () => void
}) {
  const today = localDateStr(new Date())
  const current = dueByOf(hw)
  // Start from whichever is later: the current deadline or today, + 2 days.
  const [dueBy, setDueBy] = useState(addDays(current > today ? current : today, 2))
  const [busy, setBusy] = useState<"extend" | "cancel" | null>(null)

  async function extend() {
    setBusy("extend")
    try {
      await setHomeworkDeadline(hw.$id, dueBy)
      notifyHomeworkAssigned(hw.$id, shortDay(dueBy), true)
      onChanged()
      onClose()
    } catch (e: any) {
      Alert.alert("Couldn't change the deadline", e?.message ?? "Try again.")
      setBusy(null)
    }
  }

  function cancel() {
    Alert.alert("Cancel homework", `Remove "${hw.name}"? The athlete won't see it any more.`, [
      { text: "Keep it", style: "cancel" },
      {
        text: "Cancel homework", style: "destructive", onPress: async () => {
          setBusy("cancel")
          try {
            await deleteProtocol(hw.$id)
            onChanged()
            onClose()
          } catch (e: any) {
            Alert.alert("Couldn't cancel it", e?.message ?? "Try again.")
            setBusy(null)
          }
        },
      },
    ])
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <Text style={s.title} numberOfLines={2}>{hw.name}</Text>
          <Text style={s.sub}>Due {shortDay(current)}</Text>
          {hw.homeworkStatus === "cant_attend" && (
            <Text style={s.note}>
              {"Can't attend"}{hw.homeworkNote ? `: “${hw.homeworkNote}”` : ""}
            </Text>
          )}

          <Text style={s.label}>New deadline</Text>
          <View style={s.row}>
            <Pressable
              style={[s.step, dueBy <= today && { opacity: 0.3 }]}
              disabled={dueBy <= today}
              onPress={() => setDueBy((d) => addDays(d, -1))}
              hitSlop={6}
            >
              <Text style={s.stepText}>−</Text>
            </Pressable>
            <Text style={s.date}>{shortDay(dueBy)}</Text>
            <Pressable style={s.step} onPress={() => setDueBy((d) => addDays(d, 1))} hitSlop={6}>
              <Text style={s.stepText}>+</Text>
            </Pressable>
          </View>
          <Pressable style={[s.primary, !!busy && { opacity: 0.6 }]} onPress={extend} disabled={!!busy}>
            {busy === "extend" ? <ActivityIndicator color={C.bg} /> : <Text style={s.primaryText}>Set deadline</Text>}
          </Pressable>
          <Text style={s.hint}>The athlete is notified and picks a day again.</Text>

          <View style={s.divider} />
          <Pressable style={s.danger} onPress={cancel} disabled={!!busy}>
            {busy === "cancel" ? <ActivityIndicator color={C.red} /> : <Text style={s.dangerText}>Cancel homework</Text>}
          </Pressable>
          <Pressable onPress={onClose} hitSlop={8}><Text style={s.close}>Close</Text></Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 24 },
  sheet: { width: "100%", maxWidth: 420, backgroundColor: C.surface, borderRadius: 18, padding: 20, gap: 8 },
  title: { fontSize: 18, fontWeight: "800", color: C.textPrimary },
  sub: { fontSize: 13, color: C.textSecondary },
  note: { fontSize: 13, color: C.red, fontWeight: "600" },
  label: { fontSize: 14, color: C.textPrimary, fontWeight: "600", marginTop: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  step: { width: 40, height: 40, borderRadius: 10, backgroundColor: C.surfaceHigh, alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: 22, color: C.textPrimary, fontWeight: "700" },
  date: { flex: 1, textAlign: "center", fontSize: 16, color: C.textPrimary, fontWeight: "800" },
  primary: { backgroundColor: C.green, borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  primaryText: { fontSize: 15, fontWeight: "800", color: C.bg },
  hint: { fontSize: 12, color: C.textMuted, textAlign: "center" },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 6 },
  danger: { borderRadius: 14, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: C.red },
  dangerText: { fontSize: 15, fontWeight: "800", color: C.red },
  close: { fontSize: 14, fontWeight: "700", color: C.textSecondary, textAlign: "center", paddingVertical: 6 },
})
