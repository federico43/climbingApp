import { C } from "@/utils/theme"
import { protocolMinutes, type CardioProtocol } from "@/utils/cardio"
import { IntervalStats } from "@/components/IntervalVisuals"
import { Ionicons } from "@expo/vector-icons"
import { StyleSheet, Text, View } from "react-native"

// Building blocks for the jump rope screens: the session as three big
// numbers (series · jump · rest) and short notes with an icon instead of
// plain lines.

type IconName = React.ComponentProps<typeof Ionicons>["name"]

export type CardioNote = { icon: IconName; text: string; tone?: "info" | "warn" }

/** A card with the session's three numbers, its strip and its total time. */
export function ProtocolCard({ p, kicker }: { p: CardioProtocol; kicker?: string }) {
  const extra = p.triplesOrHeavy
    ? "Triples or a heavy rope"
    : p.doublesEverySec ? `Doubles or crosses every ${p.doublesEverySec}s` : null
  return (
    <View style={s.card}>
      {kicker ? <Text style={s.cardKicker}>{kicker}</Text> : null}
      <IntervalStats series={p.series} workSec={p.workSec} restSec={p.restSec} workLabel="jump" />
      <View style={s.footRow}>
        <Ionicons name="time-outline" size={14} color={C.textSecondary} />
        <Text style={s.foot}>About {protocolMinutes(p)} min</Text>
        {extra ? (
          <View style={s.tag}>
            <Ionicons name="flash" size={12} color={C.yellow} />
            <Text style={s.tagText}>{extra}</Text>
          </View>
        ) : null}
      </View>
    </View>
  )
}

export function NoteRow({ note }: { note: CardioNote }) {
  const warn = note.tone === "warn"
  return (
    <View style={[s.note, warn && s.noteWarn]}>
      <View style={[s.noteIcon, warn && { backgroundColor: "rgba(254,215,102,0.14)" }]}>
        <Ionicons name={note.icon} size={18} color={warn ? C.yellow : C.green} />
      </View>
      <Text style={s.noteText}>{note.text}</Text>
    </View>
  )
}

/** Numbered steps, for the starting test. */
export function StepList({ steps }: { steps: { title: string; text: string }[] }) {
  return (
    <View style={s.card}>
      {steps.map((st, i) => (
        <View key={st.title} style={s.stepRow}>
          <View style={s.stepRail}>
            <View style={s.stepNum}><Text style={s.stepNumText}>{i + 1}</Text></View>
            {i < steps.length - 1 && <View style={s.stepLine} />}
          </View>
          <View style={s.stepBody}>
            <Text style={s.stepTitle}>{st.title}</Text>
            <Text style={s.stepText}>{st.text}</Text>
          </View>
        </View>
      ))}
    </View>
  )
}

const s = StyleSheet.create({
  card: { width: "100%", backgroundColor: C.surface, borderRadius: 18, borderWidth: 1, borderColor: C.border, padding: 18, gap: 16 },
  cardKicker: { fontSize: 12, fontWeight: "800", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 1 },
  footRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  foot: { fontSize: 13, fontWeight: "600", color: C.textSecondary, marginRight: 6 },
  tag: {
    flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 10, backgroundColor: "rgba(254,215,102,0.12)",
  },
  tagText: { fontSize: 12, fontWeight: "700", color: C.yellow },
  note: {
    width: "100%", flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.surface,
    borderRadius: 14, borderWidth: 1, borderColor: C.border, paddingVertical: 12, paddingHorizontal: 14,
  },
  noteWarn: { borderColor: "rgba(254,215,102,0.35)" },
  noteIcon: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(111,207,151,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  noteText: { flex: 1, fontSize: 15, lineHeight: 21, color: C.textPrimary, fontWeight: "500" },
  stepRow: { flexDirection: "row", gap: 14 },
  stepRail: { alignItems: "center" },
  stepNum: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(111,207,151,0.14)",
    borderWidth: 1, borderColor: "rgba(111,207,151,0.4)", alignItems: "center", justifyContent: "center",
  },
  stepNumText: { fontSize: 14, fontWeight: "800", color: C.green },
  stepLine: { flex: 1, width: 2, minHeight: 14, marginVertical: 4, backgroundColor: C.surfaceHigh },
  stepBody: { flex: 1, gap: 3, paddingBottom: 14 },
  stepTitle: { fontSize: 16, fontWeight: "800", color: C.textPrimary },
  stepText: { fontSize: 14, lineHeight: 20, color: C.textSecondary },
})
