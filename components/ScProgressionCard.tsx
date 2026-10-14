import { C } from "@/utils/theme"
import type { CoachExerciseView } from "@/utils/scCoach"
import { Ionicons } from "@expo/vector-icons"
import React from "react"
import { StyleSheet, Text, View } from "react-native"

// ─── Progression (coach) ──────────────────────────────────────────────────────

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" })
}

// What the app did with this exercise: warnings first (deload, stalled,
// swapped to an easier exercise), then each recent session as
// suggested → did → result.
export function ScProgressionCard({ view }: { view: CoachExerciseView }) {
  const warnings: { icon: React.ComponentProps<typeof Ionicons>["name"]; color: string; text: string }[] = []
  if (view.flags.deload) warnings.push({ icon: "trending-down", color: C.red, text: "Went down two sessions in a row — consider backing off. The athlete isn't told; the app keeps its normal suggestion." })
  if (view.flags.stalled) warnings.push({ icon: "pause-circle-outline", color: C.yellow, text: "Same load three sessions running — consider changing the exercise or the rep target." })
  for (const sw of view.swaps.slice(0, 3)) {
    warnings.push({ icon: "swap-horizontal", color: C.yellow, text: `${shortDate(sw.date)}: swapped to ${sw.to} after missing the minimum reps — add an easier version to this exercise's ladder.` })
  }
  if (view.rows.length === 0 && warnings.length === 0) return null
  return (
    <View style={progStyles.card}>
      <Text style={progStyles.title}>Progression</Text>
      {warnings.map((w, i) => (
        <View key={i} style={[progStyles.warning, { borderColor: w.color }]}>
          <Ionicons name={w.icon} size={18} color={w.color} />
          <Text style={progStyles.warningText}>{w.text}</Text>
        </View>
      ))}
      {view.rows.map((r, i) => (
        <View key={i} style={[progStyles.row, i === view.rows.length - 1 && { borderBottomWidth: 0 }]}>
          <Text style={progStyles.rowHead}>
            {shortDate(r.date)}{r.focusLabel ? ` · ${r.focusLabel}` : ""}{r.exerciseName ? ` · ${r.exerciseName}` : ""}
          </Text>
          {!!r.suggested && <Text style={progStyles.line}><Text style={progStyles.lineLabel}>Suggested  </Text>{r.suggested}</Text>}
          <Text style={progStyles.line}><Text style={progStyles.lineLabel}>Did  </Text>{r.did}</Text>
          <Text style={progStyles.line}><Text style={progStyles.lineLabel}>Result  </Text>{r.result}</Text>
        </View>
      ))}
    </View>
  )
}

const progStyles = StyleSheet.create({
  card: { backgroundColor: C.surface, borderRadius: 16, padding: 16, gap: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  title: { fontSize: 12, fontWeight: "700", color: C.green, textTransform: "uppercase", letterSpacing: 0.6 },
  warning: { flexDirection: "row", gap: 10, alignItems: "flex-start", borderWidth: 1, borderRadius: 12, padding: 10 },
  warningText: { flex: 1, fontSize: 13, lineHeight: 18, color: C.textPrimary },
  row: { gap: 3, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  rowHead: { fontSize: 13, fontWeight: "700", color: C.textPrimary },
  line: { fontSize: 13, color: C.textSecondary, lineHeight: 18 },
  lineLabel: { fontWeight: "700", color: C.textMuted },
})

