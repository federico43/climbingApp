import { C } from "@/utils/theme"
import { card } from "@/components/coach/styles"
import {
  formatStatValue, SAMPLE_STATS, statChange,
  type StatMetric, type StatsPeriod, type StatTrend,
} from "@/utils/athleteStats"
import { useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { BarChart, LineChart } from "react-native-gifted-charts"

// Coach dashboard: how the athlete is progressing (docs/athlete-stats.md).
// A tile per metric (now vs the start of the period); tapping one shows its
// trend below. Sample data until the logic in §4 of the doc is built.
export function StatsCard({ columns }: { columns: 2 | 3 }) {
  const [period, setPeriod] = useState<StatsPeriod>("block")
  const [selectedId, setSelectedId] = useState("edge_lift_max")
  const [chartWidth, setChartWidth] = useState(0)

  const metrics = SAMPLE_STATS[period]
  const selected = metrics.find((m) => m.id === selectedId) ?? metrics[0]

  return (
    <View style={card.card} onLayout={(e) => setChartWidth(e.nativeEvent.layout.width - 32)}>
      <View style={card.headerRow}>
        <Text style={card.title}>Stats</Text>
        <Text style={styles.sample}>Sample data</Text>
      </View>

      <View style={styles.periods}>
        <PeriodPill label="This block" active={period === "block"} onPress={() => setPeriod("block")} />
        <PeriodPill label="All blocks" active={period === "all"} onPress={() => setPeriod("all")} />
      </View>

      <View style={styles.grid}>
        {metrics.map((m) => (
          <Tile
            key={m.id}
            metric={m}
            columns={columns}
            selected={m.id === selected.id}
            onPress={() => setSelectedId(m.id)}
          />
        ))}
      </View>

      {chartWidth > 0 && <TrendChart metric={selected} width={chartWidth} />}
    </View>
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

function Tile({ metric, columns, selected, onPress }: {
  metric: StatMetric
  columns: 2 | 3
  selected: boolean
  onPress: () => void
}) {
  const change = statChange(metric)
  const pill = PILL[change?.trend ?? "same"]
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.tile, { flexBasis: columns === 3 ? "31%" : "47%" }, selected && styles.tileSelected]}
    >
      <Text style={styles.tileLabel} numberOfLines={1}>{metric.label}</Text>
      <Text style={styles.tileValue} numberOfLines={1}>{change?.value ?? "—"}</Text>
      <Text style={styles.tileFrom} numberOfLines={1}>{change?.from ?? "No data yet"}</Text>
      {change && (
        <View style={[styles.pill, { backgroundColor: pill.bg }]}>
          <Text style={[styles.pillText, { color: pill.fg }]}>{change.delta}</Text>
        </View>
      )}
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
})
