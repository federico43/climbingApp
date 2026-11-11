import { Card, CardTitle, ListRow, MintButton, Mono, PrimaryCTA, usePaper } from "@/components/paper"
import { Block, BLOCK_ICONS, BLOCK_LABELS } from "@/components/workoutBlocks"
import { useWorkoutContext } from "@/contexts/WorkoutContext"
import { ProtocolRow, sessionLinkFor } from "@/services/BoulderGraphService"
import { PLAN_FOCUS_LABEL, PLAN_WORKOUTS, builtMainType, hasBuiltMainBlock } from "@/utils/planRotation"
import { Ionicons } from "@expo/vector-icons"
import Animated, { FadeInDown } from "react-native-reanimated"
import { View } from "react-native"

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
  // No climbing block (a conditioning plan's): the name already says it.
  if (!hasBuiltMainBlock(p.blocks)) return `Workout ${p.planIndex} of ${PLAN_WORKOUTS}`
  // From its main block: plans don't all start with strength.
  const mainType = builtMainType(p.planIndex, p.blocks)
  return `Workout ${p.planIndex} of ${PLAN_WORKOUTS} · ${PLAN_FOCUS_LABEL[mainType]}`
}

export function startWorkout(ctx: ReturnType<typeof useWorkoutContext>, w: ProtocolRow) {
  ctx.openWorkout(parseBlocks(w), w.name, sessionLinkFor(w))
}

// `fill`: grows to fill Home's screen (Start is pinned outside it there);
// otherwise the card is followed by its own Start workout CTA.
export function LatestWorkoutCard({
  workout,
  scPart,
  fill,
}: {
  workout: ProtocolRow
  scPart: ProtocolRow | null
  fill?: boolean
}) {
  const t = usePaper()
  const workoutCtx = useWorkoutContext()
  const blocks = parseBlocks(workout)
  const tag = planTag(workout)

  return (
    <Animated.View style={[{ gap: 14 }, fill && { flexGrow: 1 }]} entering={FadeInDown.duration(420)}>
      <Card eyebrow={tag ?? "Today's sequence"} style={fill && { flexGrow: 1 }}>
        <CardTitle size={34}>{workout.name}</CardTitle>

        <View style={{ marginTop: 10 }}>
          {blocks.map((b, i) => (
            <ListRow
              key={b.id ?? i}
              index={i + 1}
              icon={BLOCK_ICONS[b.type] ?? "ellipse"}
              label={blockTitle(b)}
              last={i === blocks.length - 1 && !scPart}
            />
          ))}
        </View>

        {scPart && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: t.hairline }}>
            <Ionicons name="barbell" size={18} color={t.ink} />
            <View style={{ flex: 1 }}>
              <Mono>Also today</Mono>
              <CardTitle size={20} numberOfLines={1} style={{ marginTop: 2 }}>{scPart.name}</CardTitle>
            </View>
            <MintButton label="Start" icon="play" compact onPress={() => startWorkout(workoutCtx, scPart)} />
          </View>
        )}
      </Card>

      {!fill && <PrimaryCTA label="Start workout" onPress={() => startWorkout(workoutCtx, workout)} />}
    </Animated.View>
  )
}
