import { Card, CardTitle, DayCircle, Mono, ProgressBar, TimelineLegend, usePaper, WeekPill } from "@/components/paper"
import type { DayState } from "@/components/paper"
import { ProtocolRow, SessionRow, TrainingPlanRow } from "@/services/BoulderGraphService"
import { daysLeft, planDays, trainedDaysIn } from "@/utils/planProgress"
import { localDateStr, PLAN_WEEKS, planWeek } from "@/utils/planRotation"
import { pauseOn, type PlanPause } from "@/utils/planPauses"
import { Ionicons } from "@expo/vector-icons"
import { Text, View } from "react-native"

// The plan's timeline: start → end, status, days left and the 6-week day
// grid (trained / today / to come / homework / paused days). The athlete sees it on
// their Plan page; the coach sees the very same card on the dashboard
// (docs/coach-dashboard.md §4.6). Paper Mint (docs/design-system.md §5).

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
}: {
  plan: TrainingPlanRow
  sessions: SessionRow[]
  // The athlete's homework rows (planPart "homework"); their picked days
  // show on the grid like events.
  homework: ProtocolRow[]
}) {
  const t = usePaper()
  const today = localDateStr(new Date())
  const { windowStart, windowEnd, pauses } = plan
  const notStarted = today < windowStart
  const over = today > windowEnd
  const week = Math.min(Math.max(planWeek(windowStart, today, pauses), 1), PLAN_WEEKS)
  const left = daysLeft(windowStart, windowEnd, today, pauses)
  const pausedNow = pauseOn(pauses, today)

  const days = planDays(windowStart, windowEnd)
  const elapsed = days.length ? days.filter((d) => d <= today).length / days.length : 0
  const trained = trainedDaysIn(windowStart, windowEnd, sessions)
  const homeworkDays = new Set(
    homework
      .filter((hw) => hw.scheduledFor && hw.homeworkStatus !== "cant_attend" && !sessions.some((s) => s.protocolId === hw.$id))
      .map((hw) => localDateStr(new Date(hw.scheduledFor!))),
  )

  const statusLine = notStarted
    ? `Starts ${shortDate(windowStart)}`
    : over
      ? "Plan finished"
      : pausedNow
        ? `Paused until ${shortDate(pausedNow.end)}`
        : `Week ${week} of ${PLAN_WEEKS}`

  const legend: DayState[] = ["trained", "today", "upcoming"]
  if (homeworkDays.size > 0) legend.push("homework")
  if (pauses.length > 0) legend.push("paused")

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <WeekPill>{statusLine}</WeekPill>
        {!over && <Mono color={t.ink}>{`${left} day${left !== 1 ? "s" : ""} left`}</Mono>}
      </View>

      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 12, marginTop: 16 }}>
        <DateBlock label="Start" dateStr={windowStart} />
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", paddingBottom: 18 }}>
          <View style={{ flex: 1, height: 1.5, backgroundColor: t.ink, marginRight: -4 }} />
          <Ionicons name="chevron-forward" size={14} color={t.ink} />
        </View>
        <DateBlock label="End" dateStr={windowEnd} alignEnd />
      </View>

      <ProgressBar progress={elapsed} style={{ marginTop: 14 }} />

      <View style={{ height: 1, backgroundColor: t.hairline, marginVertical: 16 }} />
      <DaysGrid days={days} trained={trained} homework={homeworkDays} today={today} pauses={pauses} windowStart={windowStart} />
      <View style={{ paddingLeft: 28 }}>
        <TimelineLegend states={legend} />
      </View>
    </Card>
  )
}

// One row per calendar week, one cell per day, starting on the plan's first
// day. A row is labelled with its plan week, or "–" when it's all paused.
function DaysGrid({ days, trained, homework, today, pauses, windowStart }: {
  days: string[]; trained: Set<string>; homework: Set<string>; today: string; pauses: PlanPause[]; windowStart: string
}) {
  const weeks: string[][] = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={{ width: 28 }} />
        {weeks[0]?.map((d) => (
          <View key={d} style={{ flex: 1, alignItems: "center" }}>
            <Mono size={9.5}>{weekdayLetter(d)}</Mono>
          </View>
        ))}
      </View>
      {weeks.map((week, w) => (
        <View key={w} style={{ flexDirection: "row", alignItems: "center" }}>
          <Mono size={9.5} style={{ width: 28 }}>{rowLabel(week, pauses, windowStart)}</Mono>
          {week.map((d) => {
            const state: DayState = trained.has(d)
              ? "trained"
              : d === today ? "today"
                : homework.has(d) ? "homework"
                  : pauseOn(pauses, d) ? "paused"
                    : d < today ? "past" : "upcoming"
            return (
              <View key={d} style={{ flex: 1, alignItems: "center" }}>
                <DayCircle state={state} size={28} />
              </View>
            )
          })}
        </View>
      ))}
    </View>
  )
}

function rowLabel(week: string[], pauses: PlanPause[], windowStart: string): string {
  const active = week.find((d) => !pauseOn(pauses, d))
  return active ? `W${planWeek(windowStart, active, pauses)}` : "–"
}

function DateBlock({ label, dateStr, alignEnd }: { label: string; dateStr: string; alignEnd?: boolean }) {
  const t = usePaper()
  const { weekday, day } = longDate(dateStr)
  return (
    <View style={alignEnd && { alignItems: "flex-end" }}>
      <Mono>{label}</Mono>
      <CardTitle size={24} style={{ marginTop: 4 }}>{day}</CardTitle>
      <Text style={{ fontSize: 12, color: t.textMuted }}>{weekday}</Text>
    </View>
  )
}
