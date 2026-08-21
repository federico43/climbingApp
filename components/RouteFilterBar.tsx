import { C } from "@/utils/theme"
import { MAX_LEVEL, MIN_LEVEL, ROUTE_TYPES, ROUTE_TYPE_LABEL } from "@/utils/sequenceVariations"
import { Ionicons } from "@expo/vector-icons"
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"

export interface RouteFilters {
  search: string
  type: string | null    // null = any type
  level: number | null   // null = any level
  wallId: string | null  // null = any wall
}

export const EMPTY_ROUTE_FILTERS: RouteFilters = { search: "", type: null, level: null, wallId: null }

export function routeFiltersActive(f: RouteFilters): boolean {
  return f.search.trim().length > 0 || f.type !== null || f.level !== null || f.wallId !== null
}

// Minimal shape needed to label the wall chips — callers pass their already-
// loaded SprayWallRow[] straight through.
export interface FilterableWall {
  $id: string
  name: string
}

// Shared by the sequence route picker and the Spray Wall list — both browse
// the same SprayRouteRow[] and should filter the same way.
export function applyRouteFilters<T extends { name: string; type?: string; level?: number; wallId?: string }>(
  routes: T[],
  filters: RouteFilters
): T[] {
  const q = filters.search.trim().toLowerCase()
  return routes.filter((r) => {
    if (q && !r.name.toLowerCase().includes(q)) return false
    if (filters.type && r.type !== filters.type) return false
    if (filters.level != null && r.level !== filters.level) return false
    if (filters.wallId && r.wallId !== filters.wallId) return false
    return true
  })
}

const LEVELS = Array.from({ length: MAX_LEVEL - MIN_LEVEL + 1 }, (_, i) => MIN_LEVEL + i)

interface Props {
  filters: RouteFilters
  onChange: (f: RouteFilters) => void
  // When provided (and there's more than one), a "wall" chip group is added
  // to the row so routes can be filtered by which physical wall they're on.
  // Screens that already have their own wall picker (e.g. the Spray Wall
  // tab) can omit this to avoid a redundant second wall selector.
  walls?: FilterableWall[]
}

export function RouteFilterBar({ filters, onChange, walls }: Props) {
  // The type/level chips can scroll out of view, so a selected chip (e.g. a
  // level near the end of the row) can end up with no visible trace that a
  // filter is even on. This summary stays put under the search box and
  // covers all filters at once, whatever's scrolled off.
  const active = routeFiltersActive(filters)
  const showWalls = !!walls && walls.length > 1
  const selectedWallName = filters.wallId ? walls?.find((w) => w.$id === filters.wallId)?.name : null
  return (
    <View style={styles.wrap}>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={C.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={filters.search}
          onChangeText={(v) => onChange({ ...filters, search: v })}
          placeholder="Search by name"
          placeholderTextColor={C.textMuted}
          returnKeyType="search"
        />
        {filters.search.length > 0 && (
          <Pressable onPress={() => onChange({ ...filters, search: "" })} hitSlop={10}>
            <Ionicons name="close-circle" size={16} color={C.textMuted} />
          </Pressable>
        )}
      </View>

      {active && (
        <View style={styles.summaryRow}>
          <Text style={styles.summaryText} numberOfLines={1}>
            {[
              filters.search.trim() ? `"${filters.search.trim()}"` : null,
              filters.type ? ROUTE_TYPE_LABEL[filters.type] : null,
              filters.level != null ? `Lvl ${filters.level}` : null,
              selectedWallName,
            ].filter(Boolean).join(" · ")}
          </Text>
          <Pressable onPress={() => onChange(EMPTY_ROUTE_FILTERS)} hitSlop={8}>
            <Text style={styles.summaryClear}>Clear</Text>
          </Pressable>
        </View>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        <Pressable
          style={[styles.chip, filters.type === null && styles.chipActive]}
          onPress={() => onChange({ ...filters, type: null })}
        >
          <Text style={[styles.chipText, filters.type === null && styles.chipTextActive]}>All types</Text>
        </Pressable>
        {ROUTE_TYPES.map((t) => (
          <Pressable
            key={t}
            style={[styles.chip, filters.type === t && styles.chipActive]}
            onPress={() => onChange({ ...filters, type: filters.type === t ? null : t })}
          >
            <Text style={[styles.chipText, filters.type === t && styles.chipTextActive]}>
              {ROUTE_TYPE_LABEL[t]}
            </Text>
          </Pressable>
        ))}

        <View style={styles.chipDivider} />

        <Pressable
          style={[styles.chip, filters.level === null && styles.chipActive]}
          onPress={() => onChange({ ...filters, level: null })}
        >
          <Text style={[styles.chipText, filters.level === null && styles.chipTextActive]}>All levels</Text>
        </Pressable>
        {LEVELS.map((lvl) => (
          <Pressable
            key={lvl}
            style={[styles.chip, filters.level === lvl && styles.chipActive]}
            onPress={() => onChange({ ...filters, level: filters.level === lvl ? null : lvl })}
          >
            <Text style={[styles.chipText, filters.level === lvl && styles.chipTextActive]}>Lvl {lvl}</Text>
          </Pressable>
        ))}

        {showWalls && (
          <>
            <View style={styles.chipDivider} />
            <Pressable
              style={[styles.chip, filters.wallId === null && styles.chipActive]}
              onPress={() => onChange({ ...filters, wallId: null })}
            >
              <Text style={[styles.chipText, filters.wallId === null && styles.chipTextActive]}>All walls</Text>
            </Pressable>
            {walls!.map((w) => (
              <Pressable
                key={w.$id}
                style={[styles.chip, filters.wallId === w.$id && styles.chipActive]}
                onPress={() => onChange({ ...filters, wallId: filters.wallId === w.$id ? null : w.$id })}
              >
                <Text style={[styles.chipText, filters.wallId === w.$id && styles.chipTextActive]} numberOfLines={1}>
                  {w.name}
                </Text>
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface,
  },
  searchInput: { flex: 1, fontSize: 14, color: C.textPrimary, padding: 0 },
  summaryRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8,
    marginHorizontal: 16,
  },
  summaryText: { flex: 1, fontSize: 12, color: C.textMuted },
  summaryClear: { fontSize: 12, fontWeight: "700", color: C.green },
  chipRow: { paddingHorizontal: 16, gap: 8, alignItems: "center" },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 16, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.surface,
  },
  chipActive: { backgroundColor: C.green, borderColor: C.green },
  chipText: { fontSize: 12, fontWeight: "600", color: C.textSecondary },
  chipTextActive: { color: C.bg },
  chipDivider: { width: 1, height: 18, backgroundColor: C.border, marginHorizontal: 2 },
})
