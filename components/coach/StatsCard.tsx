import { C } from "@/utils/theme"
import { card } from "@/components/coach/styles"
import { BlockReviewView } from "@/components/BlockReviewView"
import type { useAthleteStats } from "@/hooks/useAthleteStats"
import type { TrainingPlanRow } from "@/services/BoulderGraphService"
import {
  focusMetrics, formatStatValue, isEmptyPeriod, SAMPLE_STATS, STAT_FOCUS_COLOR, STAT_FOCUS_LABEL, statChange, visiblePatterns,
  type PeriodStats, type ProjectSessionStat, type ScPatternStats, type StatMetric, type StatsPeriod, type StatTrend,
  type WarmupSessionStat,
} from "@/utils/athleteStats"
import { shortDay } from "@/utils/athleteStatsData"
import { localDateStr, PLAN_FOCUS_LABEL, PLAN_WEEKS, planWeek } from "@/utils/planRotation"
import { BoulderLevelOptions } from "@/utils/boulderColours"
import { MOVEMENT_TYPE_LABEL } from "@/utils/movementTypes"
import { Ionicons } from "@expo/vector-icons"
import { useEffect, useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { BarChart, LineChart } from "react-native-gifted-charts"

type Tab = StatsPeriod | "review"

// Coach dashboard: how the athlete is progressing (docs/athlete-stats.md).
// Tiles for the headline numbers (tap one for its trend), then S&C by
// movement pattern and the project / 1 on 1 off blocks; Reviews shows one
// block start → end. With nothing logged yet, the sample data can be
// previewed.
export function StatsCard({ columns, data }: { columns: 2 | 3; data: ReturnType<typeof useAthleteStats> }) {
  const { blockStats, allStats, reviewPlans, statsForPlan, loadPlans, loadingPlans, plansLoaded } = data
  // null = not picked yet: This block when there is one.
  const [tab, setTab] = useState<Tab | null>(null)
  const [sample, setSample] = useState(false)
  const [reviewId, setReviewId] = useState<string | null>(null)
  const [width, setWidth] = useState(0)
  const wide = columns === 3

  // No active block: start on All blocks. Every plan loads the first time
  // All blocks or Reviews is opened.
  const current: Tab = (tab ?? "block") === "block" && !blockStats ? "all" : tab ?? "block"
  useEffect(() => {
    if (current !== "block") loadPlans()
  }, [current, loadPlans])

  const reviewPlan = reviewPlans.find((p) => p.$id === reviewId) ?? reviewPlans[0]

  return (
    <View style={card.card} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={card.headerRow}>
        <Text style={card.title}>Stats</Text>
        {sample && current !== "review" && (
          <Pressable onPress={() => setSample(false)} hitSlop={8} accessibilityRole="button">
            <Text style={styles.sample}>Sample data · hide</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.periods}>
        {blockStats && <PeriodPill label="This block" active={current === "block"} onPress={() => setTab("block")} />}
        <PeriodPill label="All blocks" active={current === "all"} onPress={() => setTab("all")} />
        <PeriodPill label="Reviews" active={current === "review"} onPress={() => setTab("review")} />
      </View>

      {current === "review" ? (
        loadingPlans || !plansLoaded ? <ActivityIndicator color={C.green} />
          : !reviewPlan ? <Text style={card.empty}>No training plans yet.</Text>
            : (
              <>
                {reviewPlans.length > 1 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                    {reviewPlans.map((p) => {
                      const active = p.$id === reviewPlan.$id
                      return (
                        <Pressable
                          key={p.$id}
                          onPress={() => setReviewId(p.$id)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          style={[styles.chip, active && styles.chipActive]}
                        >
                          <Text style={[styles.chipText, active && styles.chipTextActive]}>{planChipLabel(p)}</Text>
                        </Pressable>
                      )
                    })}
                  </ScrollView>
                )}
                <BlockReviewView stats={statsForPlan(reviewPlan)} title={planTitle(reviewPlan)} subtitle={planStatus(reviewPlan)} />
              </>
            )
      ) : (
        <PeriodView
          stats={sample ? SAMPLE_STATS[current] : current === "block" ? blockStats : allStats}
          loading={current === "all" && !sample && (loadingPlans || !plansLoaded)}
          wide={wide}
          width={width}
          periodKey={`${current}:${sample}`}
          onSample={() => setSample(true)}
        />
      )}
    </View>
  )
}

function planTitle(p: TrainingPlanRow): string {
  return p.focus ? `${PLAN_FOCUS_LABEL[p.focus]} block` : p.name
}

function planChipLabel(p: TrainingPlanRow): string {
  return `${shortDay(p.windowStart)}${p.focus ? ` · ${PLAN_FOCUS_LABEL[p.focus]}` : ""}`
}

function planStatus(p: TrainingPlanRow): string {
  const today = localDateStr(new Date())
  const dates = `${shortDay(p.windowStart)} → ${shortDay(p.windowEnd)}`
  if (today > p.windowEnd) return `${dates} · finished`
  const week = Math.min(Math.max(planWeek(p.windowStart, today, p.pauses), 1), PLAN_WEEKS)
  return `${dates} · week ${week} of ${PLAN_WEEKS}, so far`
}

function PeriodView({ stats, loading, wide, width, periodKey, onSample }: {
  stats: PeriodStats | null
  loading: boolean
  wide: boolean
  width: number
  periodKey: string
  onSample: () => void
}) {
  const [selectedId, setSelectedId] = useState("edge_lift_max")
  if (loading) return <ActivityIndicator color={C.green} />
  if (!stats || isEmptyPeriod(stats)) {
    return (
      <View style={{ gap: 10 }}>
        <Text style={card.empty}>Nothing logged yet to compare.</Text>
        <Pressable onPress={onSample} style={card.outlineBtn} accessibilityRole="button">
          <Ionicons name="eye-outline" size={14} color={C.green} />
          <Text style={card.outlineBtnText}>Preview with sample data</Text>
        </Pressable>
      </View>
    )
  }

  // Tiles with nothing logged are left out (Workouts always shows).
  const metrics = stats.metrics.filter((m) => m.unit === "workouts" || m.points.length > 0)
  const selected = metrics.find((m) => m.id === selectedId) ?? metrics[0]
  const patterns = visiblePatterns(stats.sc)
  // Inner width of a panel: card padding 16, panel padding 12; two side by
  // side on wide screens with a 10 gap.
  const panelWidth = wide ? (width - 32 - 10) / 2 - 24 : width - 32 - 24

  return (
    <>
      <View style={styles.grid}>
        {metrics.map((m) => (
          <Tile key={m.id} metric={m} columns={wide ? 4 : 2} selected={m.id === selected?.id} onPress={() => setSelectedId(m.id)} />
        ))}
      </View>
      {width > 0 && selected && selected.points.length > 0 && <TrendChart metric={selected} width={width - 32} />}

      {width > 0 && patterns.length > 0 && (
        <>
          <Text style={styles.section}>S&C · by movement pattern</Text>
          <View style={styles.panels}>
            {patterns.map((p) => (
              <PatternPanel key={`${periodKey}:${p.pattern}`} stats={p} wide={wide} width={panelWidth} />
            ))}
          </View>
        </>
      )}

      {width > 0 && (stats.projects.length > 0 || stats.warmups.length > 0) && (
        <>
          <Text style={styles.section}>Blocks</Text>
          <View style={styles.panels}>
            {stats.projects.length > 0 && <ProjectPanel sessions={stats.projects} wide={wide} width={panelWidth} />}
            {stats.warmups.length > 0 && <WarmupPanel sessions={stats.warmups} wide={wide} width={panelWidth} />}
          </View>
        </>
      )}
    </>
  )
}

function PeriodPill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.period, active && styles.periodActive]}
    >
      <Text style={[styles.periodText, active && styles.periodTextActive]}>{label}</Text>
    </Pressable>
  )
}

const PILL: Record<StatTrend, { bg: string; fg: string }> = {
  up: { bg: "rgba(111,207,151,0.14)", fg: C.green },
  down: { bg: "rgba(219,80,74,0.16)", fg: "#F07A74" },
  same: { bg: C.surfaceHigh, fg: C.textSecondary },
}

function ChangePill({ trend, text }: { trend: StatTrend; text: string }) {
  const pill = PILL[trend]
  return (
    <View style={[styles.pill, { backgroundColor: pill.bg }]}>
      <Text style={[styles.pillText, { color: pill.fg }]}>{text}</Text>
    </View>
  )
}

function Tile({ metric, columns, selected, onPress }: {
  metric: StatMetric
  columns: 2 | 4
  selected: boolean
  onPress: () => void
}) {
  const change = statChange(metric)
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.tile, { flexBasis: columns === 4 ? "22%" : "47%" }, selected && styles.tileSelected]}
    >
      <Text style={styles.tileLabel} numberOfLines={1}>{metric.label}</Text>
      <Text style={styles.tileValue} numberOfLines={1}>{change?.value ?? "—"}</Text>
      <Text style={styles.tileFrom} numberOfLines={1}>{change?.from ?? "No data yet"}</Text>
      {change && <ChangePill trend={change.trend} text={change.delta} />}
    </Pressable>
  )
}

function TrendChart({ metric, width }: { metric: StatMetric; width: number }) {
  const values = metric.points.map((p) => p.value)
  const max = Math.max(...values, 1)
  const min = Math.min(...values)
  // Lines start a bit under the lowest point so small changes are visible.
  const offset = metric.unit === "workouts" ? 0 : Math.max(0, Math.floor(min - (max - min || 1) * 0.5))
  const spacing = metric.points.length > 1 ? (width - 60) / (metric.points.length - 1) : 0

  return (
    <View style={styles.chart}>
      <Text style={styles.chartTitle}>{metric.label}</Text>
      {metric.unit === "workouts" ? (
        <BarChart
          data={metric.points.map((p) => ({ value: p.value, label: p.label, topLabelComponent: () => <Text style={styles.pointText}>{p.value}</Text> }))}
          width={width - 40}
          height={120}
          barWidth={Math.min(36, (width - 80) / metric.points.length - 12)}
          spacing={12}
          frontColor={C.green}
          barBorderRadius={6}
          maxValue={max + 1}
          noOfSections={3}
          hideYAxisText
          yAxisThickness={0}
          xAxisThickness={1}
          xAxisColor={C.border}
          hideRules
          xAxisLabelTextStyle={styles.axisText}
          disableScroll
        />
      ) : (
        <LineChart
          data={metric.points.map((p) => ({ value: p.value - offset, label: p.label, dataPointText: formatStatValue(metric.unit, p.value) }))}
          width={width - 40}
          height={120}
          initialSpacing={16}
          endSpacing={16}
          spacing={spacing}
          color={C.green}
          thickness={2.5}
          maxValue={(max - offset) * 1.25}
          noOfSections={3}
          hideYAxisText
          yAxisThickness={0}
          xAxisThickness={1}
          xAxisColor={C.border}
          hideRules
          xAxisLabelTextStyle={styles.axisText}
          dataPointsRadius={4}
          dataPointsColor={C.green}
          textShiftY={-10}
          textShiftX={-12}
          textFontSize={11}
          textColor={C.textSecondary}
          disableScroll
        />
      )}
    </View>
  )
}

// ─── S&C: one panel per movement pattern ─────────────────────────────────────

// Exercise chips on top (many exercises scroll sideways), then one row per
// focus the exercise was done at: its own line, now vs then.
function PatternPanel({ stats, wide, width }: { stats: ScPatternStats; wide: boolean; width: number }) {
  const [exerciseId, setExerciseId] = useState(stats.exercises[0].id)
  const exercise = stats.exercises.find((e) => e.id === exerciseId) ?? stats.exercises[0]
  return (
    <View style={[styles.panel, wide && styles.panelHalf]}>
      <Text style={styles.panelTitle}>{MOVEMENT_TYPE_LABEL[stats.pattern]}</Text>
      {stats.exercises.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {stats.exercises.map((e) => {
            const active = e.id === exercise.id
            return (
              <Pressable
                key={e.id}
                onPress={() => setExerciseId(e.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{e.name}</Text>
              </Pressable>
            )
          })}
        </ScrollView>
      ) : (
        <Text style={styles.panelSub}>{exercise.name}</Text>
      )}
      {focusMetrics(exercise).map(({ focus, metric }) => {
        const change = statChange(metric)
        if (!change) return null
        return (
          <View key={focus} style={styles.focusRow}>
            <View style={styles.focusHead}>
              <View style={[styles.dot, { backgroundColor: STAT_FOCUS_COLOR[focus] }]} />
              <Text style={[styles.focusLabel, { color: STAT_FOCUS_COLOR[focus] }]}>{STAT_FOCUS_LABEL[focus]}</Text>
              <View style={{ flex: 1 }} />
              <ChangePill trend={change.trend} text={change.delta} />
            </View>
            <Text style={styles.focusValue}>
              {change.value}<Text style={styles.focusFrom}>  {change.from}</Text>
            </Text>
            <Sparkline metric={metric} color={STAT_FOCUS_COLOR[focus]} width={width} />
          </View>
        )
      })}
    </View>
  )
}

function Sparkline({ metric, color, width }: { metric: StatMetric; color: string; width: number }) {
  const values = metric.points.map((p) => p.value)
  const max = Math.max(...values)
  const min = Math.min(...values)
  const offset = min - (max - min || Math.max(1, Math.abs(min))) * 0.5
  const spacing = metric.points.length > 1 ? (width - 40) / (metric.points.length - 1) : 0
  return (
    <LineChart
      data={metric.points.map((p) => ({ value: p.value - offset, label: p.label }))}
      width={width - 8}
      height={48}
      initialSpacing={12}
      endSpacing={12}
      spacing={spacing}
      color={color}
      thickness={2}
      maxValue={(max - offset) * 1.15}
      noOfSections={2}
      hideYAxisText
      yAxisLabelWidth={0}
      yAxisThickness={0}
      xAxisThickness={1}
      xAxisColor={C.border}
      hideRules
      xAxisLabelTextStyle={styles.axisText}
      dataPointsRadius={3}
      dataPointsColor={color}
      disableScroll
    />
  )
}

// ─── Blocks ───────────────────────────────────────────────────────────────────

const BAR = 22
const BAR_GAP = 14

// One bar per session: height = minutes on the project, colour = the grade
// worked, a check above it when the project went down.
function ProjectPanel({ sessions, wide, width }: { sessions: ProjectSessionStat[]; wide: boolean; width: number }) {
  const max = Math.max(...sessions.map((s) => s.minutes))
  const sends = sessions.filter((s) => s.sent).length
  return (
    <View style={[styles.panel, wide && styles.panelHalf]}>
      <View style={styles.panelHead}>
        <Text style={styles.panelTitle}>Project bouldering</Text>
        <Text style={styles.panelMeta}>{sends} sent</Text>
      </View>
      <BarChart
        data={sessions.map((s) => {
          const level = BoulderLevelOptions.find((o) => o.value === s.grade)
          return {
            value: s.minutes,
            label: s.label,
            frontColor: level?.color ?? C.textSecondary,
            // Black bars would vanish on the dark background.
            ...(s.grade === "black" ? { barBorderWidth: 1, barBorderColor: C.textSecondary } : {}),
            topLabelComponent: () => s.sent
              ? <Ionicons name="checkmark-circle" size={16} color={C.green} style={{ marginBottom: 2 }} />
              : <Text style={styles.pointText}>{s.minutes}</Text>,
          }
        })}
        width={width - 8}
        height={110}
        barWidth={BAR}
        spacing={BAR_GAP}
        initialSpacing={8}
        barBorderRadius={5}
        maxValue={max * 1.3}
        noOfSections={3}
        hideYAxisText
        yAxisLabelWidth={0}
        yAxisThickness={0}
        xAxisThickness={1}
        xAxisColor={C.border}
        hideRules
        xAxisLabelTextStyle={[styles.axisText, { width: BAR + BAR_GAP, marginLeft: -BAR_GAP / 2 }]}
        disableScroll={sessions.length * (BAR + BAR_GAP) < width}
      />
      <View style={styles.legend}>
        <Text style={styles.legendText}>Bar = minutes · colour = grade</Text>
        <Ionicons name="checkmark-circle" size={13} color={C.green} />
        <Text style={styles.legendText}>sent</Text>
      </View>
    </View>
  )
}

function WarmupPanel({ sessions, wide, width }: { sessions: WarmupSessionStat[]; wide: boolean; width: number }) {
  const max = Math.max(...sessions.map((s) => s.minutes))
  const first = sessions[0].minutes
  const last = sessions[sessions.length - 1].minutes
  const diff = last - first
  return (
    <View style={[styles.panel, wide && styles.panelHalf]}>
      <View style={styles.panelHead}>
        <Text style={styles.panelTitle}>1 on 1 off</Text>
        {sessions.length > 1 && (
          <ChangePill trend={diff > 0 ? "up" : diff < 0 ? "down" : "same"} text={diff === 0 ? "= same" : `${diff > 0 ? "▲" : "▼"} ${Math.abs(diff)} min`} />
        )}
      </View>
      <BarChart
        data={sessions.map((s) => ({
          value: s.minutes,
          label: s.label,
          topLabelComponent: () => <Text style={styles.pointText}>{s.minutes}</Text>,
        }))}
        width={width - 8}
        height={110}
        barWidth={BAR}
        spacing={BAR_GAP}
        initialSpacing={8}
        frontColor={C.green}
        barBorderRadius={5}
        maxValue={max * 1.3}
        noOfSections={3}
        hideYAxisText
        yAxisLabelWidth={0}
        yAxisThickness={0}
        xAxisThickness={1}
        xAxisColor={C.border}
        hideRules
        xAxisLabelTextStyle={[styles.axisText, { width: BAR + BAR_GAP, marginLeft: -BAR_GAP / 2 }]}
        disableScroll={sessions.length * (BAR + BAR_GAP) < width}
      />
      <Text style={styles.legendText}>Minutes on per session</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  sample: { fontSize: 11, fontWeight: "700", color: C.yellow, textTransform: "uppercase", letterSpacing: 0.6 },
  periods: { flexDirection: "row", gap: 8 },
  period: {
    flex: 1, minHeight: 40, borderRadius: 10, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.bg, alignItems: "center", justifyContent: "center",
  },
  periodActive: { borderColor: C.green, backgroundColor: C.surfaceHigh },
  periodText: { fontSize: 13, fontWeight: "600", color: C.textSecondary },
  periodTextActive: { color: C.textPrimary, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: {
    flexGrow: 1, minWidth: 0, gap: 4, padding: 12, borderRadius: 14,
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
  },
  tileSelected: { borderColor: C.green },
  tileLabel: { fontSize: 11, fontWeight: "700", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.6 },
  tileValue: { fontSize: 22, fontWeight: "800", color: C.textPrimary },
  tileFrom: { fontSize: 12, color: C.textSecondary },
  pill: { alignSelf: "flex-start", marginTop: 2, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  pillText: { fontSize: 12, fontWeight: "700" },
  chart: { gap: 8, paddingTop: 4 },
  chartTitle: { fontSize: 13, fontWeight: "700", color: C.textPrimary },
  axisText: { fontSize: 10, color: C.textSecondary },
  pointText: { fontSize: 11, color: C.textSecondary, marginBottom: 4 },

  section: { marginTop: 6, fontSize: 12, fontWeight: "800", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.8 },
  panels: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  panel: {
    width: "100%", gap: 10, padding: 12, borderRadius: 14,
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
  },
  panelHalf: { width: "48.8%" },
  panelHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  panelTitle: { fontSize: 15, fontWeight: "700", color: C.textPrimary },
  panelSub: { fontSize: 13, color: C.textSecondary },
  panelMeta: { fontSize: 13, fontWeight: "600", color: C.green },
  chips: { gap: 6 },
  chip: { minHeight: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: C.border, justifyContent: "center" },
  chipActive: { borderColor: C.green, backgroundColor: C.surfaceHigh },
  chipText: { fontSize: 12.5, fontWeight: "600", color: C.textSecondary },
  chipTextActive: { color: C.textPrimary },
  focusRow: { gap: 4, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border },
  focusHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  focusLabel: { fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6 },
  focusValue: { fontSize: 18, fontWeight: "800", color: C.textPrimary },
  focusFrom: { fontSize: 12, fontWeight: "400", color: C.textSecondary },
  legend: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendText: { fontSize: 11, color: C.textSecondary },
})
