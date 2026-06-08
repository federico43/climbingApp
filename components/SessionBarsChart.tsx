import { C } from "@/utils/theme"
import type { SessionBar } from "@/utils/athleteAnalytics"
import { Pressable, StyleSheet, Text, View } from "react-native"

function fmt(min: number): string {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60), r = min % 60
  return r ? `${h}h${r}` : `${h}h`
}

// One horizontal bar per session (newest first), split into adaptation-colored
// segments by minutes. Bar width = session volume relative to the biggest.
// Same color language as the assignment day-timeline bars.
export function SessionBarsChart({
  bars,
  onPressBar,
}: {
  bars: SessionBar[]
  onPressBar?: (bar: SessionBar) => void
}) {
  const maxMin = Math.max(1, ...bars.map((b) => b.totalMin))
  const ordered = [...bars].reverse() // newest first

  return (
    <View style={styles.list}>
      {ordered.map((bar) => (
        <Pressable key={bar.sessionId} style={styles.row} onPress={() => onPressBar?.(bar)}>
          <Text style={styles.date}>{bar.label}</Text>
          <View style={styles.track}>
            <View style={[styles.bar, { width: `${Math.max(6, (bar.totalMin / maxMin) * 100)}%` }]}>
              {bar.segments.map((seg, i) => (
                <View key={i} style={{ flex: seg.min, backgroundColor: seg.color }} />
              ))}
            </View>
          </View>
          <Text style={styles.total}>{fmt(bar.totalMin)}</Text>
        </Pressable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  list: { gap: 8, marginTop: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  date: { width: 38, fontSize: 11, color: C.textMuted, textAlign: "right" },
  track: { flex: 1, height: 18, borderRadius: 5, backgroundColor: C.surfaceHigh, overflow: "hidden" },
  bar: { flexDirection: "row", height: 18, borderRadius: 5, overflow: "hidden" },
  total: { width: 38, fontSize: 11, color: C.textSecondary },
})
