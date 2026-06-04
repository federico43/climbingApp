import { getSessions, SessionRow } from "@/services/BoulderGraphService"
import { SessionDetailModal } from "@/components/SessionDetailModal"
import { useFocusEffect } from "@react-navigation/native"
import React, { useCallback, useState } from "react"
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { Calendar } from "react-native-calendars"
import { SafeAreaView } from "react-native-safe-area-context"

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionSummary {
  date: string        // "YYYY-MM-DD"
  sessions: SessionRow[]
}

interface SCRoundEntry {
  round: number
  reps: string
  weight: string
  rpe: string
  notes: string
  repsNum: number | null    // parsed numeric reps (avg for both-sides)
  rpeNum: number | null     // parsed numeric RPE (avg for both-sides)
}

interface SCExerciseEntry {
  name: string
  rounds: SCRoundEntry[]
}

// ─── S/C Summary ──────────────────────────────────────────────────────────────

function parseRepsNum(reps: string): number | null {
  // "12 reps" → 12
  const simple = reps.match(/^(\d+(?:\.\d+)?) reps$/)
  if (simple) return parseFloat(simple[1])
  // "L 8 / R 6 reps" → avg(8, 6) = 7
  const both = reps.match(/L\s*(\d+(?:\.\d+)?)\s*\/\s*R\s*(\d+(?:\.\d+)?)\s*reps/)
  if (both) return (parseFloat(both[1]) + parseFloat(both[2])) / 2
  return null
}

function parseRpeNum(rpe: string): number | null {
  // "RPE 7" → 7
  const simple = rpe.match(/^RPE\s*(\d+(?:\.\d+)?)$/)
  if (simple) return parseFloat(simple[1])
  // "RPE L7/R8" → avg(7, 8) = 7.5
  const both = rpe.match(/RPE\s*L(\d+(?:\.\d+)?)\/R(\d+(?:\.\d+)?)/)
  if (both) return (parseFloat(both[1]) + parseFloat(both[2])) / 2
  return null
}

function avg(nums: (number | null)[]): number | null {
  const valid = nums.filter((n): n is number => n !== null)
  if (valid.length === 0) return null
  return valid.reduce((a, b) => a + b, 0) / valid.length
}

function fmt(n: number | null, decimals = 1): string {
  if (n === null) return "—"
  return Number.isInteger(n) ? String(n) : n.toFixed(decimals)
}

function parseSCAttempts(attempts: any[], blockIndex: number): SCExerciseEntry[] {
  const scAttempts = attempts.filter(
    (a) => a.type === "strength_conditioning" && a.blockIndex === blockIndex
  )
  const byExercise = new Map<string, SCExerciseEntry>()

  for (const a of scAttempts) {
    let name: string
    let round: number
    let reps = ""
    let weight = ""
    let rpe = ""
    let notesTxt = ""

    if (a.scData) {
      const d = a.scData
      name = d.exerciseName ?? "Exercise"
      round = d.round ?? 1

      if (d.repsCompleted != null) reps = `${d.repsCompleted} reps`
      else if (d.repsLeft != null) reps = `L ${d.repsLeft} / R ${d.repsRight} reps`

      if (d.weight != null) weight = `${d.weight}${d.weightUnit ?? "kg"}`
      else if (d.weightLeft != null) weight = `L ${d.weightLeft} / R ${d.weightRight}${d.weightUnit ?? "kg"}`

      if (d.rpe != null) rpe = `RPE ${d.rpe}`
      else if (d.rpeLeft != null) rpe = `RPE L${d.rpeLeft}/R${d.rpeRight}`

      notesTxt = d.notes ?? ""
    } else {
      // Legacy notes string parsing
      const parts: string[] = (a.notes ?? "").split(" · ")
      name = parts[0] ?? "Exercise"
      const roundPart = parts.find((p) => p.startsWith("round "))
      round = roundPart ? parseInt(roundPart.replace("round ", ""), 10) : 1

      const repsPart = parts.find((p) => p.endsWith(" reps") && !p.startsWith("L ")) ?? ""
      const bothSidesPart = parts.find((p) => p.startsWith("L ") && p.includes(" reps")) ?? ""
      reps = bothSidesPart || repsPart

      const weightPart = parts.find((p) => (p.endsWith("kg") || p.endsWith("lb")) && !p.startsWith("L ")) ?? ""
      const bothSidesWeight = parts.find((p) => p.startsWith("L ") && (p.endsWith("kg") || p.endsWith("lb"))) ?? ""
      weight = bothSidesWeight || weightPart

      rpe = parts.find((p) => p.startsWith("RPE ")) ?? ""
      notesTxt = parts.find((p) => p.startsWith("notes: "))?.replace("notes: ", "") ?? ""
    }

    if (!byExercise.has(name)) {
      byExercise.set(name, { name, rounds: [] })
    }
    byExercise.get(name)!.rounds.push({
      round, reps, weight, rpe, notes: notesTxt,
      repsNum: parseRepsNum(reps),
      rpeNum: parseRpeNum(rpe),
    })
  }

  return Array.from(byExercise.values())
}

function SCBlockSummary({ block, attempts, blockIndex }: {
  block: any
  attempts: any[]
  blockIndex: number
}) {
  const exercises = parseSCAttempts(attempts, blockIndex)
  if (exercises.length === 0) return null

  return (
    <View style={scStyles.container}>
      <Text style={scStyles.header}>
        S/C · {block.rounds ?? "?"} rounds · {block.exercises?.length ?? exercises.length} exercises
      </Text>
      {exercises.map((ex, i) => {
        const avgReps = avg(ex.rounds.map((r) => r.repsNum))
        const avgRpe = avg(ex.rounds.map((r) => r.rpeNum))
        const hasStats = avgReps !== null || avgRpe !== null

        return (
          <View key={i} style={scStyles.exerciseBlock}>
            <Text style={scStyles.exerciseName}>{ex.name}</Text>
            {ex.rounds
              .sort((a, b) => a.round - b.round)
              .map((r, j) => (
                <View key={j} style={scStyles.roundRow}>
                  <Text style={scStyles.roundLabel}>R{r.round}</Text>
                  <Text style={scStyles.roundDetail}>
                    {[r.reps, r.weight, r.rpe].filter(Boolean).join("  ·  ") || "—"}
                  </Text>
                  {r.notes ? <Text style={scStyles.roundNotes}>"{r.notes}"</Text> : null}
                </View>
              ))}
            {hasStats && (
              <View style={scStyles.statsRow}>
                {avgReps !== null && (
                  <View style={scStyles.statChip}>
                    <Text style={scStyles.statLabel}>avg reps</Text>
                    <Text style={scStyles.statValue}>{fmt(avgReps)}</Text>
                  </View>
                )}
                {avgRpe !== null && (
                  <View style={scStyles.statChip}>
                    <Text style={scStyles.statLabel}>avg RPE</Text>
                    <Text style={scStyles.statValue}>{fmt(avgRpe)}</Text>
                  </View>
                )}
              </View>
            )}
          </View>
        )
      })}
    </View>
  )
}

const scStyles = StyleSheet.create({
  container: {
    marginTop: 6,
    backgroundColor: "#eef2f5",
    borderRadius: 10,
    padding: 10,
    gap: 8,
  },
  header: {
    fontSize: 11,
    fontWeight: "700",
    color: "#25343F",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  exerciseBlock: { gap: 3 },
  exerciseName: {
    fontSize: 13,
    fontWeight: "600",
    color: "#222",
  },
  roundRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    paddingLeft: 4,
  },
  roundLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#25343F",
    opacity: 0.6,
    width: 20,
    marginTop: 1,
  },
  roundDetail: {
    fontSize: 12,
    color: "#333",
    flex: 1,
  },
  roundNotes: {
    fontSize: 11,
    color: "#666",
    fontStyle: "italic",
    marginTop: 2,
  },
  statsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
    paddingLeft: 4,
  },
  statChip: {
    backgroundColor: "#25343F",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    flexDirection: "row",
    alignItems: "baseline",
    gap: 5,
  },
  statLabel: {
    fontSize: 10,
    color: "rgba(255,255,255,0.65)",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  statValue: {
    fontSize: 14,
    color: "#fff",
    fontWeight: "700",
  },
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateString(iso: string): string {
  return iso.slice(0, 10)   // "YYYY-MM-DD"
}

function blockLabel(block: any): string {
  switch (block.type) {
    case "project_bouldering": return "Project bouldering"
    case "constraint_warmup": return "Constraint warmup"
    case "strength_conditioning": return "Strength & conditioning"
    case "sequence": return "Sequence"
    case "four_by_four": return "4×4"
    default: return block.type ?? "Block"
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CalendarScreen() {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [modalDate, setModalDate] = useState<string | null>(null)

  useFocusEffect(
    useCallback(() => {
      load()
    }, [])
  )

  async function load() {
    setLoading(true)
    try {
      setSessions(await getSessions())
    } catch (e) {
      console.error("Failed to load sessions", e)
    } finally {
      setLoading(false)
    }
  }

  // Build marked dates map — one dot per session day
  const markedDates: Record<string, any> = {}
  for (const s of sessions) {
    const d = toDateString(s.$createdAt)
    if (!markedDates[d]) {
      markedDates[d] = {
        marked: true,
        dotColor: "#25343F",
        selected: d === selectedDate,
        selectedColor: "#25343F",
      }
    }
  }
  if (selectedDate && !markedDates[selectedDate]) {
    markedDates[selectedDate] = { selected: true, selectedColor: "#25343F" }
  }
  if (selectedDate && markedDates[selectedDate]) {
    markedDates[selectedDate] = {
      ...markedDates[selectedDate],
      selected: true,
      selectedColor: "#25343F",
    }
  }

  const selectedSessions = selectedDate
    ? sessions.filter((s) => toDateString(s.$createdAt) === selectedDate)
    : []

  const today = new Date().toISOString().slice(0, 10)

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Training calendar</Text>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : (
        <>
          <Calendar
            onDayPress={(day: { dateString: string }) =>
              setSelectedDate(prev => prev === day.dateString ? null : day.dateString)
            }
            markedDates={markedDates}
            maxDate={today}
            theme={{
              backgroundColor: "#fff",
              calendarBackground: "#fff",
              selectedDayBackgroundColor: "#25343F",
              selectedDayTextColor: "#fff",
              todayTextColor: "#25343F",
              dayTextColor: "#111",
              textDisabledColor: "#ccc",
              dotColor: "#25343F",
              selectedDotColor: "#fff",
              arrowColor: "#25343F",
              monthTextColor: "#111",
              textDayFontWeight: "500",
              textMonthFontWeight: "700",
              textDayHeaderFontWeight: "600",
            }}
            style={styles.calendar}
          />

          {selectedDate && (
            <View style={styles.detailSection}>
              <Text style={styles.detailDate}>
                {new Date(selectedDate + "T12:00:00").toLocaleDateString([], {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </Text>

              {selectedSessions.length === 0 ? (
                <Text style={styles.noSession}>No workout logged this day.</Text>
              ) : (
                <ScrollView showsVerticalScrollIndicator={false}>
                  {selectedSessions.map((session, i) => {
                    const blocks: any[] = (() => {
                      try { return JSON.parse(session.protocol) } catch { return [] }
                    })()
                    const attempts: any[] = (() => {
                      try { return JSON.parse(session.attempts) } catch { return [] }
                    })()
                    const sends = attempts.filter((a) => a.success).length

                    return (
                      <Pressable
                        key={session.$id}
                        style={({ pressed }) => [styles.sessionCard, pressed && { opacity: 0.75 }]}
                        onPress={() => setModalDate(selectedDate)}
                      >
                        <View style={styles.sessionCardHeader}>
                          <Text style={styles.sessionTime}>{formatTime(session.$createdAt)}</Text>
                          {sends > 0 && (
                            <View style={styles.sendsBadge}>
                              <Text style={styles.sendsBadgeText}>{sends} send{sends !== 1 ? "s" : ""}</Text>
                            </View>
                          )}
                        </View>

                        <View style={styles.blockList}>
                          {blocks.map((block, j) => (
                            <View key={j}>
                              <View style={styles.blockRow}>
                                <View style={styles.blockDot} />
                                <Text style={styles.blockLabel}>{blockLabel(block)}</Text>
                              </View>
                              {block.type === "strength_conditioning" && (
                                <SCBlockSummary
                                  block={block}
                                  attempts={attempts}
                                  blockIndex={j}
                                />
                              )}
                            </View>
                          ))}
                        </View>

                        <Text style={styles.attemptCount}>
                          {attempts.length} attempt{attempts.length !== 1 ? "s" : ""}
                          {" · "}{sends} send{sends !== 1 ? "s" : ""}
                          {"  ·  "}<Text style={styles.editHint}>tap to edit</Text>
                        </Text>
                      </Pressable>
                    )
                  })}
                </ScrollView>
              )}
            </View>
          )}

          {!selectedDate && sessions.length > 0 && (
            <View style={styles.hint}>
              <Text style={styles.hintText}>
                {sessions.length} session{sessions.length !== 1 ? "s" : ""} logged · tap a marked day to see details
              </Text>
            </View>
          )}

          {!selectedDate && sessions.length === 0 && (
            <View style={styles.hint}>
              <Text style={styles.hintText}>No sessions logged yet. Complete a workout to see it here.</Text>
            </View>
          )}
        </>
      )}

      <SessionDetailModal
        date={modalDate}
        sessions={sessions}
        onClose={() => setModalDate(null)}
        onDeleted={(id) => {
          setSessions((prev) => prev.filter((s) => s.$id !== id))
          setModalDate(null)
        }}
        onUpdated={(updated) => {
          setSessions((prev) => prev.map((s) => s.$id === updated.$id ? updated : s))
        }}
      />
    </SafeAreaView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  title: {
    fontSize: 24,
    fontWeight: "700",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  calendar: {
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  detailSection: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  detailDate: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 12,
    color: "#111",
  },
  noSession: {
    fontSize: 14,
    opacity: 0.4,
    marginTop: 8,
  },
  sessionCard: {
    backgroundColor: "#f5f5f5",
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    gap: 8,
  },
  sessionCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sessionTime: {
    fontSize: 13,
    opacity: 0.5,
    fontWeight: "600",
  },
  sendsBadge: {
    backgroundColor: "#25343F",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  sendsBadgeText: {
    color: "white",
    fontSize: 12,
    fontWeight: "600",
  },
  blockList: { gap: 5 },
  blockRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  blockDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#25343F",
    opacity: 0.5,
  },
  blockLabel: { fontSize: 14, fontWeight: "500", color: "#222" },
  attemptCount: {
    fontSize: 12,
    opacity: 0.45,
    marginTop: 2,
  },
  editHint: {
    color: "#25343F",
    fontWeight: "600",
    opacity: 1,
  },
  hint: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
  },
  hintText: {
    fontSize: 14,
    opacity: 0.4,
    textAlign: "center",
    lineHeight: 20,
  },
})
