import { C } from "@/utils/theme"
import { BlockReviewView } from "@/components/BlockReviewView"
import type { ProtocolRow, SessionRow, TrainingPlanRow } from "@/services/BoulderGraphService"
import { blockReview } from "@/utils/athleteStats"
import { buildBlockStats, shortDay, type StatsLibraryExercise } from "@/utils/athleteStatsData"
import { localDateStr, PLAN_FOCUS_LABEL } from "@/utils/planRotation"
import { Ionicons } from "@expo/vector-icons"
import { useMemo, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"

// Athlete's Plan page: their block so far (or finished), start → now, the
// same review the coach sees (docs/athlete-stats.md §6). Folded to one line
// until tapped.
export function BlockProgressCard({ plan, workouts, sessions, library, edgeLiftMaxLog }: {
  plan: TrainingPlanRow
  workouts: ProtocolRow[]
  sessions: SessionRow[]
  library: StatsLibraryExercise[]
  edgeLiftMaxLog?: string | null
}) {
  const [open, setOpen] = useState(false)
  const today = localDateStr(new Date())
  const stats = useMemo(
    () => buildBlockStats({ athlete: { edgeLiftMaxLog }, sessions, library, today, plan, planWorkouts: workouts }),
    [edgeLiftMaxLog, sessions, library, today, plan, workouts],
  )
  const review = blockReview(stats)
  const over = today > plan.windowEnd
  const summary = review.rows.length === 0
    ? "Shows up after a couple of sessions"
    : [review.better && `${review.better} better`, review.same && `${review.same} same`, review.worse && `${review.worse} worse`]
      .filter(Boolean).join(" · ")

  return (
    <View style={styles.card}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={styles.head}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.title}>{over ? "Block review" : "How this block is going"}</Text>
          <Text style={styles.summary}>{summary}</Text>
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={C.textSecondary} />
      </Pressable>
      {open && (
        <BlockReviewView
          stats={stats}
          title={plan.focus ? `${PLAN_FOCUS_LABEL[plan.focus]} block` : plan.name}
          subtitle={`${shortDay(plan.windowStart)} → ${over ? shortDay(plan.windowEnd) : "today"}`}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.surface, borderRadius: 18, borderWidth: 1, borderColor: C.border, padding: 16, gap: 14 },
  head: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  title: { fontSize: 15, fontWeight: "700", color: C.textPrimary },
  summary: { fontSize: 13, color: C.textSecondary },
})
