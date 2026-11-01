import { C } from "@/utils/theme"
import { blockReview, STAT_FOCUS_COLOR, type PeriodStats, type StatTrend } from "@/utils/athleteStats"
import { Ionicons } from "@expo/vector-icons"
import { StyleSheet, Text, View } from "react-native"

// One training block, start → end: how many things got better, stayed or
// got worse, then each of them (docs/athlete-stats.md §6). Shared by the
// coach's Stats card and the athlete's Plan page.
export function BlockReviewView({ stats, title, subtitle }: { stats: PeriodStats; title: string; subtitle: string }) {
  const review = blockReview(stats)
  return (
    <View style={styles.wrap}>
      <View style={{ gap: 2 }}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>

      <View style={styles.counts}>
        <Count n={review.better} label="Better" color={C.green} />
        <Count n={review.same} label="Same" color={C.textSecondary} />
        <Count n={review.worse} label="Worse" color={DOWN} />
      </View>

      {(review.workouts || review.projectSessions > 0) && (
        <View style={styles.facts}>
          {review.workouts && (
            <View style={styles.fact}>
              <Ionicons name="calendar-outline" size={15} color={C.textSecondary} />
              <Text style={styles.factText}>{review.workouts.value} workouts</Text>
            </View>
          )}
          {review.projectSessions > 0 && (
            <View style={styles.fact}>
              <Ionicons name="checkmark-circle" size={15} color={review.projectsSent ? C.green : C.textSecondary} />
              <Text style={styles.factText}>
                {review.projectsSent} of {review.projectSessions} project session{review.projectSessions === 1 ? "" : "s"} sent
              </Text>
            </View>
          )}
        </View>
      )}

      {review.rows.length === 0 ? (
        <Text style={styles.empty}>Not enough logged in this block to compare yet. Each thing needs at least two sessions.</Text>
      ) : (
        <View style={styles.list}>
          {review.rows.map((r, i) => (
            <View key={r.id} style={[styles.row, i === review.rows.length - 1 && { borderBottomWidth: 0 }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.rowName} numberOfLines={2}>
                  {r.name}
                  {r.detail && r.focus && <Text style={{ color: STAT_FOCUS_COLOR[r.focus] }}>{`  ${r.detail}`}</Text>}
                </Text>
                <Text style={styles.rowChange}>{r.change.start ? `${r.change.start} → ${r.change.value}` : r.change.value}</Text>
              </View>
              <Pill trend={r.change.trend} text={r.change.delta} />
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

const DOWN = "#F07A74"

const PILL: Record<StatTrend, { bg: string; fg: string }> = {
  up: { bg: "rgba(111,207,151,0.14)", fg: C.green },
  down: { bg: "rgba(219,80,74,0.16)", fg: DOWN },
  same: { bg: C.surfaceHigh, fg: C.textSecondary },
}

function Pill({ trend, text }: { trend: StatTrend; text: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: PILL[trend].bg }]}>
      <Text style={[styles.pillText, { color: PILL[trend].fg }]}>{text}</Text>
    </View>
  )
}

function Count({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <View style={styles.count}>
      <Text style={[styles.countN, { color }]}>{n}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  title: { fontSize: 17, fontWeight: "800", color: C.textPrimary },
  subtitle: { fontSize: 13, color: C.textSecondary },
  counts: { flexDirection: "row", gap: 8 },
  count: {
    flex: 1, alignItems: "center", gap: 2, paddingVertical: 10, borderRadius: 14,
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
  },
  countN: { fontSize: 24, fontWeight: "800" },
  countLabel: { fontSize: 12, color: C.textSecondary },
  facts: { gap: 6 },
  fact: { flexDirection: "row", alignItems: "center", gap: 6 },
  factText: { fontSize: 13, color: C.textPrimary },
  empty: { fontSize: 13, color: C.textMuted },
  list: { borderRadius: 14, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border,
  },
  rowName: { fontSize: 14, fontWeight: "700", color: C.textPrimary },
  rowChange: { fontSize: 13, color: C.textSecondary },
  pill: { flexShrink: 0, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  pillText: { fontSize: 12, fontWeight: "700" },
})
