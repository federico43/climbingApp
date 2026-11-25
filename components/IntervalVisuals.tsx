import { paperSheet, useC, useSheet } from "@/theme/paper/legacy"
import { font } from "@/theme/paper/tokens"
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
  const C = useC()
  const s = useSheet(sheet)
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
  const s = useSheet(sheet)
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
  const C = useC()
  const s = useSheet(sheet)
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
              i === current && { backgroundColor: C.tint("rgba(111,207,151,0.4)") },
            ]}
          />
        ))}
      </View>
    </View>
  )
}

/**
 * The timer ring — the one standard look for every timer in the app
 * (Federico 2026-11-25): the 1 on 1 off ring. It fills as time passes;
 * colour by phase (`timerColor`). Big (≥ 120): phase on top, the clock and
 * "Then: …" under it. Small (a chip in a bar, a rest next to a title): the
 * clock only.
 *
 * Every timer must be pausable (Federico 2026-11-25): pass `onTogglePause`
 * and tapping the ring pauses / resumes it. Paused, the ring turns ink and a
 * play mark shows (big: "Paused" on top); running, a big ring shows a small
 * pause mark under the clock so the tap is findable.
 */
export function TimerRing({ fill, color, title, seconds, next, glow, size = 260, text, paused, onTogglePause }: {
  fill: number; color: string; title?: string; seconds: number; next?: string | null; glow?: boolean
  /** Ring diameter. Default 260 (full screen timers). */
  size?: number
  /** Clock text instead of the seconds (e.g. "go!", "+1:05"). */
  text?: string
  paused?: boolean
  /** Tapping the ring pauses / resumes. */
  onTogglePause?: () => void
}) {
  const C = useC()
  const s = useSheet(sheet)
  const big = size >= 120
  const k = size / 260
  const clock = text ?? (seconds >= 60 ? fmtSec(seconds) : String(seconds))
  if (paused) {
    color = timerColor(C, "paused")
    if (big) title = "Paused"
    glow = false
  }
  const mark = onTogglePause ? (paused ? "play" : "pause") : null
  const ring = (
    <AnimatedCircularProgress
      size={size} width={big ? Math.max(8, Math.round(16 * k)) : Math.max(3, Math.round(size / 13))}
      fill={Math.min(100, Math.max(0, fill))}
      tintColor={color} backgroundColor={C.surfaceHigh} rotation={0} lineCap="round"
    >
      {() => big ? (
        <View style={[s.inner, { paddingHorizontal: Math.round(28 * k) }]}>
          {!!title && <Text style={[s.phase, { color }, k < 0.8 && { fontSize: Math.round(24 * Math.max(k, 0.7)) }]} numberOfLines={1} adjustsFontSizeToFit>{title}</Text>}
          <Text
            style={[s.clock, k < 1 && { fontSize: Math.round(108 * k), lineHeight: Math.round(108 * k) }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {clock}
          </Text>
          {mark && <Ionicons name={mark} size={Math.max(16, Math.round(22 * k))} color={paused ? C.textPrimary : C.textSecondary} style={{ marginTop: 2 }} />}
          {next && !paused ? <Text style={s.next} numberOfLines={2}>{next}</Text> : null}
          {paused ? <Text style={s.next}>Tap to resume</Text> : null}
        </View>
      ) : (
        <Text style={[s.clockSmall, { fontSize: Math.round(size * (clock.length > 4 ? 0.22 : 0.27)) }]} numberOfLines={1}>{clock}</Text>
      )}
    </AnimatedCircularProgress>
  )
  const body = big
    ? <View style={[s.ringWrap, { padding: Math.round(14 * k) }, glow && { backgroundColor: C.tint("rgba(111,207,151,0.06)") }]}>{ring}</View>
    : (
      <View>
        {ring}
        {paused && (
          <View style={[s.badge, { width: Math.max(14, Math.round(size * 0.36)), height: Math.max(14, Math.round(size * 0.36)) }]}>
            <Ionicons name="play" size={Math.max(8, Math.round(size * 0.2))} color={C.bg} />
          </View>
        )}
      </View>
    )
  if (!onTogglePause) return body
  return (
    <Pressable
      onPress={onTogglePause}
      hitSlop={big ? 0 : 8}
      accessibilityRole="button"
      accessibilityLabel={paused ? "Resume timer" : "Pause timer"}
      style={({ pressed }) => pressed && { opacity: 0.75 }}
    >
      {body}
    </Pressable>
  )
}

/** Ring colour by phase: work / hang / running = mint, rest = muted, the rest ink. */
export function timerColor(C: { green: string; yellow: string; textPrimary: string; textSecondary: string }, phase: "work" | "rest" | "prepare" | "paused" | "over"): string {
  return phase === "work" ? C.green : phase === "rest" ? C.yellow : phase === "prepare" ? C.textSecondary : C.textPrimary
}

/** % of the ring filled after `elapsed` of `total` seconds. */
export function ringFill(total: number, left: number): number {
  return total > 0 ? ((total - Math.max(0, left)) / total) * 100 : 0
}

export function PauseButton({ paused, onPress }: { paused: boolean; onPress: () => void }) {
  const C = useC()
  const s = useSheet(sheet)
  return (
    <Pressable onPress={onPress} style={s.pause} hitSlop={8} accessibilityLabel={paused ? "Resume" : "Pause"}>
      <Ionicons name={paused ? "play" : "pause"} size={26} color={C.textPrimary} />
    </Pressable>
  )
}

const sheet = paperSheet((C, P) => StyleSheet.create({
  stats: { flexDirection: "row", alignItems: "center" },
  stat: { flex: 1, alignItems: "center", gap: 2 },
  statValue: { fontSize: 34, fontWeight: "800", letterSpacing: -0.5, fontVariant: ["tabular-nums"] },
  statLabel: { fontSize: 13, fontWeight: "700", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.8 },
  divider: { width: 1, alignSelf: "stretch", backgroundColor: C.border },
  seriesBox: { width: "100%", gap: 10, alignItems: "center" },
  round: { fontSize: 15, color: C.textSecondary, fontWeight: "600", ...(P && { fontFamily: font.mono, fontSize: 11, letterSpacing: 1.3, textTransform: "uppercase" }) },
  roundNow: { color: C.textPrimary, fontWeight: "800" },
  segments: { flexDirection: "row", gap: 4, width: "100%" },
  segment: { flex: 1, height: 8, borderRadius: 4, backgroundColor: C.surfaceHigh, ...(P && { height: 6, borderRadius: 3, backgroundColor: P.hairline }) },
  ringWrap: { borderRadius: 160, padding: 14 },
  badge: {
    position: "absolute", right: -3, bottom: -3, borderRadius: 999,
    backgroundColor: C.textPrimary, alignItems: "center", justifyContent: "center",
  },
  inner: { alignItems: "center", paddingHorizontal: 28 },
  phase: { fontSize: 22, fontWeight: "800", letterSpacing: -0.2, ...(P && { fontFamily: font.title, textTransform: "uppercase", fontSize: 24 }) },
  clock: { fontSize: 84, fontWeight: "800", color: C.textPrimary, fontVariant: ["tabular-nums"], lineHeight: 96, ...(P && { fontFamily: font.poster, fontSize: 108, lineHeight: 108, letterSpacing: -2 }) },
  clockSmall: { fontWeight: "800", color: C.textPrimary, fontVariant: ["tabular-nums"], ...(P && { fontFamily: font.title }) },
  next: { fontSize: 14, color: C.textSecondary, fontWeight: "600", ...(P && { fontFamily: font.mono, fontSize: 11, letterSpacing: 1.3, textTransform: "uppercase" }) },
  pause: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: C.surfaceHigh,
    alignItems: "center", justifyContent: "center",
    ...(P && { backgroundColor: "transparent", borderWidth: 1.5, borderColor: P.ink }),
  },
}))
