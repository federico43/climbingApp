import { C } from "@/utils/theme"
import { card } from "@/components/coach/styles"
import { getActiveTrainingPlan, TrainingPlanRow } from "@/services/BoulderGraphService"
import { savePlanPauses } from "@/services/classSchedule"
import {
  endPauseEarly, MAX_PAUSE_WEEKS, pauseFor, pauseOn, pauseProblem, type PlanPause,
} from "@/utils/planPauses"
import { localDateStr, planEndFor } from "@/utils/planRotation"
import DateTimePicker from "@react-native-community/datetimepicker"
import { useEffect, useState } from "react"
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native"

// Coach: the plan's pauses (holidays, an injury) on the Training plan card,
// and the form to add one (utils/planPauses.ts). Saved through the
// climbingApp function, which also moves the plan's end date, the package's
// use-by date and the athlete's classes.

const REASONS = ["Holidays", "Injury", "Illness"]
const WEEKS = Array.from({ length: MAX_PAUSE_WEEKS }, (_, i) => i + 1)

function formatDay(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function PlanPauses({ plan, onPlanChanged }: { plan: TrainingPlanRow; onPlanChanged: (plan: TrainingPlanRow) => void }) {
  const today = localDateStr(new Date())
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)

  async function save(pauses: PlanPause[]) {
    setSaving(true)
    try {
      await savePlanPauses(plan.$id, pauses)
      const fresh = await getActiveTrainingPlan(plan.athleteId)
      if (fresh) onPlanChanged(fresh)
      return true
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not save the pause.")
      return false
    } finally {
      setSaving(false)
    }
  }

  function change(p: PlanPause) {
    const running = !!pauseOn([p], today)
    const ended = running ? endPauseEarly(p, today) : null
    Alert.alert(
      running ? "End the pause today?" : "Remove this pause?",
      running ? "The plan picks up again today." : "The plan's end date moves back to where it was.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: running ? "End now" : "Remove", style: "destructive",
          onPress: () => save(plan.pauses.flatMap((x) => (x === p ? (ended ? [ended] : []) : [x]))),
        },
      ],
    )
  }

  return (
    <View style={styles.wrap}>
      {plan.pauses.map((p) => {
        const past = p.end < today
        return (
          <View key={p.start} style={[styles.row, past && { opacity: 0.5 }]}>
            <Text style={styles.icon}>⏸</Text>
            <Text style={styles.text}>
              {pauseOn([p], today) ? "Paused · " : ""}{formatDay(p.start)} – {formatDay(p.end)}
              {p.reason ? <Text style={styles.reason}> · {p.reason}</Text> : null}
            </Text>
            {!past && (
              <Pressable onPress={() => change(p)} hitSlop={8} disabled={saving}>
                <Text style={card.link}>{pauseOn([p], today) ? "End now" : "Remove"}</Text>
              </Pressable>
            )}
          </View>
        )
      })}
      <Pressable onPress={() => setAdding(true)} hitSlop={8} style={{ alignSelf: "flex-start" }} disabled={saving}>
        <Text style={card.link}>{saving ? "Saving…" : "+ Add pause"}</Text>
      </Pressable>
      <AddPauseModal
        visible={adding}
        plan={plan}
        saving={saving}
        onClose={() => setAdding(false)}
        onSave={async (pause) => {
          const ok = await save([...plan.pauses, pause].sort((a, b) => (a.start < b.start ? -1 : 1)))
          if (ok) setAdding(false)
        }}
      />
    </View>
  )
}

function AddPauseModal({ visible, plan, saving, onClose, onSave }: {
  visible: boolean
  plan: TrainingPlanRow
  saving: boolean
  onClose: () => void
  onSave: (pause: PlanPause) => void
}) {
  const [start, setStart] = useState(localDateStr(new Date()))
  const [weeks, setWeeks] = useState(1)
  const [reason, setReason] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    if (!visible) return
    const today = localDateStr(new Date())
    setStart(today < plan.windowStart ? plan.windowStart : today)
    setWeeks(1)
    setReason("")
    setPickerOpen(false)
  }, [visible, plan.windowStart])

  const pause = pauseFor(start, weeks, reason)
  const problem = pauseProblem(pause, plan.pauses, plan)
  const newEnd = planEndFor(plan.windowStart, [...plan.pauses, pause])

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8}>
            <Text style={styles.closeBtnText}>✕</Text>
          </Pressable>
          <Text style={styles.title}>Pause the plan</Text>
          <Text style={styles.sub}>The plan stops and its end date moves back. No classes on those days, and the package lasts that much longer.</Text>

          <Text style={styles.label}>From</Text>
          <Pressable style={styles.input} onPress={() => setPickerOpen(true)}>
            <Text style={styles.inputText}>{formatDay(start)}</Text>
          </Pressable>
          {pickerOpen && (
            <DateTimePicker
              value={new Date(start + "T12:00:00")}
              mode="date"
              display="default"
              onChange={(_, selected) => {
                setPickerOpen(false)
                if (selected) setStart(localDateStr(selected))
              }}
            />
          )}

          <Text style={styles.label}>For</Text>
          <View style={styles.chipWrap}>
            {WEEKS.map((n) => (
              <Pressable key={n} style={[styles.chip, weeks === n && styles.chipSelected]} onPress={() => setWeeks(n)}>
                <Text style={[styles.chipText, weeks === n && styles.chipTextSelected]}>{n} week{n > 1 ? "s" : ""}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Reason (optional)</Text>
          <View style={styles.chipWrap}>
            {REASONS.map((r) => (
              <Pressable key={r} style={[styles.chip, reason === r && styles.chipSelected]} onPress={() => setReason(reason === r ? "" : r)}>
                <Text style={[styles.chipText, reason === r && styles.chipTextSelected]}>{r}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={[styles.input, styles.inputText, { marginTop: 8 }]}
            value={reason}
            onChangeText={setReason}
            placeholder="Or write one"
            placeholderTextColor={C.textMuted}
            maxLength={60}
          />

          <Text style={styles.summary}>
            {formatDay(pause.start)} – {formatDay(pause.end)} · plan now ends {formatDay(newEnd)}
          </Text>
          {problem && <Text style={styles.error}>{problem}</Text>}
          <Pressable
            style={[styles.submitBtn, (!!problem || saving) && { opacity: 0.5 }]}
            onPress={() => onSave(pause)}
            disabled={!!problem || saving}
          >
            {saving ? <ActivityIndicator color={C.bg} /> : <Text style={styles.submitBtnText}>Pause plan</Text>}
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  icon: { fontSize: 13, color: C.textSecondary },
  text: { flex: 1, fontSize: 13, fontWeight: "600", color: C.textPrimary, fontVariant: ["tabular-nums"] },
  reason: { fontWeight: "500", color: C.textSecondary },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center", padding: 24 },
  modal: { backgroundColor: C.surface, borderRadius: 18, padding: 20, width: "100%", maxWidth: 420, gap: 4 },
  closeBtn: {
    position: "absolute", top: 14, right: 14, zIndex: 1, width: 28, height: 28, borderRadius: 14,
    backgroundColor: C.surfaceHigh, alignItems: "center", justifyContent: "center",
  },
  closeBtnText: { fontSize: 13, fontWeight: "700", color: C.textSecondary },
  title: { fontSize: 18, fontWeight: "800", color: C.textPrimary, textAlign: "center", paddingHorizontal: 30 },
  sub: { fontSize: 13, color: C.textSecondary, lineHeight: 18, textAlign: "center", marginBottom: 4 },
  label: { fontSize: 13, fontWeight: "600", color: C.textSecondary, marginTop: 14, marginBottom: 8 },
  input: { backgroundColor: C.bg, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, paddingVertical: 12 },
  inputText: { fontSize: 14, color: C.textPrimary },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border },
  chipSelected: { backgroundColor: C.green, borderColor: C.green },
  chipText: { fontSize: 13, fontWeight: "600", color: C.textSecondary },
  chipTextSelected: { color: C.bg },
  summary: { fontSize: 12.5, color: C.textSecondary, textAlign: "center", marginTop: 16 },
  error: { fontSize: 12, color: "#E0837A", marginTop: 6, textAlign: "center" },
  submitBtn: { marginTop: 14, backgroundColor: C.green, borderRadius: 16, padding: 16, alignItems: "center" },
  submitBtnText: { fontSize: 16, fontWeight: "700", color: C.bg },
})
