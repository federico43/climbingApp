import { C } from "@/utils/theme"
import { DayAdaptationSummary, DayTimelineBar } from "@/components/DayTimelineBar"
import { friendlyDateLabel, isSameLocalDay, localDateKey } from "@/utils/dateGroups"
import {
  AppUser,
  deleteAthlete,
  getAssignedProtocol,
  getAthletes,
  getSessionsByUserId,
  ProtocolRow,
  SessionRow,
} from "@/services/BoulderGraphService"
import { Ionicons } from "@expo/vector-icons"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { useRouter } from "expo-router"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import DraggableFlatList, { RenderItemParams } from "react-native-draggable-flatlist"

const HIDDEN_KEY = "review-assignments:hidden-athletes"
const ORDER_KEY = "review-assignments:athlete-order"
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

// ─── Types ────────────────────────────────────────────────────────────────────

type SortMode = "name" | "protocol"

interface Assignment {
  athlete: AppUser
  protocol: ProtocolRow | null
  blocks: any[]
}

const BLOCK_LABELS: Record<string, string> = {
  project_bouldering: "Project bouldering",
  constraint_warmup: "Constraint warmup",
  strength_conditioning: "Strength & conditioning",
  exploration_session: "Boulder Logger",
  sequence: "Sequence",
  free_session: "Free session",
}

const BLOCK_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  project_bouldering: "flame",
  constraint_warmup: "thermometer",
  strength_conditioning: "barbell",
  exploration_session: "search",
  sequence: "footsteps",
  free_session: "time",
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ReviewAssignmentsScreen() {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState("")
  const [onlyUnassigned, setOnlyUnassigned] = useState(false)
  const [sort, setSort] = useState<SortMode>("name")
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  const [showHidden, setShowHidden] = useState(false)
  const [reorderMode, setReorderMode] = useState(false)
  const [customOrder, setCustomOrder] = useState<string[]>([])
  // Day timeline state
  const [dayKey, setDayKey] = useState<string>(localDateKey(new Date()))
  const [dayBars, setDayBars] = useState<{ athlete: AppUser; sessions: SessionRow[] }[]>([])
  const [loadingDay, setLoadingDay] = useState(false)
  const [showDayDashboard, setShowDayDashboard] = useState(true)

  // Load hidden-athlete ids + custom order from device storage on mount
  useEffect(() => {
    AsyncStorage.getItem(HIDDEN_KEY).then((raw) => {
      if (!raw) return
      try { setHiddenIds(new Set(JSON.parse(raw))) } catch {}
    })
    AsyncStorage.getItem(ORDER_KEY).then((raw) => {
      if (!raw) return
      try { setCustomOrder(JSON.parse(raw)) } catch {}
    })
  }, [])

  function persistOrder(ids: string[]) {
    setCustomOrder(ids)
    AsyncStorage.setItem(ORDER_KEY, JSON.stringify(ids)).catch(() => {})
  }

  function persistHidden(next: Set<string>) {
    setHiddenIds(next)
    AsyncStorage.setItem(HIDDEN_KEY, JSON.stringify(Array.from(next))).catch(() => {})
  }

  function toggleHidden(athleteId: string) {
    const next = new Set(hiddenIds)
    if (next.has(athleteId)) next.delete(athleteId)
    else next.add(athleteId)
    persistHidden(next)
  }

  // Pick how many columns based on viewport width — narrow phone = 1 col,
  // tablet/desktop browsers get a side-by-side grid.
  const columns = width >= 1400 ? 4 : width >= 1024 ? 3 : width >= 720 ? 2 : 1
  const COLUMN_GAP = 14
  const HORIZONTAL_PADDING = 16
  const cardWidth = columns === 1
    ? undefined
    : (width - HORIZONTAL_PADDING * 2 - COLUMN_GAP * (columns - 1)) / columns

  const load = useCallback(async () => {
    const athletes = await getAthletes()
    const rows: Assignment[] = await Promise.all(
      athletes.map(async (athlete) => {
        let protocol: ProtocolRow | null = null
        let blocks: any[] = []
        try {
          protocol = await getAssignedProtocol(athlete.$id)
          if (protocol?.blocks) {
            blocks = JSON.parse(protocol.blocks)
          }
        } catch { /* ignore — show as no-protocol */ }
        return { athlete, protocol, blocks }
      })
    )
    setAssignments(rows)
  }, [])

  useEffect(() => {
    setLoading(true)
    load().finally(() => setLoading(false))
  }, [load])

  // Fetch each athlete's sessions for the selected day, in parallel.
  useEffect(() => {
    if (assignments.length === 0) { setDayBars([]); return }
    let cancelled = false
    setLoadingDay(true)
    Promise.all(
      assignments.map(async ({ athlete }) => {
        try {
          const all = await getSessionsByUserId(athlete.$id)
          const sessions = all.filter((s) => isSameLocalDay(s.$createdAt, dayKey))
          return { athlete, sessions }
        } catch {
          return { athlete, sessions: [] as SessionRow[] }
        }
      })
    )
      .then((results) => {
        if (cancelled) return
        // Only show athletes that actually trained that day
        setDayBars(results.filter((r) => r.sessions.length > 0))
      })
      .finally(() => { if (!cancelled) setLoadingDay(false) })
    return () => { cancelled = true }
  }, [assignments, dayKey])

  function shiftDay(delta: number) {
    const d = new Date(dayKey + "T12:00:00")
    d.setDate(d.getDate() + delta)
    const next = localDateKey(d)
    // Don't allow navigating into the future
    if (next > localDateKey(new Date())) return
    setDayKey(next)
  }
  const atToday = dayKey === localDateKey(new Date())
  const allDaySessions = useMemo(() => dayBars.flatMap((b) => b.sessions), [dayBars])

  function handleDelete(athlete: AppUser) {
    const name = athlete.username ?? athlete.$id
    Alert.alert(
      "Delete athlete",
      `Remove "${name}" from your roster? Their account login will remain but the profile will be deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteAthlete(athlete.$id)
              setAssignments((prev) => prev.filter((r) => r.athlete.$id !== athlete.$id))
            } catch (e: any) {
              Alert.alert("Error", e?.message ?? "Could not delete athlete")
            }
          },
        },
      ]
    )
  }

  // Search + filter + sort
  const view = useMemo(() => {
    let rows = assignments
    if (!showHidden) {
      rows = rows.filter((r) => !hiddenIds.has(r.athlete.$id))
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      rows = rows.filter((r) =>
        (r.athlete.username ?? r.athlete.$id).toLowerCase().includes(q) ||
        (r.protocol?.name ?? "").toLowerCase().includes(q)
      )
    }
    if (onlyUnassigned) {
      rows = rows.filter((r) => !r.protocol)
    }
    // If we have a custom order saved, use it first. Anything not in the
    // custom order falls through to the regular sort.
    if (customOrder.length > 0) {
      const index = new Map(customOrder.map((id, i) => [id, i]))
      rows = [...rows].sort((a, b) => {
        const ai = index.has(a.athlete.$id) ? index.get(a.athlete.$id)! : Number.POSITIVE_INFINITY
        const bi = index.has(b.athlete.$id) ? index.get(b.athlete.$id)! : Number.POSITIVE_INFINITY
        if (ai !== bi) return ai - bi
        // Unassigned athletes still go to the bottom among unordered
        if (!!a.protocol !== !!b.protocol) return a.protocol ? -1 : 1
        return (a.athlete.username ?? "").localeCompare(b.athlete.username ?? "")
      })
    } else {
      rows = [...rows].sort((a, b) => {
        // Always push athletes without a protocol to the bottom, regardless of sort mode
        if (!!a.protocol !== !!b.protocol) return a.protocol ? -1 : 1
        if (sort === "protocol") {
          return (a.protocol?.name ?? "").localeCompare(b.protocol?.name ?? "")
        }
        return (a.athlete.username ?? "").localeCompare(b.athlete.username ?? "")
      })
    }
    return rows
  }, [assignments, query, onlyUnassigned, sort, hiddenIds, showHidden, customOrder])

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.navigate("/(tabs)/(buttonTabs)/design" as any)}
          style={styles.backBtn}
          hitSlop={10}
        >
          <Ionicons name="chevron-back" size={20} color={C.textSecondary} />
        </Pressable>
        <Text style={styles.title}>Review assignments</Text>
        <View style={styles.backBtn} />
      </View>

      {/* Day timeline dashboard */}
      <View style={styles.dashboard}>
        <Pressable
          style={styles.dashboardHeader}
          onPress={() => setShowDayDashboard((v) => !v)}
          hitSlop={4}
        >
          <Text style={styles.dashboardTitle}>Training timeline</Text>
          <Ionicons
            name={showDayDashboard ? "chevron-up" : "chevron-down"}
            size={16}
            color={C.textSecondary}
          />
        </Pressable>

        {showDayDashboard && (
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

            {loadingDay ? (
              <ActivityIndicator style={{ marginVertical: 18 }} color={C.green} />
            ) : dayBars.length === 0 ? (
              <Text style={styles.dashboardEmpty}>No sessions this day.</Text>
            ) : (
              <>
                {/* Day-wide adaptation summary */}
                <View style={{ paddingHorizontal: 14, paddingTop: 4, paddingBottom: 10 }}>
                  <DayAdaptationSummary sessions={allDaySessions} />
                </View>

                {/* Per-athlete bars */}
                {dayBars.map(({ athlete, sessions }) =>
                  sessions.map((s, i) => (
                    <DayTimelineBar
                      key={`${athlete.$id}-${s.$id}`}
                      athleteName={athlete.username ?? athlete.$id}
                      session={s}
                      onSegmentPress={(seg) => {
                        // Placeholder — wire to a block-detail modal in a later phase
                        console.log("segment tapped", athlete.username, seg.block?.blockName)
                      }}
                    />
                  ))
                )}
              </>
            )}
          </>
        )}
      </View>

      {/* Search + filters */}
      <View style={styles.controls}>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color={C.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search athlete or protocol"
            placeholderTextColor={C.textMuted}
            style={styles.searchInput}
          />
          {!!query && (
            <Pressable onPress={() => setQuery("")} hitSlop={10}>
              <Ionicons name="close-circle" size={18} color={C.textMuted} />
            </Pressable>
          )}
        </View>
        <View style={styles.filterRow}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Switch value={onlyUnassigned} onValueChange={setOnlyUnassigned} />
              <Text style={styles.filterLabel}>Unassigned only</Text>
            </View>
            {hiddenIds.size > 0 && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Switch value={showHidden} onValueChange={setShowHidden} />
                <Text style={styles.filterLabel}>Show hidden ({hiddenIds.size})</Text>
              </View>
            )}
          </View>
          <View style={styles.sortRow}>
            <Pressable
              style={[styles.sortChip, sort === "name" && styles.sortChipActive]}
              onPress={() => setSort("name")}
            >
              <Text style={[styles.sortChipText, sort === "name" && styles.sortChipTextActive]}>
                Name
              </Text>
            </Pressable>
            <Pressable
              style={[styles.sortChip, sort === "protocol" && styles.sortChipActive]}
              onPress={() => setSort("protocol")}
            >
              <Text style={[styles.sortChipText, sort === "protocol" && styles.sortChipTextActive]}>
                Protocol
              </Text>
            </Pressable>
            <Pressable
              style={[styles.sortChip, reorderMode && styles.sortChipActive]}
              onPress={() => setReorderMode((v) => !v)}
            >
              <Ionicons
                name={reorderMode ? "checkmark" : "swap-vertical"}
                size={14}
                color={reorderMode ? C.textPrimary : C.textSecondary}
              />
              <Text style={[styles.sortChipText, reorderMode && styles.sortChipTextActive, { marginLeft: 4 }]}>
                {reorderMode ? "Done" : "Reorder"}
              </Text>
            </Pressable>
            {customOrder.length > 0 && !reorderMode && (
              <Pressable
                style={styles.sortChip}
                onPress={() => persistOrder([])}
              >
                <Text style={styles.sortChipText}>Reset</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={C.green} />
      ) : reorderMode ? (
        // Drag-and-drop single-column list. Save new order on every drop.
        <DraggableFlatList
          data={view}
          keyExtractor={(row) => row.athlete.$id}
          contentContainerStyle={styles.list}
          onDragEnd={({ data }) => persistOrder(data.map((r) => r.athlete.$id))}
          renderItem={({ item, drag, isActive }: RenderItemParams<Assignment>) => (
            <View
              style={[
                { width: "100%", marginBottom: COLUMN_GAP },
                isActive && { opacity: 0.7 },
              ]}
            >
              <AssignmentCard
                row={item}
                isHidden={hiddenIds.has(item.athlete.$id)}
                onTapProtocol={() => {}}
                onDelete={() => handleDelete(item.athlete)}
                onToggleHidden={() => toggleHidden(item.athlete.$id)}
                onDragHandle={drag}
              />
            </View>
          )}
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true)
                try { await load() }
                finally { setRefreshing(false) }
              }}
              tintColor={C.green}
              colors={[C.green]}
            />
          }
        >
          {view.length === 0 ? (
            <Text style={styles.empty}>No athletes match.</Text>
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: COLUMN_GAP }}>
              {view.map((row) => (
                <View
                  key={row.athlete.$id}
                  style={cardWidth ? { width: cardWidth } : { width: "100%" }}
                >
                  <AssignmentCard
                    row={row}
                    isHidden={hiddenIds.has(row.athlete.$id)}
                    onTapProtocol={() => {
                      if (row.protocol) {
                        router.push("/(tabs)/(buttonTabs)/protocolDesigner")
                      }
                    }}
                    onDelete={() => handleDelete(row.athlete)}
                    onToggleHidden={() => toggleHidden(row.athlete.$id)}
                  />
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function AssignmentCard({
  row,
  isHidden,
  onTapProtocol,
  onDelete,
  onToggleHidden,
  onDragHandle,
}: {
  row: Assignment
  isHidden: boolean
  onTapProtocol: () => void
  onDelete: () => void
  onToggleHidden: () => void
  onDragHandle?: () => void
}) {
  const { athlete, protocol, blocks } = row
  const initial = (athlete.username ?? athlete.$id)[0].toUpperCase()

  return (
    <View style={[styles.card, isHidden && { opacity: 0.55 }]}>
      {/* Athlete header */}
      <View style={styles.athleteRow}>
        {onDragHandle && (
          <Pressable onLongPress={onDragHandle} delayLongPress={120} style={styles.dragHandle}>
            <Ionicons name="menu" size={20} color={C.textMuted} />
          </Pressable>
        )}
        <View style={styles.avatar}>
          <Text style={styles.avatarInitial}>{initial}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.athleteName} numberOfLines={1}>
            {athlete.username ?? athlete.$id}
          </Text>
          {protocol ? (
            <Pressable onPress={onTapProtocol} hitSlop={6}>
              <Text style={styles.protocolName} numberOfLines={1}>
                {protocol.name}
              </Text>
            </Pressable>
          ) : (
            <Text style={styles.noProtocol}>No protocol assigned</Text>
          )}
        </View>
        {protocol && (
          <View style={styles.blocksCountPill}>
            <Text style={styles.blocksCountPillText}>{blocks.length}</Text>
          </View>
        )}
        <Pressable onPress={onToggleHidden} hitSlop={10} style={styles.deleteBtn}>
          <Ionicons
            name={isHidden ? "eye-off-outline" : "eye-outline"}
            size={18}
            color={C.textMuted}
          />
        </Pressable>
        <Pressable onPress={onDelete} hitSlop={10} style={styles.deleteBtn}>
          <Ionicons name="trash-outline" size={18} color={C.textMuted} />
        </Pressable>
      </View>

      {/* Blocks list */}
      {protocol && blocks.length > 0 && (
        <View style={styles.blocksList}>
          {blocks.map((b, i) => (
            <BlockRow key={i} index={i + 1} block={b} />
          ))}
        </View>
      )}
    </View>
  )
}

// ─── Block row ────────────────────────────────────────────────────────────────

function BlockRow({ index, block }: { index: number; block: any }) {
  const typeLabel = BLOCK_LABELS[block.type] ?? block.type
  const iconName = BLOCK_ICONS[block.type] ?? "cube-outline"
  return (
    <View style={styles.blockRow}>
      <View style={styles.blockIndexCol}>
        <Text style={styles.blockIndexNum}>{index}</Text>
      </View>
      <View style={styles.blockIconWrap}>
        <Ionicons name={iconName as any} size={16} color={C.green} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.blockTitle} numberOfLines={1}>
          {block.blockName || typeLabel}
        </Text>
        <Text style={styles.blockType}>{typeLabel}</Text>
        <BlockParams block={block} />
      </View>
    </View>
  )
}

// ─── Per-type parameter summary ───────────────────────────────────────────────

function BlockParams({ block }: { block: any }) {
  switch (block.type) {
    case "constraint_warmup":
      return (
        <Text style={styles.params}>
          <Param label="Level" value={block.level} />
          <Param label="Attempts" value={block.targetAttempts} />
        </Text>
      )
    case "project_bouldering":
      return (
        <Text style={styles.params}>
          <Param label="Attempts" value={block.targetAttempts} />
          <Param label="Rest" value={block.restTime ? `${block.restTime}s` : undefined} />
        </Text>
      )
    case "sequence":
      return (
        <Text style={styles.params}>
          <Param label="Route" value={block.routeName} />
          <Param label="Attempts" value={block.targetAttempts} />
          <Param label="Rest" value={block.restTime ? `${block.restTime}s` : undefined} />
        </Text>
      )
    case "strength_conditioning":
      return (
        <>
          <Text style={styles.params}>
            <Param label="Rounds" value={block.rounds} />
            <Param label="Rest" value={block.restBetweenRounds ? `${block.restBetweenRounds}s` : undefined} />
          </Text>
          {Array.isArray(block.exercises) && block.exercises.length > 0 && (
            <View style={{ marginTop: 4, gap: 2 }}>
              {block.exercises.map((ex: any, i: number) => (
                <Text key={i} style={styles.exerciseLine}>
                  • {ex.name || "(unnamed)"}{ex.reps ? ` ${ex.reps}` : ""}{ex.edge ? ` · ${ex.edge}` : ""}{ex.series ? ` · ${ex.series} sets` : ""}
                </Text>
              ))}
            </View>
          )}
        </>
      )
    case "exploration_session":
      return (
        <Text style={styles.params}>
          <Param label="Time limit" value={block.timeLimit ? `${block.timeLimit} min` : "none"} />
        </Text>
      )
    case "free_session":
      return block.description ? (
        <Text style={styles.descParam} numberOfLines={2}>
          {block.description}
        </Text>
      ) : null
    default:
      return null
  }
}

function Param({ label, value }: { label: string; value: any }) {
  if (value === undefined || value === null || value === "") return null
  return <Text style={styles.params}>{label}: <Text style={styles.paramValue}>{String(value)}</Text>  </Text>
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.surfaceHigh,
    alignItems: "center", justifyContent: "center",
  },
  title: {
    flex: 1, textAlign: "center",
    fontSize: 17, fontWeight: "700", color: C.textPrimary,
  },

  // Day timeline dashboard
  dashboard: {
    marginHorizontal: 16,
    marginTop: 14,
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1, borderColor: C.border,
    paddingBottom: 8,
    overflow: "hidden",
  },
  dashboardHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 12,
  },
  dashboardTitle: {
    fontSize: 13, fontWeight: "700", color: C.textPrimary,
    textTransform: "uppercase", letterSpacing: 0.6,
  },
  dashboardEmpty: {
    textAlign: "center", color: C.textMuted, fontSize: 12,
    paddingVertical: 20, fontStyle: "italic",
  },
  dayNav: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14,
    paddingBottom: 10,
  },
  dayNavBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: C.surfaceHigh,
    alignItems: "center", justifyContent: "center",
  },
  dayNavLabel: { fontSize: 13, fontWeight: "700", color: C.textPrimary, minWidth: 120, textAlign: "center" },

  controls: {
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8, gap: 12,
  },
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.surface, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: Platform.OS === "ios" ? 10 : 4,
    borderWidth: 1, borderColor: C.border,
  },
  searchInput: { flex: 1, color: C.textPrimary, fontSize: 14, padding: 0, paddingVertical: 8 },

  filterRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  filterLabel: { fontSize: 13, color: C.textSecondary, fontWeight: "500" },
  sortRow: { flexDirection: "row", gap: 6 },
  sortChip: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  sortChipActive: { backgroundColor: C.surfaceHigh, borderColor: C.surfaceHigh },
  sortChipText: { fontSize: 12, fontWeight: "600", color: C.textSecondary },
  sortChipTextActive: { color: C.textPrimary },

  list: { padding: 16, gap: 14, paddingBottom: 140 },
  empty: { textAlign: "center", color: C.textMuted, fontSize: 14, marginTop: 60 },

  card: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1, borderColor: C.border,
    overflow: "hidden",
  },
  athleteRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: C.surfaceHigh,
    alignItems: "center", justifyContent: "center",
  },
  avatarInitial: { fontSize: 16, fontWeight: "700", color: C.green },
  athleteName: { fontSize: 16, fontWeight: "700", color: C.textPrimary },
  protocolName: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  noProtocol: { fontSize: 13, color: C.red, marginTop: 2, fontStyle: "italic" },
  blocksCountPill: {
    backgroundColor: C.surfaceHigh, borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  blocksCountPillText: { fontSize: 12, fontWeight: "700", color: C.textSecondary },
  deleteBtn: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
    marginLeft: 4,
  },
  dragHandle: {
    width: 28, height: 32,
    alignItems: "center", justifyContent: "center",
  },

  blocksList: { padding: 14, gap: 10 },
  blockRow: {
    flexDirection: "row", gap: 10, alignItems: "flex-start",
  },
  blockIndexCol: { width: 18, alignItems: "center", paddingTop: 2 },
  blockIndexNum: { fontSize: 11, fontWeight: "700", color: C.textMuted },
  blockIconWrap: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: C.surfaceHigh,
    alignItems: "center", justifyContent: "center",
  },
  blockTitle: { fontSize: 14, fontWeight: "600", color: C.textPrimary },
  blockType: { fontSize: 11, color: C.textMuted, marginTop: 1, marginBottom: 4 },
  params: { fontSize: 12, color: C.textSecondary, lineHeight: 17 },
  paramValue: { color: C.textPrimary, fontWeight: "600" },
  descParam: { fontSize: 12, color: C.textSecondary, fontStyle: "italic", lineHeight: 17 },
  exerciseLine: { fontSize: 12, color: C.textSecondary, lineHeight: 17 },
})

