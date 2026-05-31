import { C } from "@/utils/theme"
import { ScalePressable } from "@/components/ScalePressable"
import { ScreenEntry } from "@/components/ScreenEntry"
import { AppUser, getAthletes } from "@/services/BoulderGraphService"
import { useFocusEffect, useRouter } from "expo-router"
import { useCallback, useState } from "react"
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

// ─── Tool cards ───────────────────────────────────────────────────────────────

type ToolCard = { key: string; label: string; description: string; icon: string; route: string }

const PROGRAM_CARDS: ToolCard[] = [
  {
    key: "protocols",
    label: "Protocols",
    description: "Build & assign programs",
    icon: "📋",
    route: "/(tabs)/(buttonTabs)/protocolDesigner",
  },
  {
    key: "assignments",
    label: "Assignments",
    description: "Review athlete workouts",
    icon: "🗂",
    route: "/(tabs)/(buttonTabs)/review-assignments",
  },
]

const CONTENT_CARDS: ToolCard[] = [
  {
    key: "exercises",
    label: "Exercises",
    description: "Manage exercise library",
    icon: "💪",
    route: "/(tabs)/(buttonTabs)/exercises",
  },
  {
    key: "spraywall",
    label: "Spray Wall",
    description: "Create boulder routes",
    icon: "🧗",
    route: "/(tabs)/(buttonTabs)/sprayWall",
  },
]

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DesignScreen() {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const cardWidth = (width - H_PAD * 2 - CARD_GAP) / 2

  const [athletes, setAthletes] = useState<AppUser[]>([])
  const [loadingAthletes, setLoadingAthletes] = useState(true)

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

  function openDashboard(athleteId?: string) {
    router.push({
      pathname: "/(tabs)/(buttonTabs)/dashboard",
      params: athleteId ? { athleteId } : {},
    })
  }

  function renderCard(card: ToolCard) {
    return (
      <ScalePressable
        key={card.key}
        style={[styles.card, { width: cardWidth }]}
        onPress={() => router.push(card.route as any)}
      >
        <View style={styles.iconWrap}>
          <Text style={styles.icon}>{card.icon}</Text>
        </View>
        <Text style={styles.cardLabel}>{card.label}</Text>
        <Text style={styles.cardDesc}>{card.description}</Text>
      </ScalePressable>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenEntry>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text style={styles.title}>Design</Text>
            <Text style={styles.subtitle}>Coach tools</Text>
          </View>

          {/* ── Athletes ─────────────────────────────────────────────────── */}
          <View style={styles.section}>
            <Pressable style={styles.sectionHeader} onPress={() => openDashboard()} hitSlop={6}>
              <Text style={styles.sectionTitle}>Athletes</Text>
              <Text style={styles.sectionAction}>View all ›</Text>
            </Pressable>

            {loadingAthletes ? (
              <ActivityIndicator style={{ marginVertical: 18 }} color={C.green} />
            ) : athletes.length === 0 ? (
              <Text style={styles.emptyText}>No athletes yet.</Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.athleteStrip}
              >
                {athletes.map((a) => {
                  const name = a.username ?? a.$id
                  return (
                    <ScalePressable
                      key={a.$id}
                      style={styles.athleteChip}
                      onPress={() => openDashboard(a.$id)}
                    >
                      <View style={styles.avatar}>
                        <Text style={styles.avatarInitial}>{name[0].toUpperCase()}</Text>
                      </View>
                      <Text style={styles.athleteName} numberOfLines={1}>{name}</Text>
                    </ScalePressable>
                  )
                })}
              </ScrollView>
            )}
          </View>

          {/* ── Programs ─────────────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Programs</Text>
            <View style={styles.grid}>{PROGRAM_CARDS.map(renderCard)}</View>
          </View>

          {/* ── Content ──────────────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Content</Text>
            <View style={styles.grid}>{CONTENT_CARDS.map(renderCard)}</View>
          </View>
        </ScrollView>
      </ScreenEntry>
    </SafeAreaView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const H_PAD = 16
const CARD_GAP = 12

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  scroll: { paddingHorizontal: H_PAD, paddingBottom: 32 },

  header: { paddingHorizontal: 4, paddingTop: 12, paddingBottom: 12, gap: 2 },
  title: { fontSize: 28, fontWeight: "800", color: C.textPrimary, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: C.textSecondary, fontWeight: "500" },

  section: { marginTop: 18 },
  sectionHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  sectionTitle: {
    fontSize: 13, fontWeight: "700", color: C.textSecondary,
    textTransform: "uppercase", letterSpacing: 0.6,
    paddingHorizontal: 4, marginBottom: 10,
  },
  sectionAction: { fontSize: 13, fontWeight: "600", color: C.green, marginBottom: 10 },

  // Athletes strip
  athleteStrip: { gap: 14, paddingHorizontal: 4, paddingVertical: 2 },
  athleteChip: { alignItems: "center", width: 64, gap: 6 },
  avatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: C.surfaceHigh, borderWidth: 1, borderColor: C.border,
    alignItems: "center", justifyContent: "center",
  },
  avatarInitial: { fontSize: 22, fontWeight: "800", color: C.green },
  athleteName: { fontSize: 12, color: C.textSecondary, fontWeight: "600", maxWidth: 64, textAlign: "center" },
  emptyText: { fontSize: 14, color: C.textMuted, paddingHorizontal: 4, paddingVertical: 8 },

  // Tool grid
  grid: { flexDirection: "row", flexWrap: "wrap", gap: CARD_GAP },
  card: {
    backgroundColor: C.surface, borderRadius: 18,
    borderWidth: 1, borderColor: C.border,
    padding: 16, gap: 8, minHeight: 140, justifyContent: "flex-start",
  },
  iconWrap: {
    width: 48, height: 48, borderRadius: 14,
    backgroundColor: C.surfaceHigh,
    alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  icon: { fontSize: 24 },
  cardLabel: { fontSize: 17, fontWeight: "700", color: C.textPrimary, letterSpacing: -0.2 },
  cardDesc: { fontSize: 13, color: C.textSecondary, lineHeight: 18 },
})
