import { paperSheet, useC, usePaperScope, useSheet } from "@/theme/paper/legacy"
import {
  INACTIVE_STEPS, lastSessionLabel, planStatusLabel,
  type AthleteSummary, type RosterFilter,
} from "@/utils/coachRoster"
import { Ionicons } from "@expo/vector-icons"
import { useEffect, useMemo, useRef } from "react"
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native"

const ROW_HEIGHT = 64
const GROUP_HEIGHT = 30

// Paper: the list is split under two mono labels (the roster is already
// sorted homework first). Legacy: one plain list.
type Item = { kind: "group"; key: string; label: string } | { kind: "row"; key: string; a: AthleteSummary }

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
  const C = useC()
  const P = usePaperScope()
  const styles = useSheet(stylesSheet)
  const listRef = useRef<FlatList<Item>>(null)
  const items = useMemo<Item[]>(() => {
    const rows = list.map((a): Item => ({ kind: "row", key: a.id, a }))
    if (!P) return rows
    const pending = list.filter((a) => a.pendingHomework > 0)
    if (pending.length === 0 || pending.length === list.length) return rows
    return [
      { kind: "group", key: "g-hw", label: "Pending homework first" },
      ...rows.slice(0, pending.length),
      { kind: "group", key: "g-rest", label: "Everyone else" },
      ...rows.slice(pending.length),
    ]
  }, [list, P])
  const offsets = useMemo(() => {
    const out: number[] = []
    let y = 0
    for (const it of items) { out.push(y); y += it.kind === "group" ? GROUP_HEIGHT : ROW_HEIGHT }
    return out
  }, [items])
  // Bring the remembered / selected athlete into view.
  const selectedIndex = items.findIndex((it) => it.kind === "row" && it.a.id === selectedId)
  useEffect(() => {
    if (selectedIndex > 3) listRef.current?.scrollToIndex({ index: selectedIndex, viewPosition: 0.3, animated: false })
  }, [selectedIndex])

  // The Inactive chip cycles 7 → 14 → 30 → off.
  const nextInactive = INACTIVE_STEPS.find((d) => d > inactiveDays)
  const chips: { key: RosterFilter; label: string }[] = [
    { key: "homework", label: "Homework" },
    { key: "no_plan", label: "No plan" },
    { key: "inactive", label: `Inactive ${inactiveDays}d+` },
    // Accounts the coach turned off — only shown when there are some.
    ...(counts.deactivated > 0 || filter === "deactivated" ? [{ key: "deactivated" as const, label: "Deactivated" }] : []),
  ]

  return (
    <FlatList
      ref={listRef}
      data={items}
      keyExtractor={(it) => it.key}
      getItemLayout={(_, index) => ({
        length: items[index]?.kind === "group" ? GROUP_HEIGHT : ROW_HEIGHT, offset: offsets[index] ?? 0, index,
      })}
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
              placeholder={P ? "Search by name" : "Search athletes"}
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
      renderItem={({ item }) => {
        if (item.kind === "group") return <Text style={styles.group}>{item.label}</Text>
        const a = item.a
        const sel = a.id === selectedId
        return (
          <Pressable style={[styles.row, sel && styles.rowSel]} onPress={() => onSelect(a.id)}>
            <View style={[styles.avatar, sel && styles.avatarSel]}>
              <Text style={[styles.avatarText, sel && styles.avatarTextSel]}>{a.name[0]?.toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, !a.active && styles.nameOff]} numberOfLines={1}>{a.name}</Text>
              <Text style={styles.meta} numberOfLines={1}>
                {a.active ? `${planStatusLabel(a)} · ${P ? "last " : ""}${lastSessionLabel(a)}` : "Deactivated"}
              </Text>
            </View>
            {a.pendingHomework > 0 && (
              P ? (
                // Paper Mint: pink = homework only. Urgent (overdue / missed) =
                // filled, the rest = outline, so it differs by fill, not hue.
                <View
                  style={[
                    styles.badge,
                    a.urgentHomework > 0
                      ? { backgroundColor: C.homework }
                      : { borderWidth: 1.5, borderColor: C.homework },
                  ]}
                  accessibilityLabel={`${a.pendingHomework} homework${a.urgentHomework > 0 ? ", overdue" : ""}`}
                >
                  <Text style={[styles.badgeText, { color: a.urgentHomework > 0 ? (P.mode === "dark" ? P.onMint : "#FFFFFF") : C.homework }]}>
                    {a.pendingHomework}
                  </Text>
                </View>
              ) : (
                <View style={[styles.badge, { backgroundColor: a.urgentHomework > 0 ? C.red : C.yellow }]}>
                  <Text style={styles.badgeText}>{a.pendingHomework}</Text>
                </View>
              )
            )}
            {showChevron && <Ionicons name="chevron-forward" size={16} color={C.textMuted} />}
          </Pressable>
        )
      }}
    />
  )
}

const stylesSheet = paperSheet((C, P) => StyleSheet.create({
  group: {
    height: GROUP_HEIGHT, paddingHorizontal: 6, paddingTop: 10,
    fontSize: 10.5, fontWeight: "600", textTransform: "uppercase", letterSpacing: 1.4, color: C.textSecondary,
  },
  content: { paddingHorizontal: 12, paddingBottom: 24 },
  head: { gap: 10, paddingTop: 4, paddingBottom: 10 },
  search: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.surfaceHigh, borderRadius: 12, paddingHorizontal: 12, height: 40,
    ...(P && { height: 44, borderRadius: 999, paddingHorizontal: 16, backgroundColor: P.card, borderWidth: 1.5, borderColor: P.inputBorder }),
  },
  searchInput: { flex: 1, color: C.textPrimary, fontSize: 14.5, height: 40 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 1, borderColor: C.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
  },
  chipOn: P ? { backgroundColor: P.ink, borderColor: P.ink } : { backgroundColor: C.green, borderColor: C.green },
  chipText: { fontSize: 12.5, fontWeight: "600", color: C.textSecondary },
  chipCount: { fontSize: 12, fontWeight: "800", color: C.textMuted },
  chipTextOn: { color: P ? P.paper : C.bg },
  hint: { fontSize: 11.5, color: C.textMuted },
  empty: { fontSize: 13.5, color: C.textMuted, textAlign: "center", paddingVertical: 24 },
  row: {
    height: ROW_HEIGHT, flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 10, borderRadius: 12,
  },
  rowSel: P ? { backgroundColor: P.card, borderWidth: 1.5, borderColor: P.ink } : { backgroundColor: C.surfaceHigh },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.surfaceHigh, alignItems: "center", justifyContent: "center", ...(P && { backgroundColor: "transparent", borderWidth: 1.5, borderColor: P.ink }) },
  avatarSel: P ? { backgroundColor: P.ink } : { backgroundColor: C.green },
  avatarText: { fontSize: 16, fontWeight: "800", color: P ? P.ink : C.green },
  avatarTextSel: { color: P ? P.paper : C.bg },
  name: { fontSize: 15, fontWeight: "700", color: C.textPrimary },
  nameOff: { color: C.textMuted },
  meta: { fontSize: 12, color: C.textSecondary, marginTop: 1 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  badgeText: { fontSize: 12, fontWeight: "800", color: C.bg },
}))
