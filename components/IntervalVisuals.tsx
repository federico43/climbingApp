import { paperSheet, usePaperScope, useC, useSheet } from "@/theme/paper/legacy"
import { font } from "@/theme/paper/tokens"
import { clockFontSize, dialGeometry, dialTicks } from "@/utils/timerDial"
import { Ionicons } from "@expo/vector-icons"
import { useMemo } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { AnimatedCircularProgress } from "react-native-circular-progress"
import Svg, { Path } from "react-native-svg"

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
 * colour by phase (`timerColor`). Small (a chip in a bar, a rest next to a
 * title): the clock only.
 *
 * Big (≥ 120) it is the dial from Federico's mock-up (2026-11-25): 60 clock
 * ticks around the ring (the ones the arc has passed in ink, the rest
 * faded), a lighter face, the phase as a small mono caption, the clock in
 * big poster digits and a round ink pause button under them. "Then: …"
 * sits under the dial.
 *
 * Every timer must be pausable (Federico 2026-11-25): pass `onTogglePause`
 * and tapping the ring (or its button) pauses / resumes it. Paused, the ring
 * turns ink and the button shows play (big: "Paused" as the caption; small:
 * a play badge in the corner).
 */
export function TimerRing({ fill, color, title, seconds, next, glow, size = 260, text, paused, onTogglePause }: {
  fill: number; color: string; title?: string; seconds: number; next?: string | null
  /** Dark mode: a soft mint glow around the arc (work phases). */
  glow?: boolean
  /** Ring diameter (the dial's ticks sit outside it). Default 260 (full screen timers). */
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
  const clock = text ?? (seconds >= 60 ? fmtSec(seconds) : String(seconds))
  if (paused) {
    color = timerColor(C, "paused")
    if (big) title = "Paused"
    glow = false
  }
  const body = big
    ? <TimerDial size={size} fill={fill} color={color} title={title} clock={clock} next={paused ? null : next} glow={glow} paused={paused} pausable={!!onTogglePause} />
    : (
      <View>
        <AnimatedCircularProgress
          size={size} width={Math.max(3, Math.round(size / 13))}
          fill={Math.min(100, Math.max(0, fill))}
          tintColor={color} backgroundColor={C.surfaceHigh} rotation={0} lineCap="round"
        >
          {() => <Text style={[s.clockSmall, { fontSize: Math.round(size * (clock.length > 4 ? 0.22 : 0.27)) }]} numberOfLines={1}>{clock}</Text>}
        </AnimatedCircularProgress>
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

/** The big ring's look (see TimerRing). Geometry in utils/timerDial.ts. */
function TimerDial({ size, fill, color, title, clock, next, glow, paused, pausable }: {
  size: number; fill: number; color: string; title?: string; clock: string; next?: string | null
  glow?: boolean; paused?: boolean; pausable: boolean
}) {
  const C = useC()
  const P = usePaperScope()
  const s = useSheet(sheet)
  const g = dialGeometry(size)
  const k = g.k
  const ticks = useMemo(() => dialTicks(size, fill), [size, fill])
  const ink = P ? P.ink : C.textPrimary
  // The arc is a progress mark, like the workout's progress bar: mintDeep
  // (C.green is the darker green for text).
  const arc = P && color === C.green ? P.mintDeep : color
  // Inline, not in the sheet: the Paper pass would turn a light white wash into ink.
  const face = P ? (P.mode === "light" ? "rgba(255,255,255,0.38)" : "rgba(255,255,255,0.04)") : "transparent"
  const fs = clockFontSize(clock, size)
  const capSize = Math.max(9, Math.round(10.5 * k * 10) / 10)
  const capLine = Math.round(capSize * 1.4)
  const btn = Math.max(30, Math.round(50 * k))
  const F = g.face
  return (
    <View style={s.dialWrap}>
      <View style={{ width: g.box, height: g.box, alignItems: "center", justifyContent: "center" }}>
        <Svg width={g.box} height={g.box} style={StyleSheet.absoluteFill}>
          <Path d={ticks.dimMinor} stroke={ink} strokeOpacity={0.22} strokeWidth={1.3 * k} strokeLinecap="round" />
          <Path d={ticks.dimMajor} stroke={ink} strokeOpacity={0.22} strokeWidth={2 * k} strokeLinecap="round" />
          <Path d={ticks.litMinor} stroke={ink} strokeOpacity={0.8} strokeWidth={1.3 * k} strokeLinecap="round" />
          <Path d={ticks.litMajor} stroke={ink} strokeOpacity={0.9} strokeWidth={2 * k} strokeLinecap="round" />
        </Svg>
        <View style={glow && P?.glow ? { shadowColor: P.glow, shadowOpacity: 0.45, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } } : undefined}>
          <AnimatedCircularProgress
            size={size} width={g.stroke}
            fill={Math.min(100, Math.max(0, fill))}
            tintColor={arc} backgroundColor={C.surfaceHigh} rotation={0} lineCap="round"
            childrenContainerStyle={{ backgroundColor: face }}
          >
            {() => (
              <View style={{ width: F, height: F }}>
                {!!title && (
                  <Text
                    style={[s.dialCaption, { top: F / 2 - 76 * k - capLine / 2, fontSize: capSize, lineHeight: capLine, letterSpacing: Math.round(capSize * 1.2) / 10, paddingHorizontal: Math.round(F * 0.16) }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {title}
                  </Text>
                )}
                <Text style={[s.dialClock, { top: F / 2 - 22 * k - fs / 2, height: fs, fontSize: fs, lineHeight: fs, letterSpacing: -k }]} numberOfLines={1}>
                  {clock}
                </Text>
                {pausable && (
                  <View style={[s.dialButton, { top: F / 2 + 58 * k - btn / 2, left: (F - btn) / 2, width: btn, height: btn, borderRadius: btn / 2 }]}>
                    <Ionicons
                      name={paused ? "play" : "pause"}
                      size={Math.max(12, Math.round(18 * k))}
                      color={P ? P.mint : C.bg}
                      style={paused ? { marginLeft: Math.round(2 * k) } : undefined}
                    />
                  </View>
                )}
              </View>
            )}
          </AnimatedCircularProgress>
        </View>
      </View>
      {!!next && <Text style={s.dialNext} numberOfLines={2}>{next}</Text>}
    </View>
  )
}

/**
 * The big countdown for logging screens (route exploration flash, density
 * test), where a ring would squeeze the chips under it (Federico
 * 2026-11-25): a full-width strip with the clock in big mono digits and a
 * bar that fills as time passes. Same colours and pause rule as TimerRing:
 * mint while running, ink when paused or over; tap anywhere to pause.
 */
export function TimerBar({ total, left, text, paused, onTogglePause }: {
  /** Full time and time left, in seconds. */
  total: number; left: number
  /** Clock text (e.g. "24:59"). */
  text: string
  paused?: boolean
  onTogglePause?: () => void
}) {
  const C = useC()
  const s = useSheet(sheet)
  const over = left <= 0
  const color = timerColor(C, paused ? "paused" : over ? "over" : "work")
  const label = over ? "Time's up" : paused ? "Paused · tap to resume" : "Remaining"
  const fill = Math.min(100, Math.max(0, ringFill(total, left)))
  const mark = onTogglePause && !over ? (paused ? "play" : "pause") : null
  const body = (
    <View style={s.barWrap}>
      <View style={s.barRow}>
        <View style={{ flex: 1 }}>
          <Text style={[s.barLabel, paused && { color: C.textPrimary }]} numberOfLines={1}>{label}</Text>
          <Text style={[s.barClock, { color: paused || over ? C.textPrimary : color }]} numberOfLines={1} adjustsFontSizeToFit>{text}</Text>
        </View>
        {mark && (
          <View style={[s.barMark, paused && { backgroundColor: C.textPrimary, borderColor: C.textPrimary }]}>
            <Ionicons name={mark} size={24} color={paused ? C.bg : C.textPrimary} />
          </View>
        )}
      </View>
      <View style={s.barTrack}>
        <View style={[s.barFill, { width: `${fill}%`, backgroundColor: color }]} />
      </View>
    </View>
  )
  if (!onTogglePause || over) return body
  return (
    <Pressable
      onPress={onTogglePause}
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
  badge: {
    position: "absolute", right: -3, bottom: -3, borderRadius: 999,
    backgroundColor: C.textPrimary, alignItems: "center", justifyContent: "center",
  },
  clockSmall: { fontWeight: "800", color: C.textPrimary, fontVariant: ["tabular-nums"], ...(P && { fontFamily: font.title }) },
  // The big dial (TimerDial). Caption, clock and button are placed from the
  // face's centre, as in the mock-up.
  dialWrap: { alignItems: "center" },
  dialCaption: {
    position: "absolute", left: 0, right: 0, textAlign: "center", color: C.textPrimary,
    fontFamily: font.mono, textTransform: "uppercase", includeFontPadding: false,
  },
  dialClock: {
    position: "absolute", left: 0, right: 0, textAlign: "center", color: C.textPrimary,
    fontFamily: font.poster, fontVariant: ["tabular-nums"], includeFontPadding: false, textAlignVertical: "center",
  },
  dialButton: {
    position: "absolute", alignItems: "center", justifyContent: "center",
    backgroundColor: P ? P.iconCircle : C.textPrimary,
  },
  dialNext: {
    marginTop: 6, textAlign: "center", fontSize: 14, color: C.textSecondary, fontWeight: "600",
    ...(P && { fontFamily: font.mono, fontSize: 10.5, letterSpacing: 1.3, textTransform: "uppercase", color: P.label }),
  },
  barWrap: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12, gap: 10 },
  barRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  barLabel: { fontSize: 13, fontWeight: "700", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.8, ...(P && { fontFamily: font.mono, fontSize: 11, letterSpacing: 1.3 }) },
  barClock: { fontSize: 64, lineHeight: 72, fontWeight: "800", fontVariant: ["tabular-nums"], letterSpacing: -1, ...(P && { fontFamily: font.mono, fontSize: 68, lineHeight: 76, letterSpacing: -2 }) },
  barMark: {
    width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: P ? P.ink : C.textPrimary,
  },
  barTrack: { height: 10, borderRadius: 5, overflow: "hidden", backgroundColor: P ? P.hairline : C.surfaceHigh },
  barFill: { height: "100%", borderRadius: 5 },
}))
