import { C } from "@/utils/theme"
import { getSessions, getSessionsByUserId, SessionRow } from "@/services/BoulderGraphService"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useCallback, useEffect, useState } from "react"
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"
import { LineChart } from "react-native-gifted-charts"
import { ScProgressionCard } from "@/components/ScProgressionCard"
import { getExerciseLibrary } from "@/utils/exerciseLibraryCache"
import { coachExerciseView, type CoachExerciseView } from "@/utils/scCoach"
import { loadWeightUnit } from "@/utils/weightUnit"
import { SafeAreaView } from "react-native-safe-area-context"

// ─── Parsing helpers ──────────────────────────────────────────────────────────

function parseRepsNum(s: string): number | null {
  const m = s.match(/^(\d+(?:\.\d+)?) reps$/)
  if (m) return parseFloat(m[1])
  const b = s.match(/L\s*(\d+(?:\.\d+)?)\s*\/\s*R\s*(\d+(?:\.\d+)?)\s*reps/)
  if (b) return (parseFloat(b[1]) + parseFloat(b[2])) / 2
  return null
}

function parseWeightNum(s: string): number | null {
  const m = s.match(/^(\d+(?:\.\d+)?)(kg|lb)$/)
  if (m) return parseFloat(m[1])
  const b = s.match(/L\s*(\d+(?:\.\d+)?)\s*\/\s*R\s*(\d+(?:\.\d+)?)(kg|lb)/)
  if (b) return (parseFloat(b[1]) + parseFloat(b[2])) / 2
  return null
}

function parseRpeNum(s: string): number | null {
  const m = s.match(/^RPE\s*(\d+(?:\.\d+)?)$/)
  if (m) return parseFloat(m[1])
  const b = s.match(/RPE\s*L(\d+(?:\.\d+)?)\/R(\d+(?:\.\d+)?)/)
  if (b) return (parseFloat(b[1]) + parseFloat(b[2])) / 2
  return null
}

function avgOf(nums: number[]): number | null {
  if (!nums.length) return null
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface DayPoint {
  date: string
  shortLabel: string
  avgReps: number | null
  avgWeight: number | null
  avgRpe: number | null
}

// ─── Data builder ─────────────────────────────────────────────────────────────

function extractSCFields(a: any): { name: string; repsNum: number | null; weightNum: number | null; rpeNum: number | null } | null {
  if (a.type !== "strength_conditioning") return null

  if (a.scData) {
    const d = a.scData
    const name: string = d.exerciseName ?? ""
    if (!name) return null

    let repsNum: number | null = null
    if (d.repsCompleted != null) repsNum = parseFloat(d.repsCompleted) || null
    else if (d.repsLeft != null && d.repsRight != null)
      repsNum = (parseFloat(d.repsLeft) + parseFloat(d.repsRight)) / 2 || null

    let weightNum: number | null = null
    if (d.weight != null) weightNum = parseFloat(d.weight) || null
    else if (d.weightLeft != null && d.weightRight != null)
      weightNum = (parseFloat(d.weightLeft) + parseFloat(d.weightRight)) / 2 || null

    let rpeNum: number | null = null
    if (d.rpe != null) rpeNum = parseFloat(d.rpe) || null
    else if (d.rpeLeft != null && d.rpeRight != null)
      rpeNum = (parseFloat(d.rpeLeft) + parseFloat(d.rpeRight)) / 2 || null

    return { name, repsNum, weightNum, rpeNum }
  }

  // Legacy: parse notes string
  const parts: string[] = (a.notes ?? "").split(" · ")
  const name = parts[0]
  if (!name) return null

  const repsPart = parts.find((p) => p.endsWith(" reps") && !p.startsWith("L ")) ?? ""
  const bothReps = parts.find((p) => p.startsWith("L ") && p.includes(" reps")) ?? ""
  const repsNum = parseRepsNum(bothReps || repsPart)

  const weightPart = parts.find((p) => (p.endsWith("kg") || p.endsWith("lb")) && !p.startsWith("L ")) ?? ""
  const bothWeight = parts.find((p) => p.startsWith("L ") && (p.endsWith("kg") || p.endsWith("lb"))) ?? ""
  const weightNum = parseWeightNum(bothWeight || weightPart)

  const rpePart = parts.find((p) => p.startsWith("RPE ")) ?? ""
  const rpeNum = parseRpeNum(rpePart)

  return { name, repsNum, weightNum, rpeNum }
}

function buildProgressData(sessions: SessionRow[], exerciseName: string): DayPoint[] {
  const byDate = new Map<string, { reps: number[]; weight: number[]; rpe: number[] }>()

  for (const session of sessions) {
    const date = session.$createdAt.slice(0, 10)
    let attempts: any[] = []
    try { attempts = JSON.parse(session.attempts) } catch {}

    for (const a of attempts) {
      const fields = extractSCFields(a)
      if (!fields || fields.name !== exerciseName) continue

      if (!byDate.has(date)) byDate.set(date, { reps: [], weight: [], rpe: [] })
      const entry = byDate.get(date)!
      if (fields.repsNum !== null) entry.reps.push(fields.repsNum)
      if (fields.weightNum !== null) entry.weight.push(fields.weightNum)
      if (fields.rpeNum !== null) entry.rpe.push(fields.rpeNum)
    }
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => ({
      date,
      shortLabel: new Date(date + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric" }),
      avgReps: avgOf(vals.reps),
      avgWeight: avgOf(vals.weight),
      avgRpe: avgOf(vals.rpe),
    }))
}

// ─── Chart ────────────────────────────────────────────────────────────────────

function MetricChart({
  label,
  points,
  color,
  chartWidth,
  maxValue,
}: {
  label: string
  points: { value: number; label: string }[]
  color: string
  chartWidth: number
  maxValue?: number
}) {
  if (points.length < 2) return null

  const max = maxValue ?? Math.ceil(Math.max(...points.map((p) => p.value)) * 1.3)
  const step = Math.max(1, Math.ceil(max / 4))

  const labeled = points.map((p, i) => ({
    ...p,
    label: i % Math.max(1, Math.ceil(points.length / 5)) === 0 ? p.label : "",
  }))

  return (
    <View style={chartStyles.card}>
      <Text style={[chartStyles.metricLabel, { color }]}>{label}</Text>
      <LineChart
        data={labeled}
        width={chartWidth - 32}
        height={150}
        color={color}
        thickness={2.5}
        curved
        areaChart
        startFillColor={color}
        endFillColor={color}
        startOpacity={0.18}
        endOpacity={0.02}
        maxValue={max}
        stepValue={step}
        noOfSections={4}
        yAxisThickness={0}
        xAxisThickness={1}
        xAxisColor={C.border}
        yAxisTextStyle={{ fontSize: 10, color: C.textMuted }}
        xAxisLabelTextStyle={{ fontSize: 9, color: C.textSecondary, width: 46, textAlign: "center" }}
        dataPointsRadius={5}
        dataPointsColor={color}
        textShiftY={-14}
        textShiftX={-4}
        textFontSize={11}
        textColor={color}
      />
    </View>
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ExerciseProgressScreen() {
  const { name, athleteId } = useLocalSearchParams<{ name: string; athleteId?: string }>()
  const router = useRouter()
  const { width } = useWindowDimensions()
  const [dataPoints, setDataPoints] = useState<DayPoint[]>([])
  const [progression, setProgression] = useState<CoachExerciseView | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const sessions = athleteId
        ? await getSessionsByUserId(athleteId)
        : await getSessions()
      setDataPoints(buildProgressData(sessions, name ?? ""))
      // Library for the exercise's ladder + weight jump; offline → by name.
      const [library, unit] = await Promise.all([getExerciseLibrary().catch(() => null), loadWeightUnit()])
      setProgression(coachExerciseView(sessions, name ?? "", library, unit))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [athleteId, name])

  useEffect(() => { load() }, [load])


  function toChartPoints(key: "avgReps" | "avgWeight" | "avgRpe") {
    return dataPoints
      .filter((d) => d[key] !== null)
      .map((d) => ({ value: d[key] as number, label: d.shortLabel }))
  }

  const repsPoints = toChartPoints("avgReps")
  const weightPoints = toChartPoints("avgWeight")
  const rpePoints = toChartPoints("avgRpe")
  const hasData = dataPoints.length >= 1
  const hasMultipleDays = dataPoints.length >= 2
  const chartWidth = width - 32

  const latest = dataPoints[dataPoints.length - 1]

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.navigate((athleteId ? "/(tabs)/(buttonTabs)/design" : "/(tabs)/(buttonTabs)/") as any)}
          style={styles.backBtn}
        >
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{name}</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : !hasData ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📈</Text>
          <Text style={styles.emptyTitle}>Not enough data yet</Text>
          <Text style={styles.emptyText}>
            Complete a session to start tracking progress.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {progression && <ScProgressionCard view={progression} />}

          {/* Single-day summary shown when there's only one training day */}
          {!hasMultipleDays && latest && (
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>Last session · {latest.shortLabel}</Text>
              <View style={styles.summaryRow}>
                {latest.avgReps !== null && (
                  <View style={styles.summaryItem}>
                    <Text style={styles.summaryValue}>{latest.avgReps.toFixed(1)}</Text>
                    <Text style={styles.summaryLabel}>avg reps</Text>
                  </View>
                )}
                {latest.avgWeight !== null && (
                  <View style={styles.summaryItem}>
                    <Text style={styles.summaryValue}>{latest.avgWeight.toFixed(1)}</Text>
                    <Text style={styles.summaryLabel}>avg weight</Text>
                  </View>
                )}
                {latest.avgRpe !== null && (
                  <View style={styles.summaryItem}>
                    <Text style={styles.summaryValue}>{latest.avgRpe.toFixed(1)}</Text>
                    <Text style={styles.summaryLabel}>avg RPE</Text>
                  </View>
                )}
              </View>
              <Text style={styles.summaryHint}>Train on another day to see trends</Text>
            </View>
          )}

          {hasMultipleDays && (
            <>
              <MetricChart
                label="Average Reps"
                points={repsPoints}
                color={C.green}
                chartWidth={chartWidth}
              />
              <MetricChart
                label="Average Weight"
                points={weightPoints}
                color={C.yellow}
                chartWidth={chartWidth}
              />
              <MetricChart
                label="Average RPE"
                points={rpePoints}
                color={C.red}
                chartWidth={chartWidth}
                maxValue={10}
              />
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: { width: 40 },
  backArrow: { fontSize: 22, color: C.textSecondary },
  title: { flex: 1, fontSize: 18, fontWeight: "700", textAlign: "center", color: C.textPrimary },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 8,
  },
  emptyIcon: { fontSize: 40, marginBottom: 4 },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: C.textPrimary },
  emptyText: { fontSize: 14, color: C.textSecondary, textAlign: "center", lineHeight: 22 },
  scroll: { padding: 16, gap: 16, paddingBottom: 40 },
  summaryCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 20,
    gap: 16,
  },
  summaryTitle: { fontSize: 13, fontWeight: "600", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  summaryRow: { flexDirection: "row", justifyContent: "space-around" },
  summaryItem: { alignItems: "center", gap: 4 },
  summaryValue: { fontSize: 32, fontWeight: "800", color: C.yellow },
  summaryLabel: { fontSize: 12, color: C.textSecondary },
  summaryHint: { fontSize: 12, color: C.textMuted, textAlign: "center" },
})

const chartStyles = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    overflow: "hidden",
  },
  metricLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 12,
  },
})
