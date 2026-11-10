import { C } from "@/utils/theme"
import { Ionicons } from "@expo/vector-icons"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { AnimatedCircularProgress } from "react-native-circular-progress"

// Shared look for work / rest timers (jump rope cardio and the intervals
// block, e.g. the 1 on 1 off warm-up): the set as three big numbers, a bar
// with one segment per series, and a ring with the phase, the clock and
// what comes next.

export function fmtSec(sec: number): string {
  if (sec >= 60) return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`
  return `${sec}s`
}

/** Series · work · rest as three big numbers. */
export function IntervalStats({ series, workSec, restSec, seriesLabel = "series", workLabel = "work" }: {
  series: number; workSec: number; restSec: number; seriesLabel?: string; workLabel?: string
}) {
  return (
    <View style={s.stats}>
      <Stat value={String(series)} label={seriesLabel} color={C.textPrimary} />
      <View style={s.divider} />
      <Stat value={fmtSec(workSec)} label={workLabel} color={C.green} />
      <View style={s.divider} />
      <Stat value={fmtSec(restSec)} label="rest" color={C.textSecondary} />
    </View>
  )
}

function Stat({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <View style={s.stat}>
      <Text style={[s.statValue, { color }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  )
}

/** "Series 3 of 8" and one segment per series: finished ones full green,
 *  the one running lighter. `current`: index running now, null during get
 *  ready and rest. `now`: the 1-based number in the label. */
export function SeriesBar({ total, done, current, now, word = "Series" }: {
  total: number; done: number; current: number | null; now: number; word?: string
}) {
  return (
    <View style={s.seriesBox}>
      <Text style={s.round}>
        {word} <Text style={s.roundNow}>{Math.min(now, total)}</Text> of {total}
      </Text>
      <View style={s.segments}>
        {Array.from({ length: total }, (_, i) => (
          <View
            key={i}
            style={[
              s.segment,
              i < done && { backgroundColor: C.green },
              i === current && { backgroundColor: "rgba(111,207,151,0.4)" },
            ]}
          />
        ))}
      </View>
    </View>
  )
}

/** The big ring: phase on top, the clock, and "Then: …" under it. */
export function TimerRing({ fill, color, title, seconds, next, glow }: {
  fill: number; color: string; title: string; seconds: number; next?: string | null; glow?: boolean
}) {
  return (
    <View style={[s.ringWrap, glow && { backgroundColor: "rgba(111,207,151,0.06)" }]}>
      <AnimatedCircularProgress
        size={260} width={16} fill={fill}
        tintColor={color} backgroundColor={C.surfaceHigh} rotation={0} lineCap="round"
      >
        {() => (
          <View style={s.inner}>
            <Text style={[s.phase, { color }]} numberOfLines={1} adjustsFontSizeToFit>{title}</Text>
            <Text style={s.clock}>{seconds >= 60 ? fmtSec(seconds) : seconds}</Text>
            {next ? <Text style={s.next}>{next}</Text> : null}
          </View>
        )}
      </AnimatedCircularProgress>
    </View>
  )
}

export function PauseButton({ paused, onPress }: { paused: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={s.pause} hitSlop={8} accessibilityLabel={paused ? "Resume" : "Pause"}>
      <Ionicons name={paused ? "play" : "pause"} size={26} color={C.textPrimary} />
    </Pressable>
  )
}

const s = StyleSheet.create({
  stats: { flexDirection: "row", alignItems: "center" },
  stat: { flex: 1, alignItems: "center", gap: 2 },
  statValue: { fontSize: 34, fontWeight: "800", letterSpacing: -0.5, fontVariant: ["tabular-nums"] },
  statLabel: { fontSize: 13, fontWeight: "700", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.8 },
  divider: { width: 1, alignSelf: "stretch", backgroundColor: C.border },
  seriesBox: { width: "100%", gap: 10, alignItems: "center" },
  round: { fontSize: 15, color: C.textSecondary, fontWeight: "600" },
  roundNow: { color: C.textPrimary, fontWeight: "800" },
  segments: { flexDirection: "row", gap: 4, width: "100%" },
  segment: { flex: 1, height: 8, borderRadius: 4, backgroundColor: C.surfaceHigh },
  ringWrap: { borderRadius: 160, padding: 14 },
  inner: { alignItems: "center", paddingHorizontal: 28 },
  phase: { fontSize: 22, fontWeight: "800", letterSpacing: -0.2 },
  clock: { fontSize: 84, fontWeight: "800", color: C.textPrimary, fontVariant: ["tabular-nums"], lineHeight: 96 },
  next: { fontSize: 14, color: C.textSecondary, fontWeight: "600" },
  pause: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: C.surfaceHigh,
    alignItems: "center", justifyContent: "center",
  },
})
