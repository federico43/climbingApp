import { C } from "@/utils/theme"
import { BoulderLevelOptions } from "@/components/ProjectPickerModal"
import { card } from "@/components/coach/styles"
import { AppUser, CheckinRow, getCheckinForToday, getUsers, setFlashLevel } from "@/services/BoulderGraphService"
import { useEffect, useState } from "react"
import { Alert, Pressable, StyleSheet, Text, View } from "react-native"

// Today's readiness check-in and the athlete's flash level (constraint
// warmups pick their colour range relative to it).
export function AthleteCard({ athlete, flashLevel, onPickFlashLevel }: {
  athlete: AppUser
  flashLevel: string | null
  onPickFlashLevel: (value: string) => void
}) {
  const [todayCheckin, setTodayCheckin] = useState<CheckinRow | null>(null)

  useEffect(() => {
    let cancelled = false
    setTodayCheckin(null)
    getCheckinForToday(athlete.$id).then((row) => { if (!cancelled) setTodayCheckin(row) })
    return () => { cancelled = true }
  }, [athlete.$id])

  return (
    <View style={card.card}>
      <Text style={card.title}>Athlete</Text>
      {todayCheckin && (
        <View style={styles.checkinRow}>
          <Text style={styles.checkinLabel}>Today</Text>
          <Text style={styles.checkinStat}>Rest {todayCheckin.restRating}/5</Text>
          <Text style={styles.checkinStat}>Ate: {todayCheckin.ate ? "Yes" : "Not yet"}</Text>
        </View>
      )}
      <View style={{ gap: 6 }}>
        <Text style={styles.label}>Flash level</Text>
        <Text style={card.sub}>Hardest colour they reliably flash. Tap again to clear.</Text>
        <View style={styles.chipWrap}>
          {BoulderLevelOptions.map((g) => {
            const sel = flashLevel === g.value
            return (
              <Pressable
                key={g.value}
                onPress={() => onPickFlashLevel(g.value)}
                style={[styles.gradeChip, sel && { backgroundColor: g.color, borderColor: g.color }]}
              >
                <View style={[styles.gradeDot, { backgroundColor: g.color }, sel && { backgroundColor: g.on }]} />
                <Text style={[styles.gradeText, sel && { color: g.on, fontWeight: "700" }]}>{g.label}</Text>
              </Pressable>
            )
          })}
        </View>
      </View>
    </View>
  )
}

// The athlete's flash level, shared by the card and the plan's Build.
// Re-reads the row rather than trusting the `athlete` prop: the roster is
// fetched once, so it'd show a stale level after a change. Tapping the
// selected colour again clears it.
export function useFlashLevel(athlete: AppUser): [string | null, (value: string) => void] {
  const [level, setLevel] = useState<string | null>(athlete.flashLevel ?? null)
  useEffect(() => {
    let cancelled = false
    setLevel(athlete.flashLevel ?? null)
    getUsers(athlete.$id).then((row: any) => { if (!cancelled && row) setLevel(row.flashLevel ?? null) })
    return () => { cancelled = true }
  }, [athlete.$id, athlete.flashLevel])

  async function pick(value: string) {
    const prev = level
    const next = value === prev ? null : value
    setLevel(next)
    try {
      await setFlashLevel(athlete.$id, next)
    } catch (e) {
      console.log(e)
      setLevel(prev)
      Alert.alert("Couldn't save flash level", "Does the `users` table have a `flashLevel` column in Appwrite yet?")
    }
  }
  return [level, pick]
}

const styles = StyleSheet.create({
  checkinRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  checkinLabel: { fontSize: 12, fontWeight: "700", color: C.green },
  checkinStat: { fontSize: 13.5, fontWeight: "600", color: C.textSecondary },
  label: { fontSize: 14, fontWeight: "700", color: C.textPrimary },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  gradeChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 1, borderColor: C.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
  },
  gradeDot: { width: 9, height: 9, borderRadius: 5 },
  gradeText: { fontSize: 12.5, color: C.textSecondary },
})
