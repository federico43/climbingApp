import { C } from "@/utils/theme"
import {
  ADAPTATION_COLOR,
  ADAPTATION_LABEL,
  resolveAdaptation,
} from "@/utils/adaptations"
import { SessionRow } from "@/services/BoulderGraphService"
import React, { useMemo } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TimelineSegment {
  blockIndex: number
  block: any              // raw block JSON — drives color/adaptation/label
  duration: number        // seconds
}

interface Props {
  athleteName: string
  athleteSubtitle?: string  // e.g. "11m 22s · 3 blocks" — caller can supply or we default
  session: SessionRow
  onSegmentPress?: (seg: TimelineSegment, session: SessionRow) => void
  onPressBar?: () => void   // overall tap (open session detail, etc.)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseSession(session: SessionRow): {
  segments: TimelineSegment[]
  totalDuration: number
} {
  let protocol: any[] = []
  let durations: Record<number, number> = {}
  try { protocol = JSON.parse(session.protocol) } catch {}
  try {
    if (session.blockDurations) durations = JSON.parse(session.blockDurations)
  } catch {}

  const segments: TimelineSegment[] = protocol.map((block: any, i: number) => ({
    blockIndex: i,
    block,
    duration: Number(durations[i] ?? 0),
  }))
  const totalDuration = segments.reduce((s, x) => s + x.duration, 0)
  return { segments, totalDuration }
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "—"
  const totalMin = Math.floor(seconds / 60)
  const s = seconds % 60
  if (totalMin >= 60) {
    const h = Math.floor(totalMin / 60), m = totalMin % 60
    return m ? `${h}h ${m}m` : `${h}h`
  }
  if (totalMin === 0) return `${s}s`
  return s ? `${totalMin}m ${s}s` : `${totalMin}m`
}

const BLOCK_TYPE_LABEL: Record<string, string> = {
  project_bouldering: "Project",
  constraint_warmup: "Warmup",
  strength_conditioning: "S&C",
  exploration_session: "Explore",
  sequence: "Sequence",
  free_session: "Free",
  four_by_four: "4×4",
}

function blockLabel(block: any): string {
  const n = (block?.blockName ?? "").toString().trim()
  return n || BLOCK_TYPE_LABEL[block?.type] || block?.type || "Block"
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DayTimelineBar({
  athleteName,
  athleteSubtitle,
  session,
  onSegmentPress,
  onPressBar,
}: Props) {
  const { segments, totalDuration } = useMemo(() => parseSession(session), [session])
  const hasData = totalDuration > 0

  const subtitle = athleteSubtitle ??
    `${formatDuration(totalDuration)} · ${segments.length} block${segments.length !== 1 ? "s" : ""}`

  return (
    <View style={styles.row}>
      <View style={styles.leftCol}>
        <Text style={styles.athleteName} numberOfLines={1}>{athleteName}</Text>
        <Text style={styles.athleteSubtitle} numberOfLines={1}>{subtitle}</Text>
      </View>
      <Pressable style={styles.barOuter} onPress={onPressBar}>
        {hasData ? (
          <View style={styles.bar}>
            {segments.map((seg) => {
              if (seg.duration <= 0) return null
              const flex = seg.duration / totalDuration
              const color = ADAPTATION_COLOR[resolveAdaptation(seg.block)]
              return (
                <Pressable
                  key={seg.blockIndex}
                  style={[styles.seg, { flex, backgroundColor: color }]}
                  onPress={() => onSegmentPress?.(seg, session)}
                >
                  <Text style={styles.segName} numberOfLines={1}>{blockLabel(seg.block)}</Text>
                  <Text style={styles.segTime} numberOfLines={1}>{formatDuration(seg.duration)}</Text>
                </Pressable>
              )
            })}
          </View>
        ) : (
          <View style={[styles.bar, styles.barEmpty]}>
            <Text style={styles.barEmptyText}>no duration data</Text>
          </View>
        )}
      </Pressable>
    </View>
  )
}

// ─── Day adaptation breakdown bar ─────────────────────────────────────────────
//
// A summary bar that combines ALL sessions across athletes for a given day,
// segmented by total time spent on each adaptation. Useful for the top of
// the dashboard so the coach sees the day-wide training distribution.

export function DayAdaptationSummary({
  sessions,
  height = 14,
}: {
  sessions: SessionRow[]
  height?: number
}) {
  const { totals, grandTotal } = useMemo(() => {
    const totals: Record<string, number> = {}
    let grandTotal = 0
    for (const s of sessions) {
      let protocol: any[] = []
      let durations: Record<number, number> = {}
      try { protocol = JSON.parse(s.protocol) } catch {}
      try {
        if (s.blockDurations) durations = JSON.parse(s.blockDurations)
      } catch {}
      protocol.forEach((b: any, i: number) => {
        const d = Number(durations[i] ?? 0)
        if (d <= 0) return
        const a = resolveAdaptation(b)
        totals[a] = (totals[a] ?? 0) + d
        grandTotal += d
      })
    }
    return { totals, grandTotal }
  }, [sessions])

  if (grandTotal === 0) return null

  const entries = Object.entries(totals).sort(([, a], [, b]) => b - a)

  return (
    <View>
      <View style={[styles.summaryBar, { height }]}>
        {entries.map(([adaptation, dur]) => (
          <View
            key={adaptation}
            style={{ flex: dur / grandTotal, backgroundColor: ADAPTATION_COLOR[adaptation as keyof typeof ADAPTATION_COLOR] }}
          />
        ))}
      </View>
      <View style={styles.summaryLegend}>
        {entries.map(([adaptation, dur]) => (
          <View key={adaptation} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: ADAPTATION_COLOR[adaptation as keyof typeof ADAPTATION_COLOR] }]} />
            <Text style={styles.legendText}>
              {ADAPTATION_LABEL[adaptation as keyof typeof ADAPTATION_LABEL]} · {formatDuration(dur)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  leftCol: { width: 110 },
  athleteName: { fontSize: 14, fontWeight: "700", color: C.textPrimary },
  athleteSubtitle: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  barOuter: { flex: 1 },
  bar: {
    flexDirection: "row",
    height: 34,
    borderRadius: 6,
    overflow: "hidden",
    backgroundColor: C.surfaceHigh,
  },
  seg: { justifyContent: "center", alignItems: "center", paddingHorizontal: 4, overflow: "hidden" },
  segName: {
    fontSize: 10, fontWeight: "700", color: "#fff",
    textShadowColor: "rgba(0,0,0,0.55)", textShadowRadius: 2, textShadowOffset: { width: 0, height: 1 },
  },
  segTime: { fontSize: 9, color: "rgba(255,255,255,0.85)", marginTop: 1 },
  barEmpty: {
    alignItems: "center", justifyContent: "center",
  },
  barEmptyText: { fontSize: 11, color: C.textMuted, fontStyle: "italic" },

  summaryBar: {
    flexDirection: "row",
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: C.surfaceHigh,
  },
  summaryLegend: {
    flexDirection: "row", flexWrap: "wrap", gap: 12,
    marginTop: 8,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: C.textSecondary },
})
