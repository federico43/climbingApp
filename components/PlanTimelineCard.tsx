import { Card, CardTitle, DayCircle, Mono, ProgressBar, TimelineLegend, usePaper, WeekPill } from "@/components/paper"
import type { DayState } from "@/components/paper"
import { ProtocolRow, SessionRow, TrainingPlanRow } from "@/services/BoulderGraphService"
import { daysLeft, planDays, sessionLocalDate, trainedDaysIn } from "@/utils/planProgress"
import { resolveAdaptation, type Adaptation } from "@/utils/adaptations"
import { benchmarkComparison } from "@/utils/benchmark"
import { font } from "@/theme/paper/tokens"
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
  squares,
}: {
  plan: TrainingPlanRow
  sessions: SessionRow[]
  // Coach dashboard (design chat 2026-11-22): the square day grid — each
  // trained day shows what was trained, homework days outlined in pink.
  squares?: boolean
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

  if (squares) {
    return <SquaresTimeline plan={plan} sessions={sessions} homework={homework} today={today} statusLine={statusLine} left={over ? null : left} />
  }

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

// ─── Square day grid (coach) ─────────────────────────────────────────────

// What a trained day shows: its main climbing adaptation, else S&C, else
// the first block's. Paper Mint has no red or yellow, so the three main
// types differ by fill: strength ink, power endurance mint, power blue.
const SHORT: Partial<Record<Adaptation, string>> = {
  strength: "STR", power: "PWR", power_endurance: "PE", conditioning: "S&C",
  technique: "TEC", balance: "BAL", fear_management: "FEAR", test: "TEST",
}
const LONG: Partial<Record<Adaptation, string>> = {
  strength: "Strength", power: "Power", power_endurance: "Power endurance", conditioning: "S&C",
  technique: "Technique", balance: "Balance", fear_management: "Fear", test: "Test",
}
const MAIN_FIRST: Adaptation[] = ["strength", "power_endurance", "power"]

function sessionAdaptation(s: SessionRow): Adaptation | null {
  let blocks: any[] = []
  try { blocks = JSON.parse(s.protocol || "[]") } catch { return null }
  if (!Array.isArray(blocks) || blocks.length === 0) return null
  const all = blocks.map((b) => resolveAdaptation(b ?? {}))
  return MAIN_FIRST.find((a) => all.includes(a))
    ?? (all.includes("conditioning") ? "conditioning" : all.find((a) => a !== "general") ?? null)
}

function SquaresTimeline({ plan, sessions, homework, today, statusLine, left }: {
  plan: TrainingPlanRow; sessions: SessionRow[]; homework: ProtocolRow[]; today: string; statusLine: string; left: number | null
}) {
  const t = usePaper()
  const { windowStart, windowEnd, pauses } = plan
  const days = planDays(windowStart, windowEnd)
  const weeks: string[][] = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))

  // Day → what was trained (the day's first session that says).
  const trainedAs = new Map<string, Adaptation | null>()
  for (const sess of sessions) {
    const d = sessionLocalDate(sess)
    if (d < windowStart || d > windowEnd) continue
    const a = sessionAdaptation(sess)
    if (!trainedAs.has(d) || (trainedAs.get(d) == null && a)) trainedAs.set(d, a)
  }
  // Homework still to do on a picked day: ahead = planned, passed = missed.
  const hwDays = new Map<string, "planned" | "missed">()
  for (const hw of homework) {
    if (!hw.scheduledFor || hw.homeworkStatus === "cant_attend" || sessions.some((x) => x.protocolId === hw.$id)) continue
    const d = localDateStr(new Date(hw.scheduledFor))
    hwDays.set(d, d < today ? "missed" : "planned")
  }
  const bench = benchmarkComparison(sessions, windowStart)
  const benchDays = new Set([bench?.first.date, bench?.last?.date].filter(Boolean) as string[])

  const fill = (a: Adaptation | null) => {
    if (a === "strength") return { bg: t.ink, fg: t.paper, border: t.ink }
    if (a === "power_endurance") return { bg: t.mint, fg: t.onMint, border: t.mode === "light" ? t.ink : t.mint }
    if (a === "power") return { bg: t.blockBlue, fg: "#FFFFFF", border: t.blockBlue }
    return { bg: t.card, fg: t.ink, border: t.ink }
  }
  const seen = new Set<Adaptation | null>(trainedAs.values())
  const kinds = ([...MAIN_FIRST, "conditioning", "technique", "balance", "fear_management", "test"] as Adaptation[]).filter((a) => seen.has(a))
  const hwKinds = new Set(hwDays.values())

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <Mono color={t.ink} size={11}>Timeline</Mono>
        <Mono color={t.ink}>{left === null ? statusLine : `${statusLine} · ${left} day${left !== 1 ? "s" : ""} left`}</Mono>
      </View>
      <Text style={{ fontFamily: font.body, fontSize: 13, color: t.textMuted, marginTop: 4, marginBottom: 12 }}>
        Each trained day shows what was trained.
      </Text>

      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 6 }}>
          <View style={{ width: 46 }} />
          {weeks[0]?.map((d) => (
            <View key={d} style={{ flex: 1, alignItems: "center" }}>
              <Mono size={9.5}>{weekdayShort(d)}</Mono>
            </View>
          ))}
        </View>
        {weeks.map((week, w) => {
          const current = week.includes(today)
          return (
            <View
              key={w}
              style={[
                { flexDirection: "row", gap: 6, paddingHorizontal: 6, paddingVertical: 5, borderRadius: 14 },
                current && { backgroundColor: "rgba(138,214,162,0.16)", borderWidth: 1, borderColor: "rgba(47,158,99,0.35)" },
              ]}
            >
              <View style={{ width: 46, justifyContent: "center", gap: 1 }}>
                <Text style={{ fontFamily: font.mono, fontSize: 10.5, color: t.ink }}>{rowLabel(week, pauses, windowStart).replace(/^W/, "WK ")}</Text>
                <Text style={{ fontFamily: font.mono, fontSize: 9, color: t.label }}>{monthDay(week[0])}</Text>
              </View>
              {week.map((d) => {
                const trained = trainedAs.has(d)
                const a = trainedAs.get(d) ?? null
                const hw = hwDays.get(d)
                const paused = !!pauseOn(pauses, d)
                const f = trained ? fill(a) : null
                return (
                  <View
                    key={d}
                    accessibilityLabel={`${d}${trained ? `, trained${a && LONG[a] ? ` ${LONG[a]}` : ""}` : ""}${hw ? `, homework ${hw}` : ""}${d === today ? ", today" : ""}`}
                    style={[
                      {
                        flex: 1, height: 44, borderRadius: 8, alignItems: "center", justifyContent: "center",
                        borderWidth: 1, borderColor: t.hairline,
                        backgroundColor: d < today && !trained ? t.inputFill : "transparent",
                      },
                      paused && !trained && { backgroundColor: t.inputFill, opacity: 0.5 },
                      hw && !trained && { borderWidth: 2, borderColor: t.pink, borderStyle: hw === "missed" ? "dashed" : "solid" },
                      f && { backgroundColor: f.bg, borderColor: f.border, borderWidth: 1.5 },
                      d === today && { borderWidth: 2.5, borderColor: t.ink },
                    ]}
                  >
                    <Text style={{ fontFamily: font.mono, fontSize: 11.5, color: f ? f.fg : hw ? t.pink : t.label }}>{Number(d.slice(8))}</Text>
                    {trained && a && SHORT[a] && (
                      <Text style={{ fontFamily: font.mono, fontSize: 8.5, letterSpacing: 0.6, color: f!.fg }}>{SHORT[a]}</Text>
                    )}
                    {benchDays.has(d) && (
                      <View style={{ position: "absolute", top: 4, right: 4, width: 6, height: 6, borderRadius: 3, backgroundColor: f ? f.fg : t.ink }} />
                    )}
                  </View>
                )
              })}
            </View>
          )
        })}
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 14 }}>
        {kinds.map((a) => {
          const f = fill(a)
          return <LegendItem key={a} label={`${LONG[a]} · ${SHORT[a]}`} swatch={{ backgroundColor: f.bg, borderColor: f.border, borderWidth: 1.5 }} />
        })}
        {hwKinds.has("planned") && <LegendItem label="Homework" swatch={{ borderWidth: 2, borderColor: t.pink }} />}
        {hwKinds.has("missed") && <LegendItem label="Missed homework" swatch={{ borderWidth: 2, borderColor: t.pink, borderStyle: "dashed" }} />}
        <LegendItem label="Today" swatch={{ borderWidth: 2.5, borderColor: t.ink }} />
        {benchDays.size > 0 && <LegendItem label="Benchmark" dot />}
      </View>
    </Card>
  )
}

function LegendItem({ label, swatch, dot }: { label: string; swatch?: object; dot?: boolean }) {
  const t = usePaper()
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
      {dot
        ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.ink }} />
        : <View style={[{ width: 16, height: 16, borderRadius: 5 }, swatch]} />}
      <Text style={{ fontFamily: font.bodyBold, fontSize: 12.5, color: t.textMuted }}>{label}</Text>
    </View>
  )
}

function weekdayShort(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short" })
}

function monthDay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}
