import { C } from "@/utils/theme"
import {
  ADAPTATION_COLOR,
  ADAPTATION_LABEL,
  resolveAdaptation,
} from "@/utils/adaptations"
import React, { useMemo } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import Svg, { G, Path } from "react-native-svg"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DonutSlice {
  // Caller-supplied id (typically a block index) so the click handler can
  // identify which slice was tapped.
  id: string | number
  // Block this slice represents — for color + label resolution.
  block: { type?: string; adaptation?: string; blockName?: string }
  // Slice size, in any consistent unit (seconds, points, etc.).
  value: number
}

interface Props {
  slices: DonutSlice[]
  size?: number
  thickness?: number
  centerLabel?: string         // big text inside the donut (e.g. "11m 22s")
  centerSubLabel?: string      // small label below the center (e.g. "total")
  onSlicePress?: (slice: DonutSlice) => void
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function polar(cx: number, cy: number, r: number, angle: number) {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
}

// Build an SVG `path` `d` string for a donut slice.
function donutSlicePath(
  cx: number, cy: number,
  rOuter: number, rInner: number,
  startA: number, endA: number,
) {
  // Avoid degenerate path when the slice is the whole circle.
  const sweep = endA - startA
  const largeArc = sweep > Math.PI ? 1 : 0
  const o1 = polar(cx, cy, rOuter, startA)
  const o2 = polar(cx, cy, rOuter, endA)
  const i1 = polar(cx, cy, rInner, endA)
  const i2 = polar(cx, cy, rInner, startA)
  return [
    `M ${o1.x} ${o1.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${o2.x} ${o2.y}`,
    `L ${i1.x} ${i1.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${i2.x} ${i2.y}`,
    "Z",
  ].join(" ")
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AdaptationDonut({
  slices,
  size = 220,
  thickness = 32,
  centerLabel,
  centerSubLabel,
  onSlicePress,
}: Props) {
  const total = useMemo(
    () => slices.reduce((s, x) => s + Math.max(0, x.value), 0),
    [slices]
  )

  const cx = size / 2
  const cy = size / 2
  const rOuter = size / 2
  const rInner = size / 2 - thickness

  // Compute slice angles up-front so we can render + handle taps consistently.
  const arcs = useMemo(() => {
    if (total <= 0) return []
    let cursor = -Math.PI / 2  // start at 12 o'clock
    return slices.map((slice) => {
      const angle = (slice.value / total) * Math.PI * 2
      const startA = cursor
      const endA = cursor + angle
      cursor = endA
      return { slice, startA, endA }
    })
  }, [slices, total])

  return (
    <View style={{ alignItems: "center" }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <G>
            {arcs.length === 0 ? (
              // Empty state: render a dim full ring so the layout doesn't jump
              <Path
                d={donutSlicePath(cx, cy, rOuter, rInner, 0, Math.PI * 2 - 0.0001)}
                fill={C.surface}
              />
            ) : arcs.length === 1 ? (
              <Path
                d={donutSlicePath(cx, cy, rOuter, rInner, 0, Math.PI * 2 - 0.0001)}
                fill={ADAPTATION_COLOR[resolveAdaptation(arcs[0].slice.block)]}
                onPress={() => onSlicePress?.(arcs[0].slice)}
              />
            ) : (
              arcs.map(({ slice, startA, endA }, i) => (
                <Path
                  key={i}
                  d={donutSlicePath(cx, cy, rOuter, rInner, startA, endA)}
                  fill={ADAPTATION_COLOR[resolveAdaptation(slice.block)]}
                  onPress={() => onSlicePress?.(slice)}
                />
              ))
            )}
          </G>
        </Svg>
        {/* Center labels overlay */}
        <View style={[StyleSheet.absoluteFillObject, styles.centerLabelWrap]} pointerEvents="none">
          {!!centerLabel && (
            <Text style={styles.centerLabel}>{centerLabel}</Text>
          )}
          {!!centerSubLabel && (
            <Text style={styles.centerSubLabel}>{centerSubLabel}</Text>
          )}
        </View>
      </View>
    </View>
  )
}

// ─── Legend ───────────────────────────────────────────────────────────────────

/**
 * Optional legend rendering each slice (one row per block) with its color
 * dot, label, value and percentage. Tapping a row fires the same handler
 * as tapping a slice.
 */
export function AdaptationDonutLegend({
  slices,
  total,
  formatValue,
  onPress,
}: {
  slices: DonutSlice[]
  total: number
  formatValue: (v: number) => string
  onPress?: (slice: DonutSlice) => void
}) {
  return (
    <View style={legendStyles.list}>
      {slices.map((s) => {
        const color = ADAPTATION_COLOR[resolveAdaptation(s.block)]
        const pct = total > 0 ? Math.round((s.value / total) * 100) : 0
        const label = s.block.blockName?.trim() || ADAPTATION_LABEL[resolveAdaptation(s.block)]
        return (
          <Pressable
            key={s.id}
            style={legendStyles.row}
            onPress={() => onPress?.(s)}
          >
            <View style={[legendStyles.dot, { backgroundColor: color }]} />
            <Text style={legendStyles.label} numberOfLines={1}>{label}</Text>
            <Text style={legendStyles.value}>{formatValue(s.value)}  ·  {pct}%</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  centerLabelWrap: { alignItems: "center", justifyContent: "center" },
  centerLabel: {
    fontSize: 26, fontWeight: "800", color: C.textPrimary,
    fontVariant: ["tabular-nums"],
  },
  centerSubLabel: { fontSize: 11, color: C.textMuted, marginTop: 2 },
})

const legendStyles = StyleSheet.create({
  list: { gap: 6, width: "100%", paddingHorizontal: 16, marginTop: 14 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: C.surface, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  label: { flex: 1, fontSize: 13, color: C.textPrimary, fontWeight: "600" },
  value: { fontSize: 12, color: C.textSecondary, fontVariant: ["tabular-nums"] },
})
