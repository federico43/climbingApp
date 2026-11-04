import { C } from "@/utils/theme"
import { useAuth } from "@/components/auth-context"
import { ScreenGradient } from "@/components/ScreenGradient"
import { SubScreenHeader } from "@/components/SubScreenHeader"
import { loadPushLog, PushLogEntry, PushStatus } from "@/services/pushLog"
import { groupByDay, humanize, timeLabel } from "@/utils/pushLog"
import { useFocusEffect } from "@react-navigation/native"
import { useCallback, useMemo, useState } from "react"
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

// Settings › Notifications sent (coach only): every push the server sent, to
// whom, when, and whether it went out — to spot notification bugs.
const STATUS: Record<PushStatus, { label: string; color: string }> = {
  sent: { label: "Sent", color: C.green },
  failed: { label: "Failed", color: C.red },
  no_token: { label: "No device", color: C.textMuted },
}

export default function PushLogScreen() {
  const { role } = useAuth()
  const [entries, setEntries] = useState<PushLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [problemsOnly, setProblemsOnly] = useState(false)
  const [person, setPerson] = useState<{ id: string; name: string } | null>(null)

  const load = useCallback(async () => {
    try {
      setEntries(await loadPushLog({ userId: person?.id, problemsOnly }))
      setErrorText(null)
    } catch (e: any) {
      setErrorText(e?.message ?? "Couldn't load the log.")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [person, problemsOnly])

  useFocusEffect(
    useCallback(() => {
      if (role !== "coach") return
      setLoading(true)
      load()
    }, [role, load]),
  )

  const groups = useMemo(() => groupByDay(entries), [entries])

  return (
    <ScreenGradient>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <SubScreenHeader title="Notifications sent" subtitle="Every push, newest first" />

        <View style={styles.filters}>
          <Chip label="All" active={!problemsOnly} onPress={() => setProblemsOnly(false)} />
          <Chip label="Problems" active={problemsOnly} onPress={() => setProblemsOnly(true)} />
          {person ? <Chip label={`${person.name} ✕`} active onPress={() => setPerson(null)} /> : null}
        </View>

        {role !== "coach" ? (
          <Text style={styles.empty}>Only coaches can see this.</Text>
        ) : loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={C.green} />
        ) : (
          <ScrollView
            contentContainerStyle={styles.scroll}
            refreshControl={<RefreshControl refreshing={refreshing} tintColor={C.green} onRefresh={() => { setRefreshing(true); load() }} />}
          >
            {errorText ? <Text style={[styles.empty, { color: C.red }]}>{errorText}</Text> : null}
            {!errorText && groups.length === 0 ? (
              <Text style={styles.empty}>
                {problemsOnly ? "No failed notifications." : "Nothing logged yet. Pushes show up here once they're sent."}
              </Text>
            ) : null}
            {groups.map((g) => (
              <View key={g.label} style={styles.section}>
                <Text style={styles.sectionLabel}>{g.label}</Text>
                <View style={styles.card}>
                  {g.entries.map((e, i) => (
                    <Row
                      key={e.id}
                      entry={e}
                      last={i === g.entries.length - 1}
                      onPerson={() => setPerson({ id: e.userId, name: e.userName || "athlete" })}
                    />
                  ))}
                </View>
              </View>
            ))}
            {entries.length >= 300 ? <Text style={styles.empty}>Showing the latest 300.</Text> : null}
          </ScrollView>
        )}
      </SafeAreaView>
    </ScreenGradient>
  )
}

function Row({ entry: e, last, onPerson }: { entry: PushLogEntry; last: boolean; onPerson: () => void }) {
  const st = STATUS[e.status] ?? STATUS.failed
  const meta = [humanize(e.type), humanize(e.source)].filter(Boolean).join(" · ")
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <View style={styles.rowTop}>
        <Text style={styles.time}>{timeLabel(e.at)}</Text>
        <Pressable onPress={onPerson} hitSlop={6} style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{e.userName || "athlete"}</Text>
        </Pressable>
        <View style={[styles.badge, { borderColor: st.color }]}>
          <Text style={[styles.badgeText, { color: st.color }]}>{st.label}</Text>
        </View>
      </View>
      {e.title ? <Text style={styles.title}>{e.title}</Text> : null}
      {e.body ? <Text style={styles.body} numberOfLines={3}>{e.body}</Text> : null}
      {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      {e.error ? <Text style={styles.error}>{e.error}</Text> : null}
    </View>
  )
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "transparent" },
  filters: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 12, flexWrap: "wrap" },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  chipActive: { backgroundColor: C.surfaceHigh, borderColor: C.green },
  chipText: { fontSize: 13, color: C.textSecondary, fontWeight: "600" },
  chipTextActive: { color: C.green },
  scroll: { paddingHorizontal: 16, paddingBottom: 40, gap: 20 },
  empty: { color: C.textSecondary, fontSize: 14, textAlign: "center", marginTop: 32, paddingHorizontal: 24 },
  section: { gap: 8 },
  sectionLabel: {
    fontSize: 12, fontWeight: "600", color: C.textMuted,
    textTransform: "uppercase", letterSpacing: 0.8, paddingHorizontal: 4,
  },
  card: { backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.border, overflow: "hidden" },
  row: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border, gap: 3 },
  rowLast: { borderBottomWidth: 0 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  time: { fontSize: 13, color: C.textSecondary, fontVariant: ["tabular-nums"], width: 42 },
  name: { fontSize: 15, color: C.textPrimary, fontWeight: "600" },
  badge: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 12, fontWeight: "700" },
  title: { fontSize: 14, color: C.textPrimary, fontWeight: "500", marginLeft: 52 },
  body: { fontSize: 13, color: C.textSecondary, marginLeft: 52 },
  meta: { fontSize: 12, color: C.textMuted, marginLeft: 52 },
  error: { fontSize: 12, color: C.red, marginLeft: 52 },
})
