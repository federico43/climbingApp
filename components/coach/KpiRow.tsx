import { C } from "@/utils/theme"
import type { RosterFilter, RosterKpis } from "@/utils/coachRoster"
import { Ionicons } from "@expo/vector-icons"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"

interface Kpi {
  key: string
  value: number
  label: string
  sub?: string
  icon: keyof typeof Ionicons.glyphMap
  color: string
  filter?: RosterFilter
}

// Roster-wide numbers; the ones with a filter apply it when tapped.
// Scrolls sideways when it doesn't fit (phone).
export function KpiRow({ kpis, inactiveDays, activeFilter, onFilter, scroll }: {
  kpis: RosterKpis
  inactiveDays: number
  activeFilter: RosterFilter | null
  onFilter: (f: RosterFilter) => void
  scroll: boolean
}) {
  const items: Kpi[] = [
    {
      key: "homework", value: kpis.withHomework, label: "with pending homework", icon: "document-text-outline",
      color: kpis.withUrgentHomework > 0 ? C.red : C.yellow, filter: "homework",
      sub: kpis.withUrgentHomework > 0 ? `${kpis.withUrgentHomework} overdue / can't attend` : undefined,
    },
    { key: "week", value: kpis.workoutsThisWeek, label: "workouts this week", icon: "flash-outline", color: C.green },
    { key: "noplan", value: kpis.withoutPlan, label: "without a plan", icon: "calendar-outline", color: C.textPrimary, filter: "no_plan" },
    {
      key: "inactive", value: kpis.inactive, label: `inactive ${inactiveDays}+ days`, icon: "moon-outline",
      color: C.textPrimary, filter: "inactive",
    },
  ]
  const cards = items.map((k) => {
    const active = !!k.filter && k.filter === activeFilter
    return (
      <Pressable
        key={k.key}
        disabled={!k.filter}
        onPress={() => k.filter && onFilter(k.filter)}
        style={[styles.card, scroll ? styles.cardScroll : styles.cardFlex, active && styles.cardActive]}
      >
        <View style={styles.top}>
          <Text style={[styles.value, { color: k.color }]}>{k.value}</Text>
          <Ionicons name={k.icon} size={18} color={C.textMuted} />
        </View>
        <Text style={styles.label} numberOfLines={2}>{k.label}</Text>
        {k.sub && <Text style={styles.sub} numberOfLines={1}>{k.sub}</Text>}
      </Pressable>
    )
  })
  return scroll ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>{cards}</ScrollView>
  ) : (
    <View style={styles.row}>{cards}</View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10 },
  card: { backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 14, gap: 4 },
  cardFlex: { flex: 1 },
  cardScroll: { width: 150 },
  cardActive: { borderColor: C.green },
  top: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  value: { fontSize: 30, fontWeight: "800", letterSpacing: -0.5, fontVariant: ["tabular-nums"] },
  label: { fontSize: 12.5, fontWeight: "600", color: C.textSecondary },
  sub: { fontSize: 11, color: C.red, fontWeight: "600" },
})
