import { C } from "@/utils/theme"
import type { SessionBar } from "@/utils/athleteAnalytics"
import React from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"

function fmt(min: number): string {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60), r = min % 60
  return r ? `${h}h${r}` : `${h}h`
}

function dayGap(olderStr: string, newerStr: string): number {
  return Math.round((new Date(newerStr).getTime() - new Date(olderStr).getTime()) / 86400000)
}

function gapLabel(days: number): string {
  if (days <= 0) return "same day"
  return `${days} day${days !== 1 ? "s" : ""} rest`
}

// One horizontal bar per session (newest first), split into per-block segments
// (colored by adaptation, labeled with the block name) sized by minutes. Bar
// width = session volume relative to the biggest.
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
      {ordered.map((bar, i) => {
        const older = ordered[i + 1] // next row down = previous training
        const gap = older ? dayGap(older.dateStr, bar.dateStr) : null
        return (
          <React.Fragment key={bar.sessionId}>
            <Pressable style={styles.row} onPress={() => onPressBar?.(bar)}>
              <Text style={styles.date}>{bar.label}</Text>
              <View style={styles.track}>
                <View style={[styles.bar, { width: `${Math.max(8, (bar.totalMin / maxMin) * 100)}%` }]}>
                  {bar.segments.map((seg, j) => (
                    <View key={j} style={[styles.seg, { flex: seg.min, backgroundColor: seg.color }]}>
                      <Text style={styles.segText} numberOfLines={1}>{seg.name}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <Text style={styles.total}>{fmt(bar.totalMin)}</Text>
            </Pressable>

            {gap != null && (
              <View style={styles.gapRow}>
                <View style={styles.gapTickCol}><View style={styles.gapTick} /></View>
                <Text style={styles.gapText}>{gapLabel(gap)}</Text>
              </View>
            )}
          </React.Fragment>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  list: { gap: 4, marginTop: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  gapRow: { flexDirection: "row", alignItems: "center", gap: 8, height: 16 },
  gapTickCol: { width: 48, alignItems: "flex-end" },
  gapTick: { width: 2, height: 12, borderRadius: 1, backgroundColor: C.border },
  gapText: { fontSize: 10, color: C.textMuted, fontStyle: "italic" },
  date: { width: 48, fontSize: 11, color: C.textMuted, textAlign: "right" },
  track: { flex: 1, height: 26, borderRadius: 6, backgroundColor: C.surfaceHigh, overflow: "hidden" },
  bar: { flexDirection: "row", height: 26, borderRadius: 6, overflow: "hidden" },
  seg: { justifyContent: "center", alignItems: "center", paddingHorizontal: 4, overflow: "hidden" },
  segText: {
    fontSize: 10, fontWeight: "700", color: "#fff",
    textShadowColor: "rgba(0,0,0,0.55)", textShadowRadius: 2, textShadowOffset: { width: 0, height: 1 },
  },
  total: { width: 40, fontSize: 11, color: C.textSecondary },
})
