import { C } from "@/utils/theme"
import { CheckinRow, saveCheckin } from "@/services/BoulderGraphService"
import { useEffect, useState } from "react"
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native"

const REST_LEVELS = [1, 2, 3, 4, 5]

interface Props {
  visible: boolean
  onDone: () => void
  // Dismiss without saving — e.g. the athlete taps the X to skip for now.
  // They can still fill it in later from Settings.
  onClose: () => void
  // Pre-fills the form when reopened after already checking in today (the
  // Settings entry point lets them revisit/correct it).
  initial?: CheckinRow | null
}

// Quick daily readiness check-in — how rested the athlete is and whether
// they've eaten — shown once per day before the Home screen content, and
// reachable any time after from Settings if they skipped it.
export function DailyCheckInModal({ visible, onDone, onClose, initial }: Props) {
  const [restRating, setRestRating] = useState<number | null>(null)
  const [ate, setAte] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!visible) return
    setRestRating(initial?.restRating ?? null)
    setAte(initial?.ate ?? null)
  }, [visible, initial])

  const canSubmit = restRating != null && ate != null

  async function handleSubmit() {
    if (!canSubmit || saving) return
    setSaving(true)
    try {
      await saveCheckin(restRating!, ate!)
      onDone()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={s.overlay}>
        <View style={s.card}>
          <Pressable style={s.closeBtn} onPress={onClose} hitSlop={8}>
            <Text style={s.closeBtnText}>✕</Text>
          </Pressable>

          <Text style={s.title}>How are you feeling today?</Text>
          <Text style={s.sub}>Quick check-in before you train</Text>

          <Text style={s.label}>How well rested are you?</Text>
          <View style={s.chipRow}>
            {REST_LEVELS.map((n) => {
              const sel = restRating === n
              return (
                <Pressable
                  key={n}
                  style={[s.chip, sel && s.chipSelected]}
                  onPress={() => setRestRating(n)}
                >
                  <Text style={[s.chipText, sel && s.chipTextSelected]}>{n}</Text>
                </Pressable>
              )
            })}
          </View>
          <View style={s.scaleLabels}>
            <Text style={s.scaleLabelText}>Exhausted</Text>
            <Text style={s.scaleLabelText}>Fully rested</Text>
          </View>

          <Text style={s.label}>Have you eaten today?</Text>
          <View style={s.toggleRow}>
            <Pressable
              style={[s.toggleBtn, ate === true && s.toggleBtnActive]}
              onPress={() => setAte(true)}
            >
              <Text style={[s.toggleBtnText, ate === true && s.toggleBtnTextActive]}>Yes</Text>
            </Pressable>
            <Pressable
              style={[s.toggleBtn, ate === false && s.toggleBtnActive]}
              onPress={() => setAte(false)}
            >
              <Text style={[s.toggleBtnText, ate === false && s.toggleBtnTextActive]}>Not yet</Text>
            </Pressable>
          </View>

          <Pressable
            style={[s.submitBtn, (!canSubmit || saving) && { opacity: 0.4 }]}
            onPress={handleSubmit}
            disabled={!canSubmit || saving}
          >
            {saving ? <ActivityIndicator color={C.bg} /> : <Text style={s.submitBtnText}>Continue</Text>}
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center", alignItems: "center", padding: 24,
  },
  card: {
    backgroundColor: C.surface, borderRadius: 18, padding: 20,
    width: "100%", maxWidth: 420, gap: 4,
  },
  closeBtn: {
    position: "absolute", top: 12, right: 12, zIndex: 1,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: C.surfaceHigh, alignItems: "center", justifyContent: "center",
  },
  closeBtnText: { fontSize: 13, fontWeight: "700", color: C.textSecondary },
  title: { fontSize: 18, fontWeight: "800", color: C.textPrimary, textAlign: "center", paddingHorizontal: 30 },
  sub: { fontSize: 13, color: C.textSecondary, lineHeight: 18, textAlign: "center", marginBottom: 8 },
  label: { fontSize: 13, fontWeight: "600", color: C.textSecondary, marginTop: 14, marginBottom: 8 },
  chipRow: { flexDirection: "row", gap: 8 },
  chip: {
    flex: 1, alignItems: "center", justifyContent: "center",
    paddingVertical: 12, borderRadius: 12,
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
  },
  chipSelected: { backgroundColor: C.green, borderColor: C.green },
  chipText: { fontSize: 15, fontWeight: "700", color: C.textSecondary },
  chipTextSelected: { color: C.bg },
  scaleLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  scaleLabelText: { fontSize: 11, color: C.textMuted },
  toggleRow: { flexDirection: "row", gap: 8 },
  toggleBtn: {
    flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 12,
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
  },
  toggleBtnActive: { backgroundColor: C.green, borderColor: C.green },
  toggleBtnText: { fontSize: 14, fontWeight: "700", color: C.textSecondary },
  toggleBtnTextActive: { color: C.bg },
  submitBtn: { marginTop: 24, backgroundColor: C.green, borderRadius: 16, padding: 16, alignItems: "center" },
  submitBtnText: { fontSize: 16, fontWeight: "700", color: C.bg },
})
