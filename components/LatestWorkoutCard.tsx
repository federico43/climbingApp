import { C } from "@/utils/theme"
import { ScalePressable } from "@/components/ScalePressable"
import { Block, BLOCK_ICONS, BLOCK_LABELS } from "@/components/workoutBlocks"
import { useWorkoutContext } from "@/contexts/WorkoutContext"
import { ProtocolRow, sessionLinkFor } from "@/services/BoulderGraphService"
import { PLAN_FOCUS_LABEL, PLAN_WORKOUTS, builtMainType } from "@/utils/planRotation"
import { projectDetail } from "@/utils/workoutSummary"
import { Ionicons } from "@expo/vector-icons"
import { LinearGradient } from "expo-linear-gradient"
import Animated, { FadeInDown } from "react-native-reanimated"
import { StyleSheet, Text, View } from "react-native"

export { pickLatestWorkout } from "@/utils/homeWorkout"

// The athlete's most recently built workout, ready to start — full screen
// on Home, a card at the top of the Plan tab when they have a plan.

export function parseBlocks(p: ProtocolRow): Block[] {
  try {
    const blocks = JSON.parse(p.blocks)
    return Array.isArray(blocks) ? blocks : []
  } catch {
    return []
  }
}

function blockTitle(b: Block): string {
  if (b.type === "strength_conditioning" && b.exercises?.length) {
    return b.exercises.map((e) => e.name || "Unnamed").join(" · ")
  }
  return b.blockName || BLOCK_LABELS[b.type] || "Block"
}

// One short line per block: rounds / attempts / timing.
function blockDetail(b: Block): string {
  const attempts = (n?: number) => (n ? `${n} attempt${n !== 1 ? "s" : ""}` : "")
  switch (b.type) {
    case "project_bouldering":
      return projectDetail(b)
    case "constraint_warmup":
    case "sequence":
      return attempts(b.targetAttempts)
    case "strength_conditioning":
      return b.rounds ? `${b.rounds} round${b.rounds !== 1 ? "s" : ""}` : ""
    case "four_by_four":
      return b.sets && b.bouldersPerSet ? `${b.sets}×${b.bouldersPerSet}` : ""
    case "intervals":
      return b.series ? `${b.series} × ${b.workTime}s on / ${b.restTime}s off` : ""
    case "exploration_session":
    case "free_session":
      return b.timeLimit ? `${b.timeLimit} min` : ""
    default:
      return ""
  }
}

// "Workout 5 of 12 · Power endurance" for a workout built from a plan.
function planTag(p: ProtocolRow): string | null {
  if (!p.planId || !p.planIndex) return null
  // From its main block: plans don't all start with strength.
  const mainType = builtMainType(p.planIndex, p.blocks)
  return `Workout ${p.planIndex} of ${PLAN_WORKOUTS} · ${PLAN_FOCUS_LABEL[mainType]}`
}

function builtOn(p: ProtocolRow): string {
  return new Date(p.$createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function startWorkout(ctx: ReturnType<typeof useWorkoutContext>, w: ProtocolRow) {
  ctx.openWorkout(parseBlocks(w), w.name, sessionLinkFor(w))
}

// `fill`: grows to fill Home's screen (Start is pinned outside it there);
// otherwise a regular card with its own Start button.
export function LatestWorkoutCard({
  workout,
  scPart,
  picked,
  fill,
}: {
  workout: ProtocolRow
  scPart: ProtocolRow | null
  picked?: boolean   // the coach picked it for Home (not just the newest)
  fill?: boolean
}) {
  const workoutCtx = useWorkoutContext()
  const blocks = parseBlocks(workout)
  const tag = planTag(workout)

  return (
    <Animated.View style={[styles.card, fill && { flexGrow: 1 }]} entering={FadeInDown.duration(420)}>
      <LinearGradient
        colors={["rgba(111,207,151,0.10)", "rgba(111,207,151,0)"]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.cardTopRow}>
        <Text style={styles.cardKicker}>{tag || picked ? "Your next workout" : "Latest workout"}</Text>
        <Text style={styles.cardDate}>Built {builtOn(workout)}</Text>
      </View>
      {tag && (
        <View style={styles.planChip}>
          <Ionicons name="calendar-outline" size={12} color={C.green} />
          <Text style={styles.planChipText}>{tag}</Text>
        </View>
      )}
      <Text style={styles.workoutName}>{workout.name}</Text>
      <Text style={styles.workoutMeta}>
        {blocks.length} block{blocks.length !== 1 ? "s" : ""}
      </Text>

      <View style={styles.blockList}>
        {blocks.map((b, i) => {
          const detail = blockDetail(b)
          return (
            <View key={b.id ?? i} style={styles.blockRow}>
              <View style={styles.blockIcon}>
                <Ionicons name={BLOCK_ICONS[b.type] ?? "ellipse"} size={16} color={C.green} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.blockType}>{BLOCK_LABELS[b.type] ?? b.type}</Text>
                <Text style={styles.blockTitle} numberOfLines={2}>{blockTitle(b)}</Text>
              </View>
              {detail ? <Text style={styles.blockDetail}>{detail}</Text> : null}
            </View>
          )
        })}
      </View>

      {scPart && (
        <ScalePressable style={styles.scRow} onPress={() => startWorkout(workoutCtx, scPart)}>
          <Ionicons name="barbell" size={18} color={C.green} />
          <View style={{ flex: 1 }}>
            <Text style={styles.scKicker}>Also today</Text>
            <Text style={styles.scName} numberOfLines={1}>{scPart.name}</Text>
          </View>
          <Text style={styles.scStart}>Start ›</Text>
        </ScalePressable>
      )}

      {!fill && (
        <ScalePressable style={styles.startBtn} onPress={() => startWorkout(workoutCtx, workout)}>
          <Ionicons name="play" size={18} color={C.bg} />
          <Text style={styles.startBtnText}>Start workout</Text>
        </ScalePressable>
      )}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
    overflow: "hidden",
  },
  cardTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardKicker: {
    fontSize: 12,
    fontWeight: "700",
    color: C.green,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  cardDate: { fontSize: 12, color: C.textMuted },
  planChip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: "rgba(111,207,151,0.12)",
  },
  planChipText: { fontSize: 12.5, fontWeight: "600", color: C.green },
  workoutName: {
    marginTop: 12,
    fontSize: 28,
    fontWeight: "800",
    color: C.textPrimary,
    letterSpacing: -0.5,
  },
  workoutMeta: { marginTop: 4, fontSize: 13, color: C.textSecondary },

  blockList: { marginTop: 20, gap: 10 },
  blockRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.surfaceHigh,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  blockIcon: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: "rgba(111,207,151,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  blockType: { fontSize: 11, fontWeight: "600", color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  blockTitle: { marginTop: 2, fontSize: 15, fontWeight: "600", color: C.textPrimary },
  blockDetail: { maxWidth: 110, fontSize: 12, color: C.textSecondary, textAlign: "right" },

  scRow: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: C.green,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  scKicker: { fontSize: 11, fontWeight: "600", color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  scName: { marginTop: 2, fontSize: 15, fontWeight: "600", color: C.textPrimary },
  scStart: { fontSize: 14, fontWeight: "700", color: C.green },

  startBtn: {
    marginTop: 18,
    height: 52,
    borderRadius: 16,
    backgroundColor: C.green,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  startBtnText: { fontSize: 16, fontWeight: "800", color: C.bg },
})
