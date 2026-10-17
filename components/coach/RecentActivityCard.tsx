import { C } from "@/utils/theme"
import { groupByDay, sessionDayKey } from "@/components/AthleteRecentSessionsSummary"
import { card } from "@/components/coach/styles"
import { SessionRow } from "@/services/BoulderGraphService"
import { formatMinutes } from "@/utils/workoutSummary"
import { Ionicons } from "@expo/vector-icons"
import { useMemo, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"

const PAGE = 5

// Total minutes from a session's blockDurations (seconds per block), if saved.
function sessionMinutes(s: SessionRow): number {
  try {
    const d = JSON.parse(s.blockDurations ?? "{}")
    const secs = Object.values(d).reduce<number>((a, v) => a + (Number(v) || 0), 0)
    return Math.round(secs / 60)
  } catch { return 0 }
}

// The athlete's last training days, newest first: what blocks they did and
// for how long. Tap a day for the full session (SessionDetailModal).
export function RecentActivityCard({ sessions, onOpenDay }: {
  sessions: SessionRow[]
  onOpenDay: (dateKey: string) => void
}) {
  const [count, setCount] = useState(PAGE)
  const days = useMemo(() => groupByDay(sessions, count), [sessions, count])
  const minutesBy = useMemo(() => new Map(sessions.map((s) => [s.$id, sessionMinutes(s)])), [sessions])
  const totalDays = useMemo(() => new Set(sessions.map(sessionDayKey)).size, [sessions])

  return (
    <View style={card.card}>
      <Text style={card.title}>Recent activity</Text>
      {days.length === 0 && <Text style={card.empty}>No sessions logged yet.</Text>}
      {days.map((day) => {
        const minutes = day.sessions.reduce((a, s) => a + (minutesBy.get(s.id) ?? 0), 0)
        const blocks = day.sessions.flatMap((s) => s.blocks)
        return (
          <Pressable key={day.dateKey} style={styles.row} onPress={() => onOpenDay(day.dateKey)}>
            <View style={styles.dateCol}>
              <Text style={styles.date}>{day.dateLabel}</Text>
              {minutes > 0 && <Text style={styles.minutes}>{formatMinutes(minutes)}</Text>}
              {day.sessions.length > 1 && <Text style={styles.minutes}>{day.sessions.length} sessions</Text>}
            </View>
            <View style={styles.blocks}>
              {blocks.length === 0 ? (
                <Text style={card.empty}>No blocks logged</Text>
              ) : blocks.map((b, i) => (
                <View key={i} style={[styles.chip, { borderLeftColor: b.color }]}>
                  <Text style={styles.chipText} numberOfLines={1}>{b.blockName}</Text>
                </View>
              ))}
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
          </Pressable>
        )
      })}
      {totalDays > count && (
        <Pressable onPress={() => setCount((c) => c + PAGE)} hitSlop={6}>
          <Text style={card.link}>Show more</Text>
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.border },
  dateCol: { width: 92, gap: 2 },
  date: { fontSize: 12.5, fontWeight: "700", color: C.textPrimary },
  minutes: { fontSize: 11.5, color: C.textSecondary },
  blocks: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 5 },
  chip: { backgroundColor: C.surfaceHigh, borderRadius: 6, borderLeftWidth: 3, paddingHorizontal: 7, paddingVertical: 3, maxWidth: 160 },
  chipText: { fontSize: 11.5, fontWeight: "600", color: C.textSecondary },
})
