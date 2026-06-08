import { C } from "@/utils/theme"
import type { SessionBar } from "@/utils/athleteAnalytics"
import { ScrollView, StyleSheet, Text, View } from "react-native"
import { Pressable } from "react-native"

// A row of vertical bars — one per session, each split top-to-bottom into
// adaptation-colored segments (sized by minutes). Bar height is the session's
// total volume relative to the tallest. Same color language as the assignment
// day-timeline bars.
export function SessionBarsChart({
  bars,
  maxHeight = 150,
  onPressBar,
}: {
  bars: SessionBar[]
  maxHeight?: number
  onPressBar?: (bar: SessionBar) => void
}) {
  const maxMin = Math.max(1, ...bars.map((b) => b.totalMin))

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {bars.map((bar) => {
        const h = Math.max(8, (bar.totalMin / maxMin) * maxHeight)
        return (
          <Pressable key={bar.sessionId} style={styles.col} onPress={() => onPressBar?.(bar)}>
            <View style={[styles.track, { height: maxHeight }]}>
              <View style={[styles.bar, { height: h }]}>
                {bar.segments.map((seg, i) => (
                  <View key={i} style={{ flex: seg.min, backgroundColor: seg.color }} />
                ))}
              </View>
            </View>
            <Text style={styles.label} numberOfLines={1}>{bar.label}</Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingTop: 4, paddingHorizontal: 2 },
  col: { alignItems: "center", width: 24 },
  track: { width: 22, justifyContent: "flex-end" },
  bar: { width: 22, borderRadius: 5, overflow: "hidden", backgroundColor: C.surfaceHigh },
  label: { fontSize: 9, color: C.textMuted, marginTop: 5 },
})
