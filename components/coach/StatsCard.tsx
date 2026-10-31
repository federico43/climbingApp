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
  const running = localDateStr(new Date()) <= p.windowEnd
  return `${shortDay(p.windowStart)}${p.focus ? ` · ${PLAN_FOCUS_LABEL[p.focus]}` : ""}${running ? " · now" : ""}`
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
  // Space inside the card: padding 16 and border 1 on each side.
  const inner = width - 34
  // Panels: two side by side on wide screens with a 10 gap. A chart inside
  // one gets what's left after the panel's padding 12 and border 1.
  const panelOuter = Math.floor(wide ? (inner - 10) / 2 : inner)
  const panelWidth = panelOuter - 26
  // Tiles keep one width, so an odd last tile doesn't stretch across the row.
  const cols = wide ? 4 : 2
  const tileWidth = width > 0 ? Math.floor((inner - 10 * (cols - 1)) / cols) : undefined

  return (
    <>
      <View style={styles.grid}>
        {metrics.map((m) => (
          <Tile key={m.id} metric={m} width={tileWidth} selected={m.id === selected?.id} onPress={() => setSelectedId(m.id)} />
        ))}
      </View>
      {metrics.length > 1 && <Text style={styles.hint}>Tap a tile to see its trend.</Text>}
      {width > 0 && selected && selected.points.length > 0 && <TrendChart metric={selected} width={inner} />}

      {width > 0 && patterns.length > 0 && (
        <>
          <Text style={styles.section}>S&C · by movement pattern</Text>
          <View style={styles.panels}>
            {patterns.map((p) => (
              <PatternPanel key={`${periodKey}:${p.pattern}`} stats={p} outer={panelOuter} width={panelWidth} startOpen={patterns.length === 1} />
            ))}
          </View>
        </>
      )}

      {width > 0 && (stats.projects.length > 0 || stats.warmups.length > 0) && (
        <>
          <Text style={styles.section}>Blocks</Text>
          <View style={styles.panels}>
            {stats.projects.length > 0 && <ProjectPanel sessions={stats.projects} outer={panelOuter} width={panelWidth} />}
            {stats.warmups.length > 0 && <WarmupPanel sessions={stats.warmups} outer={panelOuter} width={panelWidth} />}
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
      <Text style={[styles.periodText, active && styles.periodTextActive]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
        {label}
      </Text>
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

function Tile({ metric, width, selected, onPress }: {
  metric: StatMetric
  width?: number
  selected: boolean
  onPress: () => void
}) {
  const change = statChange(metric)
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.tile, width ? { width } : { flexBasis: "47%", flexGrow: 1 }, selected && styles.tileSelected]}
    >
      {/* Small phones: shrink to fit instead of cutting "102.5 kg" to "102…". */}
      <Text style={styles.tileLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{metric.label}</Text>
      <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{change?.value ?? "—"}</Text>
      <Text style={styles.tileFrom} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{change?.from ?? "No data yet"}</Text>
      {change && <ChangePill trend={change.trend} text={change.delta} />}
    </Pressable>
  )
}

// The charts get exactly the width they're drawn in, with no room kept for
// the hidden y-axis labels, so on a phone the last point (the one the coach
// reads) and its value aren't cut off at the right edge.
const EDGE = 18

function TrendChart({ metric, width }: { metric: StatMetric; width: number }) {
  const values = metric.points.map((p) => p.value)
  const max = Math.max(...values, 1)
  const min = Math.min(...values)
  const n = metric.points.length
  // Lines start a bit under the lowest point so small changes are visible.
  const offset = metric.unit === "workouts" ? 0 : Math.max(0, Math.floor(min - (max - min || 1) * 0.5))
  const spacing = n > 1 ? (width - 2 * EDGE) / (n - 1) : 0
  const shown = labelEvery(n, spacing)
  const barGap = n > 8 ? 6 : 12
  const barWidth = Math.max(4, Math.min(36, (width - 2 * barGap - barGap * (n - 1)) / n))

  return (
    <View style={styles.chart}>
      <Text style={styles.chartTitle}>{metric.label}</Text>
      {metric.unit === "workouts" ? (
        <BarChart
          data={metric.points.map((p) => ({ value: p.value, label: p.label, topLabelComponent: () => <Text style={styles.pointText}>{p.value}</Text> }))}
          width={width}
          height={120}
          barWidth={barWidth}
          spacing={barGap}
          initialSpacing={barGap}
          endSpacing={barGap}
          frontColor={C.green}
          barBorderRadius={6}
          maxValue={max + 1}
          noOfSections={3}
          hideYAxisText
          yAxisLabelWidth={0}
          yAxisThickness={0}
          xAxisThickness={1}
          xAxisColor={C.border}
          hideRules
          xAxisLabelTextStyle={[styles.axisText, labelBox(barWidth + barGap)]}
          disableScroll
        />
      ) : (
        <LineChart
          data={metric.points.map((p, i) => {
            const text = shown(i) ? formatStatValue(metric.unit, p.value) : ""
            return {
              value: p.value - offset,
              label: shown(i) ? p.label : "",
              dataPointText: text,
              // Centred over its point, but kept inside the chart at both ends.
              textShiftX: valueShift(text, i, n),
            }
          })}
          width={width}
          height={120}
          initialSpacing={EDGE}
          endSpacing={EDGE}
          spacing={spacing}
          color={C.green}
          thickness={2.5}
          maxValue={(max - offset) * 1.25}
          noOfSections={3}
          hideYAxisText
          yAxisLabelWidth={0}
          yAxisThickness={0}
          xAxisThickness={1}
          xAxisColor={C.border}
          hideRules
          xAxisLabelTextStyle={[styles.axisText, labelBox(spacing)]}
          dataPointsRadius={4}
          dataPointsColor={C.green}
          textShiftY={-10}
          textFontSize={11}
          textColor={C.textSecondary}
          disableScroll
        />
      )}
    </View>
  )
}

// Rough width of a value label at font size 11.
const CHAR_PX = 6.3

function valueShift(text: string, i: number, n: number): number {
  const w = text.length * CHAR_PX
  if (n > 1 && i === n - 1) return Math.min(-w / 2, EDGE - w)
  if (i === 0) return Math.max(-w / 2, -EDGE)
  return -w / 2
}

// The library gives each x-axis label only the space between two points, so
// "Oct 14" got cut to "Oct…" when points sit close. Give it a fixed box,
// centred on its point; labelEvery keeps neighbours from touching.
function labelBox(slot: number) {
  return { width: LABEL_PX, marginLeft: (slot - LABEL_PX) / 2, textAlign: "center" as const }
}

// ─── S&C: one panel per movement pattern ─────────────────────────────────────

// Folded to one line (how many exercises, how many got better or worse)
// so many patterns stay short; tap to open. Open: exercise chips on top
// (many exercises scroll sideways), then one row per focus the exercise was
// done at: its own line, now vs then.
function PatternPanel({ stats, outer, width, startOpen }: { stats: ScPatternStats; outer: number; width: number; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen)
  const [exerciseId, setExerciseId] = useState(stats.exercises[0].id)
  const exercise = stats.exercises.find((e) => e.id === exerciseId) ?? stats.exercises[0]
  const trends = { up: 0, same: 0, down: 0 }
  for (const e of stats.exercises) {
    for (const { metric } of focusMetrics(e)) {
      const change = metric.points.length > 1 ? statChange(metric) : null
      if (change) trends[change.trend]++
    }
  }
  const count = `${stats.exercises.length} exercise${stats.exercises.length === 1 ? "" : "s"}`
  const summary = [count, trends.up && `${trends.up} better`, trends.down && `${trends.down} worse`].filter(Boolean).join(" · ")
  return (
    <View style={[styles.panel, { width: outer }]}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={styles.panelToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.panelTitle}>{MOVEMENT_TYPE_LABEL[stats.pattern]}</Text>
          <Text style={styles.panelSub} numberOfLines={1}>{summary}</Text>
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={C.textSecondary} />
      </Pressable>
      {!open ? null : stats.exercises.length > 1 ? (
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
      {open && focusMetrics(exercise).map(({ focus, metric }) => {
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
  const spacing = metric.points.length > 1 ? (width - 2 * EDGE) / (metric.points.length - 1) : 0
  const shown = labelEvery(metric.points.length, spacing)
  return (
    <LineChart
      data={metric.points.map((p, i) => ({ value: p.value - offset, label: shown(i) ? p.label : "" }))}
      width={width}
      height={48}
      initialSpacing={EDGE}
      endSpacing={EDGE}
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
      xAxisLabelTextStyle={[styles.axisText, labelBox(spacing)]}
      dataPointsRadius={3}
      dataPointsColor={color}
      disableScroll
    />
  )
}

// With many points close together, label only every few (always the last,
// the one the coach reads) so "Oct 6" labels don't run into each other.
const LABEL_PX = 44

function labelEvery(n: number, spacing: number): (i: number) => boolean {
  const every = spacing > 0 ? Math.max(1, Math.ceil(LABEL_PX / spacing)) : 1
  return (i) => (n - 1 - i) % every === 0
}

// ─── Blocks ───────────────────────────────────────────────────────────────────

const BAR = 22
const BAR_GAP = 14

// Many sessions don't fit on a phone: the bars scroll sideways, starting at
// the latest one.
function barsScroll(n: number, width: number): boolean {
  return 16 + n * BAR + (n - 1) * BAR_GAP > width
}

// One bar per session: height = minutes on the project, colour = the grade
// worked, a check above it when the project went down.
function ProjectPanel({ sessions, outer, width }: { sessions: ProjectSessionStat[]; outer: number; width: number }) {
  const max = Math.max(...sessions.map((s) => s.minutes))
  const sends = sessions.filter((s) => s.sent).length
  return (
    <View style={[styles.panel, { width: outer }]}>
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
        width={width}
        height={110}
        barWidth={BAR}
        spacing={BAR_GAP}
        initialSpacing={8}
        endSpacing={8}
        barBorderRadius={5}
        maxValue={max * 1.3}
        noOfSections={3}
        hideYAxisText
        yAxisLabelWidth={0}
        yAxisThickness={0}
        xAxisThickness={1}
        xAxisColor={C.border}
        hideRules
        xAxisLabelTextStyle={[styles.axisText, labelBox(BAR + BAR_GAP)]}
        disableScroll={!barsScroll(sessions.length, width)}
        scrollToEnd
      />
      <View style={styles.legend}>
        <Text style={styles.legendText}>Bar = minutes · colour = grade</Text>
        <Ionicons name="checkmark-circle" size={13} color={C.green} />
        <Text style={styles.legendText}>sent</Text>
      </View>
    </View>
  )
}

function WarmupPanel({ sessions, outer, width }: { sessions: WarmupSessionStat[]; outer: number; width: number }) {
  const max = Math.max(...sessions.map((s) => s.minutes))
  const first = sessions[0].minutes
  const last = sessions[sessions.length - 1].minutes
  const diff = last - first
  return (
    <View style={[styles.panel, { width: outer }]}>
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
        width={width}
        height={110}
        barWidth={BAR}
        spacing={BAR_GAP}
        initialSpacing={8}
        endSpacing={8}
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
        xAxisLabelTextStyle={[styles.axisText, labelBox(BAR + BAR_GAP)]}
        disableScroll={!barsScroll(sessions.length, width)}
        scrollToEnd
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
    minWidth: 0, gap: 4, padding: 12, borderRadius: 14,
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
  panels: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 10 },
  panel: {
    width: "100%", gap: 10, padding: 12, borderRadius: 14,
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
  },
  panelToggle: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40 },
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
  hint: { marginTop: -4, fontSize: 11, color: C.textMuted },
})
