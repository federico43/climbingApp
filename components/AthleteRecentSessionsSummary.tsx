import { C } from "@/utils/theme"
import { adaptationColor } from "@/utils/adaptations"
import { getSessionsByUserId, SessionRow } from "@/services/BoulderGraphService"
import { colourLabel } from "@/utils/boulderColours"
import { fallReasonLabel, PROJECT_V2, summarizeProjectAttempts } from "@/utils/progression/projectBouldering"
import { Ionicons } from "@expo/vector-icons"
import { useEffect, useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"

// Collapsible "what did they do last time" panel for the workout builder —
// so a coach can see the athlete's last two training days (S&C average
// reps per exercise included) without leaving the screen to go dig through their history.
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

function avg(nums: number[]): string {
  const n = nums.reduce((a, b) => a + b, 0) / nums.length
  return String(Math.round(n * 10) / 10)
}

// One line per exercise — its average reps across the sets logged in the
// block — rather than every set. Covers the three S&C exercise shapes
// (plain reps, left/right, and 7/3s series) written by
// StrengthConditioningBlock's handleExerciseDone. Exercises keep the order
// they were first logged in.
function scSummaryLines(scSets: any[]): string[] {
  const byExercise = new Map<string, any[]>()
  for (const sc of scSets) {
    const name = sc.exerciseName ?? "Exercise"
    byExercise.set(name, [...(byExercise.get(name) ?? []), sc])
  }
  return [...byExercise.entries()].map(([exName, sets]) => {
    // A swapped-in exercise says what it replaced (utils/scSwap).
    const from = sets.find((x) => x.swappedFrom?.exerciseName)?.swappedFrom.exerciseName
    const name = from ? `${exName} (for ${from})` : exName
    const reps = sets.filter((x) => x.repsCompleted != null).map((x) => Number(x.repsCompleted))
    if (reps.length) return `${name}: avg ${avg(reps)} reps`
    const sided = sets.filter((x) => x.repsLeft != null)
    if (sided.length) {
      return `${name}: avg L ${avg(sided.map((x) => Number(x.repsLeft)))} · R ${avg(sided.map((x) => Number(x.repsRight ?? 0)))}`
    }
    const series = sets.filter((x) => x.seriesDone != null).map((x) => Number(x.seriesDone))
    if (series.length) return `${name}: avg ${avg(series)} series`
    return name
  })
}

interface SummaryBlock {
  blockIndex: number
  blockName: string
  blockType: string
  color: string
  isSC: boolean
  scLines: string[]
  // Project bouldering v2: "Yellow · 9 attempts · sent" + top fall reason.
  projectLine?: string
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

function projectLine(attempts: any[]): string {
  const p = summarizeProjectAttempts(attempts)
  const parts = [
    p.grade ? colourLabel(p.grade) : "",
    `${p.attempts} attempt${p.attempts !== 1 ? "s" : ""}`,
    p.sent ? "sent ✓" : "not sent",
    p.reasons.length ? `mostly ${fallReasonLabel(p.reasons[0].key).toLowerCase()} (${p.reasons[0].count})` : "",
    p.reviewClips ? `🎥 ${p.reviewClips} to review` : "",
  ]
  return parts.filter(Boolean).join(" · ")
}

function summarizeSession(session: SessionRow, attempts: any[]): SessionSummary {
  let protocol: any[] = []
  try { protocol = JSON.parse(session.protocol) } catch {}

  const blocks: SummaryBlock[] = protocol.map((block: any, blockIndex: number) => {
    // A coached block's Done marker isn't an attempt (§12) — only the coach's
    // sequences, which carry a routeId, are.
    const blockAttempts = attempts.filter((a: any) => a.blockIndex === blockIndex && !(a.coached && !a.routeId))
    const isSC = block.type === "strength_conditioning"
    const name = block.blockName ?? formatBlockType(block.type ?? "")
    return {
      blockIndex,
      blockName: block.coached ? `${name} · coached` : name,
      blockType: block.type ?? "",
      color: adaptationColor(block),
      isSC,
      scLines: isSC ? scSummaryLines(blockAttempts.filter((a: any) => a.scData).map((a: any) => a.scData)) : [],
      projectLine: block.type === "project_bouldering" && !block.coached && blockAttempts.some((a: any) => a.pbv === PROJECT_V2)
        ? projectLine(blockAttempts)
        : undefined,
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
                                ) : b.projectLine ? (
                                  <Text style={s.line}>{b.projectLine}</Text>
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
