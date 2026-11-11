import { usePaper, usePaperStyles } from "@/components/paper"
import { font, type PaperTheme } from "@/theme/paper/tokens"
import { blockReview, STAT_FOCUS_COLOR, type PeriodStats, type StatTrend } from "@/utils/athleteStats"
import { Ionicons } from "@expo/vector-icons"
import { StyleSheet, Text, View } from "react-native"

// One training block, start → end: how many things got better, stayed or
// got worse, then each of them (docs/athlete-stats.md §6). Shared by the
// coach's Stats card and the athlete's Plan page.
export function BlockReviewView({ stats, title, subtitle }: { stats: PeriodStats; title: string; subtitle: string }) {
  const t = usePaper()
  const styles = usePaperStyles(makeStyles)
  const review = blockReview(stats)
  return (
    <View style={styles.wrap}>
      <View style={{ gap: 2 }}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>

      <View style={styles.counts}>
        <Count n={review.better} label="Better" color={t.mintText} />
        <Count n={review.same} label="Same" color={t.label} />
        <Count n={review.worse} label="Worse" color={t.ink} />
      </View>

      {(review.workouts || review.projectSessions > 0) && (
        <View style={styles.facts}>
          {review.workouts && (
            <View style={styles.fact}>
              <Ionicons name="calendar-outline" size={15} color={t.label} />
              <Text style={styles.factText}>{review.workouts.value} workouts</Text>
            </View>
          )}
          {review.projectSessions > 0 && (
            <View style={styles.fact}>
              <Ionicons name="checkmark-circle" size={15} color={review.projectsSent ? t.mintText : t.label} />
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

// Better = mint fill, worse = ink outline, same = faint: told apart by fill
// and outline, not hue (docs/design-system.md §8). No red in this system.
function Pill({ trend, text }: { trend: StatTrend; text: string }) {
  const t = usePaper()
  const styles = usePaperStyles(makeStyles)
  const look =
    trend === "up" ? { backgroundColor: t.mint, borderColor: t.mode === "dark" ? t.mint : t.ink }
    : trend === "down" ? { backgroundColor: "transparent", borderColor: t.ink }
    : { backgroundColor: "transparent", borderColor: t.hairline }
  return (
    <View style={[styles.pill, look]}>
      <Text style={[styles.pillText, { color: trend === "up" ? t.onMint : trend === "down" ? t.ink : t.label }]}>{text}</Text>
    </View>
  )
}

function Count({ n, label, color }: { n: number; label: string; color: string }) {
  const styles = usePaperStyles(makeStyles)
  return (
    <View style={styles.count}>
      <Text style={[styles.countN, { color }]}>{n}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  )
}

const makeStyles = (t: PaperTheme) => StyleSheet.create({
  wrap: { gap: 12 },
  title: { fontFamily: font.title, fontSize: 22, color: t.ink, textTransform: "uppercase" },
  subtitle: { fontFamily: font.mono, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", color: t.label },
  counts: { flexDirection: "row", gap: 8 },
  count: {
    flex: 1, alignItems: "center", gap: 2, paddingVertical: 10, borderRadius: 16,
    backgroundColor: t.inputFill, borderWidth: 1.5, borderColor: t.inputBorder,
  },
  countN: { fontFamily: font.title, fontSize: 30, lineHeight: 32 },
  countLabel: { fontFamily: font.mono, fontSize: 9.5, letterSpacing: 1.1, textTransform: "uppercase", color: t.label },
  facts: { gap: 6 },
  fact: { flexDirection: "row", alignItems: "center", gap: 6 },
  factText: { fontFamily: font.body, fontSize: 13, color: t.ink },
  empty: { fontFamily: font.body, fontSize: 13, color: t.textMuted },
  list: { borderRadius: 16, backgroundColor: t.inputFill, borderWidth: 1.5, borderColor: t.inputBorder, paddingHorizontal: 12 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: t.hairline,
  },
  rowName: { fontFamily: font.bodyBold, fontSize: 14, color: t.ink },
  rowChange: { fontFamily: font.body, fontSize: 13, color: t.textMuted },
  pill: { flexShrink: 0, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, borderWidth: 1.5 },
  pillText: { fontFamily: font.bold, fontSize: 12 },
})
