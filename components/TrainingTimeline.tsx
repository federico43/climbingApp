import { C } from "@/utils/theme"
import { DayAdaptationSummary, DayTimelineBar } from "@/components/DayTimelineBar"
import { friendlyDateLabel, isSameLocalDay, localDateKey } from "@/utils/dateGroups"
import { AppUser, getAthletes, getSessionsByUserId, SessionRow } from "@/services/BoulderGraphService"
import { Ionicons } from "@expo/vector-icons"
import { useEffect, useMemo, useState } from "react"
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native"

// The day-review: scrub a day and see every athlete who trained that day as a
// segmented session bar, plus a day-wide adaptation summary.
export function TrainingTimeline() {
  const [athletes, setAthletes] = useState<AppUser[]>([])
  const [dayKey, setDayKey] = useState<string>(localDateKey(new Date()))
  const [dayBars, setDayBars] = useState<{ athlete: AppUser; sessions: SessionRow[] }[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    getAthletes().then(setAthletes).catch(console.error)
  }, [])

  useEffect(() => {
    if (athletes.length === 0) { setDayBars([]); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    Promise.all(
      athletes.map(async (athlete) => {
        try {
          const all = await getSessionsByUserId(athlete.$id)
          return { athlete, sessions: all.filter((s) => isSameLocalDay(s.$createdAt, dayKey)) }
        } catch {
          return { athlete, sessions: [] as SessionRow[] }
        }
      })
    )
      .then((results) => { if (!cancelled) setDayBars(results.filter((r) => r.sessions.length > 0)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [athletes, dayKey])

  function shiftDay(delta: number) {
    const d = new Date(dayKey + "T12:00:00")
    d.setDate(d.getDate() + delta)
    const next = localDateKey(d)
    if (next > localDateKey(new Date())) return // no future
    setDayKey(next)
  }
  const atToday = dayKey === localDateKey(new Date())
  const allDaySessions = useMemo(() => dayBars.flatMap((b) => b.sessions), [dayBars])

  return (
    <View style={styles.card}>
      <Pressable style={styles.header} onPress={() => setOpen((o) => !o)}>
        <Text style={styles.title}>Training timeline</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={C.textSecondary} />
      </Pressable>

      {open && (
        <>
          <View style={styles.dayNav}>
            <Pressable onPress={() => shiftDay(-1)} hitSlop={10} style={styles.dayNavBtn}>
              <Ionicons name="chevron-back" size={16} color={C.textSecondary} />
            </Pressable>
            <Text style={styles.dayNavLabel}>{friendlyDateLabel(dayKey)}</Text>
            <Pressable
              onPress={() => shiftDay(1)}
              hitSlop={10}
              style={[styles.dayNavBtn, atToday && { opacity: 0.35 }]}
              disabled={atToday}
            >
              <Ionicons name="chevron-forward" size={16} color={C.textSecondary} />
            </Pressable>
          </View>

          {loading ? (
            <ActivityIndicator style={{ marginVertical: 18 }} color={C.green} />
          ) : dayBars.length === 0 ? (
            <Text style={styles.empty}>No sessions this day.</Text>
          ) : (
            <>
              <View style={{ paddingHorizontal: 14, paddingTop: 4, paddingBottom: 10 }}>
                <DayAdaptationSummary sessions={allDaySessions} />
              </View>
              {dayBars.map(({ athlete, sessions }) =>
                sessions.map((s) => (
                  <DayTimelineBar
                    key={`${athlete.$id}-${s.$id}`}
                    athleteName={athlete.username ?? athlete.$id}
                    session={s}
                  />
                ))
              )}
            </>
          )}
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.surface, borderRadius: 14,
    borderWidth: 1, borderColor: C.border, paddingBottom: 8, overflow: "hidden",
  },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 12,
  },
  title: { fontSize: 13, fontWeight: "700", color: C.textPrimary, textTransform: "uppercase", letterSpacing: 0.6 },
  empty: { textAlign: "center", color: C.textMuted, fontSize: 12, paddingVertical: 20, fontStyle: "italic" },
  dayNav: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14, paddingBottom: 10 },
  dayNavBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.surfaceHigh, alignItems: "center", justifyContent: "center" },
  dayNavLabel: { fontSize: 13, fontWeight: "700", color: C.textPrimary, minWidth: 120, textAlign: "center" },
})
