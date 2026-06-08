import { C } from "@/utils/theme"
import { ScalePressable } from "@/components/ScalePressable"
import { ScreenEntry } from "@/components/ScreenEntry"
import { ScreenGradient } from "@/components/ScreenGradient"
import { AthleteAnalytics } from "@/components/AthleteAnalytics"
import { TrainingTimeline } from "@/components/TrainingTimeline"
import { AppUser, getAthletes } from "@/services/BoulderGraphService"
import { Ionicons } from "@expo/vector-icons"
import { useFocusEffect, useRouter } from "expo-router"
import { useCallback, useState } from "react"
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

// Top-bar coach tools (the former big cards). Assignments is gone — its review
// part is now the inline Training timeline.
type Tool = { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; route: string }
const TOOLS: Tool[] = [
  { key: "protocols", label: "Protocols", icon: "clipboard-outline", route: "/(tabs)/(buttonTabs)/protocolDesigner" },
  { key: "exercises", label: "Exercises", icon: "barbell-outline", route: "/(tabs)/(buttonTabs)/exercises" },
  { key: "spraywall", label: "Spray Wall", icon: "grid-outline", route: "/(tabs)/(buttonTabs)/sprayWall" },
]

export default function DesignScreen() {
  const router = useRouter()
  const [athletes, setAthletes] = useState<AppUser[]>([])
  const [loadingAthletes, setLoadingAthletes] = useState(true)
  const [selected, setSelected] = useState<AppUser | null>(null)

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      getAthletes()
        .then((list) => { if (!cancelled) setAthletes(list) })
        .catch(console.error)
        .finally(() => { if (!cancelled) setLoadingAthletes(false) })
      return () => { cancelled = true }
    }, [])
  )

  return (
    <ScreenGradient>
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenEntry>
        {/* ── Top bar ─────────────────────────────────────────────────────── */}
        <View style={styles.topBar}>
          {TOOLS.map((t) => (
            <ScalePressable key={t.key} style={styles.toolBtn} onPress={() => router.push(t.route as any)}>
              <Ionicons name={t.icon} size={20} color={C.green} />
              <Text style={styles.toolLabel}>{t.label}</Text>
            </ScalePressable>
          ))}
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* ── Training timeline ─────────────────────────────────────────── */}
          <TrainingTimeline />

          {/* ── Athletes ──────────────────────────────────────────────────── */}
          <View style={styles.athleteSection}>
            <Text style={styles.label}>Athletes</Text>
            {loadingAthletes ? (
              <ActivityIndicator style={{ marginVertical: 14 }} color={C.green} />
            ) : athletes.length === 0 ? (
              <Text style={styles.empty}>No athletes yet.</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
                {athletes.map((a) => {
                  const name = a.username ?? a.$id
                  const isSel = selected?.$id === a.$id
                  return (
                    <ScalePressable key={a.$id} style={styles.chip} onPress={() => setSelected(isSel ? null : a)}>
                      <View style={[styles.avatar, isSel && styles.avatarSel]}>
                        <Text style={[styles.avatarInitial, isSel && styles.avatarInitialSel]}>{name[0].toUpperCase()}</Text>
                      </View>
                      <Text style={[styles.chipName, isSel && styles.chipNameSel]} numberOfLines={1}>{name}</Text>
                    </ScalePressable>
                  )
                })}
              </ScrollView>
            )}
          </View>

          {/* ── Selected athlete data ─────────────────────────────────────── */}
          {selected ? (
            <AthleteAnalytics key={selected.$id} athlete={selected} />
          ) : (
            <View style={styles.prompt}>
              <Text style={styles.promptText}>Pick an athlete to see their training history</Text>
            </View>
          )}

          <View style={{ height: 32 }} />
        </ScrollView>
      </ScreenEntry>
    </SafeAreaView>
    </ScreenGradient>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "transparent" },

  topBar: {
    flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  toolBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    paddingVertical: 10,
  },
  toolLabel: { fontSize: 13, fontWeight: "700", color: C.textPrimary },

  scroll: { paddingHorizontal: 16, paddingTop: 14, gap: 16 },

  athleteSection: { gap: 8 },
  label: { fontSize: 13, fontWeight: "700", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.6 },
  strip: { gap: 14, paddingVertical: 2, paddingHorizontal: 2 },
  chip: { alignItems: "center", width: 64, gap: 6 },
  avatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: C.surfaceHigh, borderWidth: 2, borderColor: "transparent",
    alignItems: "center", justifyContent: "center",
  },
  avatarSel: { backgroundColor: C.green, borderColor: C.green },
  avatarInitial: { fontSize: 22, fontWeight: "800", color: C.green },
  avatarInitialSel: { color: C.bg },
  chipName: { fontSize: 12, color: C.textSecondary, fontWeight: "600", maxWidth: 64, textAlign: "center" },
  chipNameSel: { color: C.green, fontWeight: "700" },
  empty: { fontSize: 14, color: C.textMuted, paddingVertical: 8 },

  prompt: { alignItems: "center", paddingVertical: 30, paddingHorizontal: 24 },
  promptText: { fontSize: 14, color: C.textMuted, textAlign: "center" },
})
