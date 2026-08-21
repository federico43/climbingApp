import { C } from "@/utils/theme"
import { adaptationColor } from "@/utils/adaptations"
import { getSessionsByUserId, SessionRow } from "@/services/BoulderGraphService"
import { Ionicons } from "@expo/vector-icons"
import { useEffect, useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"

// Collapsible "what did they do last time" panel for the workout builder —
// so a coach can see the athlete's last two training days (S&C sets/RPE
// included) without leaving the screen to go dig through their history.
// Grouped by calendar day, not by session row, since an athlete can log
// more than one session on the same day.

function formatBlockType(type: string): string {
  return (type ?? "").split("_").map((w: string) => w[0].toUpperCase() + w.slice(1)).join(" ")
}

function parseAttempts(session: SessionRow): any[] {
  try { return JSON.parse(session.attempts) } catch { return [] }
}

function sessionTimestamp(session: SessionRow, attempts: any[]): number {
  return attempts[0]?.timestamp ?? new Date(session.$createdAt).getTime()
}

function dateKeyOf(session: SessionRow, attempts: any[]): string {
  return new Date(sessionTimestamp(session, attempts)).toISOString().slice(0, 10)
}

function dateLabelOf(dateKey: string): string {
  const d = new Date(dateKey + "T12:00:00")
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

function timeLabelOf(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

// One readable line per logged set, covering the three S&C exercise shapes
// (plain reps, left/right, and 7/3s series) — mirrors the fields written by
// StrengthConditioningBlock's handleExerciseDone.
function scLine(sc: any): string {
  const name = sc.exerciseName ?? "Exercise"
  if (sc.repsCompleted != null) {
    return `${name}: ${sc.repsCompleted} reps${sc.rpe ? ` · RPE ${sc.rpe}` : ""}`
  }
  if (sc.repsLeft != null) {
    const l = `L ${sc.repsLeft}${sc.rpeLeft ? ` (RPE ${sc.rpeLeft})` : ""}`
    const r = `R ${sc.repsRight}${sc.rpeRight ? ` (RPE ${sc.rpeRight})` : ""}`
    return `${name}: ${l} · ${r}`
  }
  if (sc.seriesDone != null) {
    return `${name}: ${sc.seriesDone} series${sc.rpe ? ` · RPE ${sc.rpe}` : ""}`
  }
  return name
}

interface SummaryBlock {
  blockIndex: number
  blockName: string
  blockType: string
  color: string
  isSC: boolean
  scLines: string[]
  sends: number
  total: number
}

interface SessionSummary {
  id: string
  timeLabel: string
  blocks: SummaryBlock[]
}

interface DaySummary {
  dateKey: string
  dateLabel: string
  sessions: SessionSummary[]
}

function summarizeSession(session: SessionRow, attempts: any[]): SessionSummary {
  let protocol: any[] = []
  try { protocol = JSON.parse(session.protocol) } catch {}

  const blocks: SummaryBlock[] = protocol.map((block: any, blockIndex: number) => {
    const blockAttempts = attempts.filter((a: any) => a.blockIndex === blockIndex)
    const isSC = block.type === "strength_conditioning"
    return {
      blockIndex,
      blockName: block.blockName ?? formatBlockType(block.type ?? ""),
      blockType: block.type ?? "",
      color: adaptationColor(block),
      isSC,
      scLines: isSC ? blockAttempts.filter((a: any) => a.scData).map((a: any) => scLine(a.scData)) : [],
      sends: blockAttempts.filter((a: any) => a.success).length,
      total: blockAttempts.length,
    }
  })

  return { id: session.$id, timeLabel: timeLabelOf(sessionTimestamp(session, attempts)), blocks }
}

// Groups sessions by calendar day and returns the most recent `dayCount`
// days, each with its session(s) sorted earliest-first.
function groupByDay(sessions: SessionRow[], dayCount: number): DaySummary[] {
  const byDay = new Map<string, { session: SessionRow; attempts: any[] }[]>()
  for (const session of sessions) {
    const attempts = parseAttempts(session)
    const key = dateKeyOf(session, attempts)
    const bucket = byDay.get(key) ?? []
    bucket.push({ session, attempts })
    byDay.set(key, bucket)
  }

  const dayKeys = [...byDay.keys()].sort((a, b) => b.localeCompare(a)).slice(0, dayCount)

  return dayKeys.map((dateKey) => {
    const entries = [...byDay.get(dateKey)!].sort(
      (a, b) => sessionTimestamp(a.session, a.attempts) - sessionTimestamp(b.session, b.attempts)
    )
    return {
      dateKey,
      dateLabel: dateLabelOf(dateKey),
      sessions: entries.map(({ session, attempts }) => summarizeSession(session, attempts)),
    }
  })
}

export function AthleteRecentSessionsSummary({ athleteId, wide }: { athleteId: string; wide?: boolean }) {
  const [days, setDays] = useState<DaySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getSessionsByUserId(athleteId)
      .then((rows) => { if (!cancelled) setDays(groupByDay(rows, 2)) })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [athleteId])

  return (
    <View style={s.wrap}>
      <Pressable style={s.toggle} onPress={() => setExpanded((e) => !e)} disabled={loading}>
        <Text style={s.toggleText}>Last 2 training days</Text>
        {loading ? (
          <ActivityIndicator size="small" color={C.textMuted} />
        ) : (
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color={C.textSecondary} />
        )}
      </Pressable>

      {expanded && !loading && (
        days.length === 0 ? (
          <Text style={s.empty}>No sessions logged yet.</Text>
        ) : (
          // No height cap: only ever 2 day-cards, and clipping them inside a
          // short ScrollView with a hidden scrollbar made the 2nd day
          // invisible unless the coach happened to scroll. Full height, with
          // its own scroll only past a generous ceiling, keeps both visible.
          <ScrollView style={s.body} showsVerticalScrollIndicator>
            {/* On desktop the two days sit side by side instead of stacked —
                there's room, and it makes the two most recent days directly
                comparable at a glance. */}
            <View style={wide ? s.daysRow : undefined}>
              {days.map((day) => (
                <View key={day.dateKey} style={[s.dayCard, wide && s.dayCardWide]}>
                  <Text style={s.date}>{day.dateLabel}</Text>
                  {day.sessions.map((sess, si) => (
                    <View key={sess.id} style={s.session}>
                      {day.sessions.length > 1 && (
                        <Text style={s.sessionLabel}>Session {si + 1} · {sess.timeLabel}</Text>
                      )}
                      {sess.blocks.length === 0 ? (
                        <Text style={s.empty}>No blocks logged.</Text>
                      ) : (
                        <View style={wide ? s.blockGrid : undefined}>
                          {sess.blocks.map((b) => {
                            // Sends/attempts are only meaningful for sequence
                            // blocks (a graded route) — other non-S&C types
                            // (project bouldering, warmups, etc.) just show
                            // what was done, not a pass/fail tally.
                            const showStats = b.blockType === "sequence"
                            return (
                              <View
                                key={b.blockIndex}
                                style={[s.block, wide && s.blockWide, { borderLeftColor: b.color }]}
                              >
                                <View style={s.blockHeader}>
                                  <View style={[s.pill, { backgroundColor: b.color + "26" }]}>
                                    <Text style={[s.pillText, { color: b.color }]}>{formatBlockType(b.blockType)}</Text>
                                  </View>
                                  <Text style={s.blockName} numberOfLines={1}>{b.blockName}</Text>
                                </View>
                                {b.isSC ? (
                                  b.scLines.length > 0 ? (
                                    b.scLines.map((line, li) => <Text key={li} style={s.line}>{line}</Text>)
                                  ) : (
                                    <Text style={s.line}>No exercises logged</Text>
                                  )
                                ) : showStats ? (
                                  <Text style={s.line}>
                                    {b.total === 0
                                      ? "No attempts logged"
                                      : `${b.sends} send${b.sends !== 1 ? "s" : ""} / ${b.total} attempt${b.total !== 1 ? "s" : ""}`}
                                  </Text>
                                ) : null}
                              </View>
                            )
                          })}
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        )
      )}
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { marginHorizontal: 14, marginBottom: 8, backgroundColor: C.surfaceHigh, borderRadius: 12, overflow: "hidden" },
  toggle: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 12, paddingVertical: 10,
  },
  toggleText: { fontSize: 13, fontWeight: "700", color: C.textPrimary },

  // Generous ceiling — just a safety valve for an unusually packed day, not
  // meant to clip either of the 2 day-cards in the common case.
  body: { maxHeight: 480, paddingHorizontal: 10, paddingBottom: 10, gap: 10 },
  empty: { fontSize: 12, color: C.textMuted, paddingHorizontal: 12, paddingBottom: 10 },

  // Desktop: the two days sit side by side as columns.
  daysRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },

  // Each training day is its own card, distinct from the panel background.
  dayCard: {
    gap: 8, padding: 10, marginBottom: 10,
    backgroundColor: C.surface, borderRadius: 12,
    borderWidth: 1, borderColor: C.border,
  },
  dayCardWide: { flex: 1, marginBottom: 0, padding: 14 },
  date: { fontSize: 11, fontWeight: "800", color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },

  session: { gap: 8 },
  sessionLabel: { fontSize: 11, fontWeight: "600", color: C.textMuted },

  // Desktop: blocks flow as a wrapping grid instead of one column, so the
  // extra horizontal room is actually used instead of leaving it blank.
  blockGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },

  // Block cards — a colored left rail (by training adaptation) so the
  // coach can scan the day's mix at a glance, same palette as the session
  // donut chart uses.
  block: {
    gap: 3, padding: 10, borderRadius: 10,
    backgroundColor: C.surfaceHigh,
    borderLeftWidth: 3,
  },
  blockWide: { flexBasis: "47%", flexGrow: 1 },
  blockHeader: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  pill: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  pillText: { fontSize: 10, fontWeight: "700" },
  blockName: { fontSize: 12, fontWeight: "700", color: C.textPrimary, flex: 1 },
  line: { fontSize: 12, color: C.textSecondary, lineHeight: 17 },
})
