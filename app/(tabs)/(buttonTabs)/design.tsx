import { C } from "@/utils/theme"
import { ScalePressable } from "@/components/ScalePressable"
import { ScreenEntry } from "@/components/ScreenEntry"
import { ScreenGradient } from "@/components/ScreenGradient"
import { SettingsButton } from "@/components/SettingsButton"
import { AthleteDetail } from "@/components/coach/AthleteDetail"
import { RosterList } from "@/components/coach/RosterList"
import { useCoachRoster } from "@/hooks/useCoachRoster"
import { filterRoster, INACTIVE_STEPS, type RosterFilter } from "@/utils/coachRoster"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { Ionicons } from "@expo/vector-icons"
import { useFocusEffect, useRouter } from "expo-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

// Coach dashboard (docs/coach-dashboard.md): roster + athlete detail.
// ≥1200: roster · detail main · detail side; 900–1199: roster · detail;
// <900: roster screen → detail screen.

const LAST_ATHLETE_KEY = "coach.lastAthleteId"
const WIDE = 900
const SPLIT = 1200

// Top-bar coach tools.
type Tool = { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; route: string }
const TOOLS: Tool[] = [
  { key: "exercises", label: "Exercises", icon: "barbell-outline", route: "/(tabs)/(buttonTabs)/exercises" },
  { key: "spraywall", label: "Spray Wall", icon: "grid-outline", route: "/(tabs)/(buttonTabs)/sprayWall" },
]

export default function DesignScreen() {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const isWide = width >= WIDE
  const split = width >= SPLIT
  const roster = useCoachRoster()
  const { refresh } = roster
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<RosterFilter | null>(null)
  const [inactiveDays, setInactiveDays] = useState<number>(INACTIVE_STEPS[0])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Phone only: the detail screen is showing.
  const [detailOpen, setDetailOpen] = useState(false)

  useFocusEffect(useCallback(() => { refresh() }, [refresh]))

  // Remember the last athlete (per device). Wide layouts re-open it; on a
  // phone it's just highlighted in the list.
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current || roster.athletes.length === 0) return
    restored.current = true
    AsyncStorage.getItem(LAST_ATHLETE_KEY)
      .then((id) => { if (id && roster.athletes.some((a) => a.$id === id)) setSelectedId((cur) => cur ?? id) })
      .catch(() => {})
  }, [roster.athletes])

  function select(id: string) {
    setSelectedId(id)
    setDetailOpen(true)
    AsyncStorage.setItem(LAST_ATHLETE_KEY, id).catch(() => {})
  }

  // Android back closes the phone's detail screen first.
  const phoneDetail = !isWide && detailOpen && !!selectedId
  useEffect(() => {
    if (!phoneDetail) return
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { setDetailOpen(false); return true })
    return () => sub.remove()
  }, [phoneDetail])

  // Same chip again: Inactive steps 7 → 14 → 30 → off; the others toggle off.
  function toggleFilter(f: RosterFilter) {
    if (f !== filter) {
      setFilter(f)
      if (f === "inactive") setInactiveDays(INACTIVE_STEPS[0])
      return
    }
    const next = f === "inactive" ? INACTIVE_STEPS.find((d) => d > inactiveDays) : undefined
    if (next) setInactiveDays(next)
    else { setFilter(null); setInactiveDays(INACTIVE_STEPS[0]) }
  }

  const counts = useMemo(() => ({
    homework: filterRoster(roster.summaries, "", "homework", inactiveDays).length,
    no_plan: filterRoster(roster.summaries, "", "no_plan", inactiveDays).length,
    inactive: filterRoster(roster.summaries, "", "inactive", inactiveDays).length,
  }), [roster.summaries, inactiveDays])
  const list = useMemo(
    () => filterRoster(roster.summaries, query, filter, inactiveDays),
    [roster.summaries, query, filter, inactiveDays],
  )
  const selected = roster.athletes.find((a) => a.$id === selectedId) ?? null

  async function pullRefresh() {
    setRefreshing(true)
    try { await refresh() } finally { setRefreshing(false) }
  }

  const rosterList = (
    <RosterList
      list={list}
      counts={counts}
      query={query}
      onQuery={setQuery}
      filter={filter}
      onFilter={toggleFilter}
      inactiveDays={inactiveDays}
      selectedId={selectedId}
      onSelect={select}
      showChevron={!isWide}
      refreshing={refreshing}
      onRefresh={pullRefresh}
    />
  )
  const detail = selected && (
    <AthleteDetail
      key={selected.$id}
      athlete={selected}
      roster={roster.athletes}
      split={split}
      wide={isWide}
      onBack={isWide ? undefined : () => setDetailOpen(false)}
      onChanged={refresh}
    />
  )

  return (
    <ScreenGradient>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScreenEntry>
          {!phoneDetail && (
            <View style={styles.topBar}>
              <Text style={styles.title}>Coach</Text>
              <View style={styles.tools}>
                {TOOLS.map((t) => (
                  <ScalePressable key={t.key} style={styles.toolBtn} onPress={() => router.push(t.route as any)}>
                    <Ionicons name={t.icon} size={18} color={C.green} />
                    {isWide && <Text style={styles.toolLabel}>{t.label}</Text>}
                  </ScalePressable>
                ))}
                {isWide && (
                  <Pressable style={styles.toolBtn} onPress={pullRefresh} accessibilityLabel="Refresh">
                    {refreshing ? <ActivityIndicator size="small" color={C.green} /> : <Ionicons name="refresh" size={18} color={C.green} />}
                  </Pressable>
                )}
                <SettingsButton />
              </View>
            </View>
          )}

          {roster.loading ? (
            <ActivityIndicator style={{ marginTop: 60 }} color={C.green} />
          ) : roster.error ? (
            <Pressable style={styles.center} onPress={pullRefresh}>
              <Ionicons name="cloud-offline-outline" size={32} color={C.textMuted} />
              <Text style={styles.centerText}>Couldn&apos;t load your athletes. Tap to retry.</Text>
            </Pressable>
          ) : isWide ? (
            <View style={styles.wide}>
              <View style={[styles.rosterPane, { width: split ? 300 : 280 }]}>{rosterList}</View>
              <View style={styles.detailPane}>
                {detail ?? (
                  <View style={styles.center}>
                    <Ionicons name="people-outline" size={32} color={C.textMuted} />
                    <Text style={styles.centerText}>Pick an athlete to see their homework, plan and activity.</Text>
                  </View>
                )}
              </View>
            </View>
          ) : phoneDetail ? (
            detail
          ) : (
            rosterList
          )}
        </ScreenEntry>
      </SafeAreaView>
    </ScreenGradient>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "transparent" },
  topBar: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  title: { flex: 1, fontSize: 26, fontWeight: "800", color: C.textPrimary, letterSpacing: -0.5 },
  tools: { flexDirection: "row", alignItems: "center", gap: 8 },
  toolBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, minWidth: 38, height: 38, justifyContent: "center",
    backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 10,
  },
  toolLabel: { fontSize: 13, fontWeight: "700", color: C.textPrimary },
  wide: { flex: 1, flexDirection: "row" },
  rosterPane: { borderRightWidth: 1, borderRightColor: C.border, paddingTop: 10 },
  detailPane: { flex: 1, minWidth: 0 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 32 },
  centerText: { fontSize: 14, color: C.textMuted, textAlign: "center" },
})
