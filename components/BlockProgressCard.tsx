import { Card, CardTitle, Mono, usePaper } from "@/components/paper"
import { BlockReviewView } from "@/components/BlockReviewView"
import type { ProtocolRow, SessionRow, TrainingPlanRow } from "@/services/BoulderGraphService"
import { blockReview } from "@/utils/athleteStats"
import { buildBlockStats, shortDay, type StatsLibraryExercise } from "@/utils/athleteStatsData"
import { localDateStr, PLAN_FOCUS_LABEL } from "@/utils/planRotation"
import { Ionicons } from "@expo/vector-icons"
import { useMemo, useState } from "react"
import { Pressable, StyleSheet, View } from "react-native"

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
  const t = usePaper()
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
    <Card style={{ gap: 14 }}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={styles.head}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <View style={{ flex: 1, gap: 4 }}>
          <CardTitle size={22}>{over ? "Block review" : "How this block is going"}</CardTitle>
          <Mono>{summary}</Mono>
        </View>
        <View
          style={{
            width: 34, height: 34, borderRadius: 17, borderWidth: 1.5,
            borderColor: open ? (t.mode === "dark" ? t.mint : t.ink) : t.ghostBorder,
            backgroundColor: open ? t.mint : "transparent", alignItems: "center", justifyContent: "center",
          }}
        >
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={open ? t.onMint : t.ink} />
        </View>
      </Pressable>
      {open && (
        <BlockReviewView
          stats={stats}
          title={plan.kind === "conditioning" ? "Conditioning block" : plan.focus ? `${PLAN_FOCUS_LABEL[plan.focus]} block` : plan.name}
          subtitle={`${shortDay(plan.windowStart)} → ${over ? shortDay(plan.windowEnd) : "today"}`}
        />
      )}
    </Card>
  )
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
})
