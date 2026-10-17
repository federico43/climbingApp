import { C } from "@/utils/theme"
import {
  INACTIVE_STEPS, lastSessionLabel, planStatusLabel,
  type AthleteSummary, type RosterFilter,
} from "@/utils/coachRoster"
import { Ionicons } from "@expo/vector-icons"
import { useEffect, useRef } from "react"
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native"

const ROW_HEIGHT = 64

// The athlete list: instant search, quick filters, one row per athlete with
// a homework badge, plan status and days since the last session.
export function RosterList({
  list,
  counts,
  query,
  onQuery,
  filter,
  onFilter,
  inactiveDays,
  selectedId,
  onSelect,
  header,
  showChevron,
  refreshing,
  onRefresh,
}: {
  list: AthleteSummary[]
  counts: Record<RosterFilter, number>
  query: string
  onQuery: (q: string) => void
  filter: RosterFilter | null
  onFilter: (f: RosterFilter) => void
  inactiveDays: number
  selectedId: string | null
  onSelect: (id: string) => void
  header?: React.ReactElement
  showChevron: boolean
  refreshing: boolean
  onRefresh: () => void
}) {
  const listRef = useRef<FlatList<AthleteSummary>>(null)
  // Bring the remembered / selected athlete into view.
  const selectedIndex = list.findIndex((a) => a.id === selectedId)
  useEffect(() => {
    if (selectedIndex > 3) listRef.current?.scrollToIndex({ index: selectedIndex, viewPosition: 0.3, animated: false })
  }, [selectedIndex])

  // The Inactive chip cycles 7 → 14 → 30 → off.
  const nextInactive = INACTIVE_STEPS.find((d) => d > inactiveDays)
  const chips: { key: RosterFilter; label: string }[] = [
    { key: "homework", label: "Homework" },
    { key: "no_plan", label: "No plan" },
    { key: "inactive", label: `Inactive ${inactiveDays}d+` },
  ]

  return (
    <FlatList
      ref={listRef}
      data={list}
      keyExtractor={(a) => a.id}
      getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
      onScrollToIndexFailed={() => {}}
      keyboardShouldPersistTaps="handled"
      refreshing={refreshing}
      onRefresh={onRefresh}
      contentContainerStyle={styles.content}
      ListHeaderComponent={
        <View style={styles.head}>
          {header}
          <View style={styles.search}>
            <Ionicons name="search" size={16} color={C.textMuted} />
            <TextInput
              value={query}
              onChangeText={onQuery}
              placeholder="Search athletes"
              placeholderTextColor={C.textMuted}
              style={styles.searchInput}
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="while-editing"
            />
            {query.length > 0 && (
              <Pressable onPress={() => onQuery("")} hitSlop={8} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={16} color={C.textMuted} />
              </Pressable>
            )}
          </View>
          <View style={styles.chips}>
            {chips.map((c) => {
              const on = filter === c.key
              return (
                <Pressable key={c.key} style={[styles.chip, on && styles.chipOn]} onPress={() => onFilter(c.key)}>
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.label}</Text>
                  <Text style={[styles.chipCount, on && styles.chipTextOn]}>{counts[c.key]}</Text>
                </Pressable>
              )
            })}
          </View>
          {filter === "inactive" && (
            <Text style={styles.hint}>
              {nextInactive ? `Tap again for ${nextInactive}+ days` : "Tap again to clear"}
            </Text>
          )}
        </View>
      }
      ListEmptyComponent={<Text style={styles.empty}>{query || filter ? "No athletes match." : "No athletes yet."}</Text>}
      renderItem={({ item: a }) => {
        const sel = a.id === selectedId
        return (
          <Pressable style={[styles.row, sel && styles.rowSel]} onPress={() => onSelect(a.id)}>
            <View style={[styles.avatar, sel && styles.avatarSel]}>
              <Text style={[styles.avatarText, sel && styles.avatarTextSel]}>{a.name[0]?.toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{a.name}</Text>
              <Text style={styles.meta} numberOfLines={1}>
                {planStatusLabel(a)} · {lastSessionLabel(a)}
              </Text>
            </View>
            {a.pendingHomework > 0 && (
              <View style={[styles.badge, { backgroundColor: a.urgentHomework > 0 ? C.red : C.yellow }]}>
                <Text style={styles.badgeText}>{a.pendingHomework}</Text>
              </View>
            )}
            {showChevron && <Ionicons name="chevron-forward" size={16} color={C.textMuted} />}
          </Pressable>
        )
      }}
    />
  )
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 12, paddingBottom: 24 },
  head: { gap: 10, paddingTop: 4, paddingBottom: 10 },
  search: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.surfaceHigh, borderRadius: 12, paddingHorizontal: 12, height: 40,
  },
  searchInput: { flex: 1, color: C.textPrimary, fontSize: 14.5, height: 40 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 1, borderColor: C.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
  },
  chipOn: { backgroundColor: C.green, borderColor: C.green },
  chipText: { fontSize: 12.5, fontWeight: "600", color: C.textSecondary },
  chipCount: { fontSize: 12, fontWeight: "800", color: C.textMuted },
  chipTextOn: { color: C.bg },
  hint: { fontSize: 11.5, color: C.textMuted },
  empty: { fontSize: 13.5, color: C.textMuted, textAlign: "center", paddingVertical: 24 },
  row: {
    height: ROW_HEIGHT, flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 10, borderRadius: 12,
  },
  rowSel: { backgroundColor: C.surfaceHigh },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.surfaceHigh, alignItems: "center", justifyContent: "center" },
  avatarSel: { backgroundColor: C.green },
  avatarText: { fontSize: 16, fontWeight: "800", color: C.green },
  avatarTextSel: { color: C.bg },
  name: { fontSize: 15, fontWeight: "700", color: C.textPrimary },
  meta: { fontSize: 12, color: C.textSecondary, marginTop: 1 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  badgeText: { fontSize: 12, fontWeight: "800", color: C.bg },
})
