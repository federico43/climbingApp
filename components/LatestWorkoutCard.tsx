import { C } from "@/utils/theme"
import { ScalePressable } from "@/components/ScalePressable"
import { Block, BLOCK_ICONS, BLOCK_LABELS } from "@/components/workoutBlocks"
import { useWorkoutContext } from "@/contexts/WorkoutContext"
import { ProtocolRow, sessionLinkFor } from "@/services/BoulderGraphService"
import { PLAN_FOCUS_LABEL, PLAN_WORKOUTS, builtMainType } from "@/utils/planRotation"
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

// "Workout 5 of 12 · Power endurance" for a workout built from a plan.
function planTag(p: ProtocolRow): string | null {
  if (!p.planId || !p.planIndex) return null
  // From its main block: plans don't all start with strength.
  const mainType = builtMainType(p.planIndex, p.blocks)
  return `Workout ${p.planIndex} of ${PLAN_WORKOUTS} · ${PLAN_FOCUS_LABEL[mainType]}`
}

export function startWorkout(ctx: ReturnType<typeof useWorkoutContext>, w: ProtocolRow) {
  ctx.openWorkout(parseBlocks(w), w.name, sessionLinkFor(w))
}

// `fill`: grows to fill Home's screen (Start is pinned outside it there);
// otherwise a regular card with its own Start button.
export function LatestWorkoutCard({
  workout,
  scPart,
  fill,
}: {
  workout: ProtocolRow
  scPart: ProtocolRow | null
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
      {tag && (
        <View style={styles.planChip}>
          <Ionicons name="calendar-outline" size={12} color={C.green} />
          <Text style={styles.planChipText}>{tag}</Text>
        </View>
      )}
      <Text style={styles.workoutName}>{workout.name}</Text>

      <View style={styles.blockList}>
        {blocks.map((b, i) => (
          <View key={b.id ?? i} style={styles.blockRow}>
            <View style={styles.blockIcon}>
              <Ionicons name={BLOCK_ICONS[b.type] ?? "ellipse"} size={16} color={C.green} />
            </View>
            <Text style={[styles.blockTitle, { flex: 1 }]} numberOfLines={2}>{blockTitle(b)}</Text>
          </View>
        ))}
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
  planChip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: "rgba(111,207,151,0.12)",
  },
  planChipText: { fontSize: 12.5, fontWeight: "600", color: C.green },
  workoutName: {
    fontSize: 28,
    fontWeight: "800",
    color: C.textPrimary,
    letterSpacing: -0.5,
  },

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
  blockTitle: { fontSize: 15, fontWeight: "600", color: C.textPrimary },

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
