import { C } from "@/utils/theme"
import { ProtocolRow, SessionRow, TrainingPlanRow } from "@/services/BoulderGraphService"
import { ADAPTATION_COLOR } from "@/utils/adaptations"
import { daysLeft, donePlanWorkouts, planDays, trainedDaysIn } from "@/utils/planProgress"
import { homeworkBusyDays, scheduleFor } from "@/utils/planSchedule"
import { localDateStr, PLAN_WEEKS, planWeek } from "@/utils/planRotation"
import { Ionicons } from "@expo/vector-icons"
import { StyleSheet, Text, View } from "react-native"

// The plan's timeline: start → end, status, days left and the 6-week day
// grid (trained / today / to come / planned workouts / homework days). The athlete sees it on
// their Plan page; the coach sees the very same card on the dashboard
// (docs/coach-dashboard.md §4.6).

function shortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

// "Mon 21 Sep" — for the plan's start / end.
function longDate(dateStr: string): { weekday: string; day: string } {
  const [y, m, d] = dateStr.split("-").map(Number)
  const date = new Date(y, m - 1, d)
  return {
    weekday: date.toLocaleDateString(undefined, { weekday: "short" }),
    day: date.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
  }
}

function weekdayLetter(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "narrow" })
}

export function PlanTimelineCard({
  plan,
  sessions,
  homework,
  planWorkouts,
}: {
  plan: TrainingPlanRow
  sessions: SessionRow[]
  // The athlete's homework rows (planPart "homework"); their picked days
  // show on the grid like events.
  homework: ProtocolRow[]
  // The plan's built workouts; with them, the days the weekly scheduler
  // (utils/planSchedule.ts) puts the workouts still to do on are marked.
  planWorkouts?: ProtocolRow[]
}) {
  const today = localDateStr(new Date())
  const { windowStart, windowEnd } = plan
  const notStarted = today < windowStart
  const over = today > windowEnd
  const week = Math.min(Math.max(planWeek(windowStart, today), 1), PLAN_WEEKS)
  const left = daysLeft(windowStart, windowEnd, today)

  const days = planDays(windowStart, windowEnd)
  const trained = trainedDaysIn(windowStart, windowEnd, sessions)
  const homeworkDays = homeworkBusyDays(homework, sessions)
  const plannedDays = new Set(
    planWorkouts && !over
      ? scheduleFor(plan, donePlanWorkouts(plan.$id, planWorkouts, sessions), homework, sessions, new Date())
        .filter((s) => s.date && (s.state === "scheduled" || s.state === "moved"))
        .map((s) => s.date!)
      : [],
  )

  const focusColor = plan.focus ? ADAPTATION_COLOR[plan.focus] : C.textSecondary
  const statusLine = notStarted
    ? `Starts ${shortDate(windowStart)}`
    : over
      ? "Plan finished"
      : `Week ${week} of ${PLAN_WEEKS}`

  return (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <Text style={styles.cardTitle}>Timeline</Text>
        <Text style={[styles.cardHeaderValue, { color: focusColor }]}>
          {over ? "" : `${left} day${left !== 1 ? "s" : ""} left`}
        </Text>
      </View>
      <View style={styles.datesRow}>
        <DateBlock label="Start" dateStr={windowStart} />
        <View style={styles.datesLine}>
          <View style={[styles.datesLineFill, { backgroundColor: focusColor }]} />
          <Ionicons name="chevron-forward" size={14} color={focusColor} />
        </View>
        <DateBlock label="End" dateStr={windowEnd} alignEnd />
      </View>
      <View style={[styles.statusPill, { backgroundColor: `${focusColor}22` }]}>
        <Text style={[styles.statusPillText, { color: focusColor }]}>{statusLine}</Text>
      </View>
      <View style={styles.timelineDivider} />
      <DaysGrid days={days} trained={trained} homework={homeworkDays} planned={plannedDays} today={today} />
      <View style={styles.legend}>
        <LegendDot style={styles.cellTrained} label="Trained" />
        <LegendDot style={[styles.cellFuture, styles.cellToday]} label="Today" />
        <LegendDot style={styles.cellFuture} label="To come" />
        {plannedDays.size > 0 && <LegendDot style={[styles.cellFuture, styles.cellPlanned]} label="Workout" />}
        {homeworkDays.size > 0 && <LegendDot style={[styles.cellFuture, styles.cellHomework]} label="Homework" />}
      </View>
    </View>
  )
}

// One row per plan week, one cell per day, starting on the plan's first day.
function DaysGrid({ days, trained, homework, planned, today }: {
  days: string[]; trained: Set<string>; homework: Set<string>; planned: Set<string>; today: string
}) {
  const weeks: string[][] = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.gridRow}>
        <Text style={styles.gridWeekLabel} />
        {weeks[0]?.map((d) => (
          <Text key={d} style={styles.gridHeadText}>{weekdayLetter(d)}</Text>
        ))}
      </View>
      {weeks.map((week, w) => (
        <View key={w} style={styles.gridRow}>
          <Text style={styles.gridWeekLabel}>W{w + 1}</Text>
          {week.map((d) => {
            const isTrained = trained.has(d)
            const style = isTrained
              ? styles.cellTrained
              : d < today ? styles.cellPast : styles.cellFuture
            return (
              <View key={d} style={styles.gridCellWrap}>
                <View style={[
                  styles.cell, style,
                  planned.has(d) && !isTrained && styles.cellPlanned,
                  homework.has(d) && !isTrained && styles.cellHomework,
                  d === today && styles.cellToday,
                ]}>
                  {homework.has(d) && <View style={styles.cellHomeworkDot} />}
                </View>
              </View>
            )
          })}
        </View>
      ))}
    </View>
  )
}

function DateBlock({ label, dateStr, alignEnd }: { label: string; dateStr: string; alignEnd?: boolean }) {
  const { weekday, day } = longDate(dateStr)
  return (
    <View style={alignEnd && { alignItems: "flex-end" }}>
      <Text style={styles.dateLabel}>{label}</Text>
      <Text style={styles.dateDay}>{day}</Text>
      <Text style={styles.dateWeekday}>{weekday}</Text>
    </View>
  )
}

function LegendDot({ style, label }: { style: any; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, style]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    gap: 12,
  },
  cardTitle: { fontSize: 15, fontWeight: "700", color: C.textPrimary },
  cardHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardHeaderValue: { fontSize: 13, fontWeight: "600", color: C.green },

  datesRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 },
  datesLine: { flex: 1, flexDirection: "row", alignItems: "center" },
  datesLineFill: { flex: 1, height: 2, borderRadius: 1, opacity: 0.5, marginRight: -4 },
  dateLabel: { fontSize: 11, fontWeight: "600", color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.6 },
  dateDay: { marginTop: 2, fontSize: 17, fontWeight: "700", color: C.textPrimary },
  dateWeekday: { fontSize: 12, color: C.textSecondary },
  statusPill: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  statusPillText: { fontSize: 12.5, fontWeight: "700" },
  timelineDivider: { height: 1, backgroundColor: C.border, marginVertical: 2 },

  // Days grid
  gridRow: { flexDirection: "row", alignItems: "center" },
  gridWeekLabel: { width: 28, fontSize: 11, fontWeight: "600", color: C.textMuted },
  gridHeadText: { flex: 1, textAlign: "center", fontSize: 11, fontWeight: "600", color: C.textMuted },
  gridCellWrap: { flex: 1, alignItems: "center" },
  cell: { width: 26, height: 26, borderRadius: 13 },
  cellTrained: { backgroundColor: C.green },
  cellPast: { backgroundColor: C.surfaceHigh },
  cellFuture: { borderWidth: 1.5, borderColor: "rgba(255,255,255,0.16)" },
  cellToday: { borderWidth: 2, borderColor: C.green },
  cellPlanned: { backgroundColor: "rgba(255,255,255,0.10)", borderWidth: 2, borderColor: C.textSecondary },
  cellHomework: { borderWidth: 2, borderColor: ADAPTATION_COLOR.test },
  cellHomeworkDot: { position: "absolute", top: 8, left: 8, width: 6, height: 6, borderRadius: 3, backgroundColor: ADAPTATION_COLOR.test },
  legend: { flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 6, paddingLeft: 28 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  legendText: { fontSize: 11.5, color: C.textSecondary },
})
