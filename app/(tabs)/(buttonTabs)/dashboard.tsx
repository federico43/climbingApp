import { C } from "@/utils/theme"
import { ScalePressable } from "@/components/ScalePressable"
import { AthleteAnalytics } from "@/components/AthleteAnalytics"
import { AppUser, getAthletes } from "@/services/BoulderGraphService"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useEffect, useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

// ─── Athlete avatar chip ──────────────────────────────────────────────────────

function AthleteChip({ athlete, selected, onPress }: { athlete: AppUser; selected: boolean; onPress: () => void }) {
  const initial = (athlete.username ?? athlete.$id)[0].toUpperCase()
  return (
    <ScalePressable style={styles.chip} onPress={onPress}>
      <View style={[styles.avatar, selected && styles.avatarSelected]}>
        <Text style={[styles.avatarInitial, selected && styles.avatarInitialSelected]}>{initial}</Text>
      </View>
      <Text style={[styles.chipName, selected && styles.chipNameSelected]} numberOfLines={1}>
        {athlete.username ?? athlete.$id}
      </Text>
      {selected && <View style={styles.chipDot} />}
    </ScalePressable>
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ athleteId?: string }>()

  const [athletes, setAthletes] = useState<AppUser[]>([])
  const [loadingAthletes, setLoadingAthletes] = useState(true)
  const [selectedAthlete, setSelectedAthlete] = useState<AppUser | null>(null)

  useEffect(() => {
    getAthletes().then(setAthletes).catch(console.error).finally(() => setLoadingAthletes(false))
  }, [])

  useEffect(() => {
    if (!params.athleteId || athletes.length === 0) return
    const found = athletes.find((a) => a.$id === params.athleteId)
    if (found && found.$id !== selectedAthlete?.$id) setSelectedAthlete(found)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.athleteId, athletes])

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backArrow}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Dashboard</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.athleteSection}>
        <Text style={styles.athleteSectionLabel}>Athletes</Text>
        {loadingAthletes ? (
          <ActivityIndicator style={{ marginVertical: 12 }} color={C.green} />
        ) : athletes.length === 0 ? (
          <Text style={styles.noAthletes}>No athletes found</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {athletes.map((athlete) => (
              <AthleteChip
                key={athlete.$id}
                athlete={athlete}
                selected={selectedAthlete?.$id === athlete.$id}
                onPress={() => setSelectedAthlete(athlete)}
              />
            ))}
          </ScrollView>
        )}
      </View>

      {!selectedAthlete ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>👆</Text>
          <Text style={styles.emptyTitle}>Pick an athlete</Text>
          <Text style={styles.emptyText}>Their training history will appear here</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <AthleteAnalytics key={selectedAthlete.$id} athlete={selectedAthlete} />
          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  backArrow: { fontSize: 34, color: C.textSecondary, lineHeight: 36 },
  title: { flex: 1, fontSize: 18, fontWeight: "700", textAlign: "center", color: C.textPrimary },

  athleteSection: { paddingTop: 16, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: C.border, gap: 4 },
  athleteSectionLabel: { fontSize: 11, fontWeight: "700", color: C.textMuted, textTransform: "uppercase", letterSpacing: 1, paddingHorizontal: 20 },
  chipRow: { paddingHorizontal: 16, paddingVertical: 10, gap: 12 },
  chip: { alignItems: "center", gap: 6, width: 64 },
  avatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: C.surfaceHigh, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent" },
  avatarSelected: { backgroundColor: C.green, borderColor: C.green },
  avatarInitial: { fontSize: 20, fontWeight: "700", color: C.textSecondary },
  avatarInitialSelected: { color: C.bg },
  chipName: { fontSize: 11, color: C.textMuted, textAlign: "center", fontWeight: "500" },
  chipNameSelected: { color: C.green, fontWeight: "700" },
  chipDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: C.green },
  noAthletes: { fontSize: 14, color: C.textMuted, paddingHorizontal: 20, paddingVertical: 12 },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 40 },
  emptyIcon: { fontSize: 36, marginBottom: 4 },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: C.textPrimary },
  emptyText: { fontSize: 14, color: C.textSecondary, textAlign: "center" },

  scroll: { paddingHorizontal: 16, paddingTop: 16, gap: 16 },
})
