import { ScreenGradient } from "@/components/ScreenGradient"
import { SubScreenHeader } from "@/components/SubScreenHeader"
import { SessionDraft, WeekSessionSheet } from "@/components/WeekSessionSheet"
import { C } from "@/utils/theme"
import {
  DEFAULT_HOURS, EXAMPLE_WEEK, GRID_END, GRID_START, WEEK_DAYS, WeekSession, clampHours,
  formatHours, formatTime, startFromOffset, weekSummary,
} from "@/utils/weekSchedule"
import { Ionicons } from "@expo/vector-icons"
import { useEffect, useRef, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context"

const HOUR = 48
const HOURS = Array.from({ length: GRID_END - GRID_START }, (_, i) => GRID_START + i)

// Settings › My week: the athlete's default week, Google-Calendar style.
// UI only for now: starts from example data and "Save" doesn't reach the backend.
export default function ScheduleScreen() {
  const insets = useSafeAreaInsets()
  const [sessions, setSessions] = useState<WeekSession[]>(EXAMPLE_WEEK)
  const [saved, setSaved] = useState<WeekSession[]>(EXAMPLE_WEEK)
  const [draft, setDraft] = useState<SessionDraft | null>(null)
  // The new session as it's being set up in the sheet, drawn on the grid.
  const [preview, setPreview] = useState<SessionDraft | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const nextId = useRef(1)

  useEffect(() => {
    if (!justSaved) return
    const t = setTimeout(() => setJustSaved(false), 1800)
    return () => clearTimeout(t)
  }, [justSaved])

  const dirty = JSON.stringify(sessions) !== JSON.stringify(saved)
  const { days, hours } = weekSummary(sessions)

  const saveDraft = (d: SessionDraft) => {
    if (d.id) {
      setSessions((all) => all.map((x) => (x.id === d.id ? { ...x, day: d.days[0], start: d.start, hours: d.hours } : x)))
    } else {
      const added = d.days.map((day) => ({ id: `new${nextId.current++}`, day, start: d.start, hours: d.hours }))
      setSessions((all) => [...all, ...added])
    }
    setDraft(null)
  }

  return (
    <ScreenGradient>
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <SubScreenHeader
          title="My week"
          subtitle="Default training days"
          right={
            <Pressable
              style={s.addBtn}
              hitSlop={6}
              onPress={() => setDraft({ id: null, days: [], start: 8, hours: DEFAULT_HOURS })}
            >
              <Ionicons name="add" size={22} color="#10251A" />
            </Pressable>
          }
        />

        <View style={s.dayRow}>
          <View style={s.gutter} />
          {WEEK_DAYS.map((name, i) => {
            const on = sessions.some((x) => x.day === i)
            return (
              <View key={name} style={s.dayHead}>
                <Text style={[s.dayName, on && { color: C.textPrimary }]}>{name}</Text>
                <View style={[s.dayDot, on && { backgroundColor: C.green }]} />
              </View>
            )
          })}
        </View>

        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={[s.grid, { height: HOURS.length * HOUR }]}>
            <View style={s.gutter}>
              {HOURS.slice(1).map((h) => (
                <Text key={h} style={[s.hourLabel, { top: (h - GRID_START) * HOUR - 6 }]}>{h}:00</Text>
              ))}
            </View>
            {WEEK_DAYS.map((name, day) => (
              <Pressable
                key={name}
                style={s.col}
                onPress={(e) =>
                  setDraft({ id: null, days: [day], start: startFromOffset(e.nativeEvent.locationY, HOUR), hours: DEFAULT_HOURS })
                }
              >
                {HOURS.map((h) => (
                  <View key={h} pointerEvents="none" style={[s.hourLine, { top: (h - GRID_START) * HOUR }]} />
                ))}
                {sessions.filter((x) => x.day === day).map((x) => (
                  <Pressable
                    key={x.id}
                    onPress={() => setDraft({ id: x.id, days: [x.day], start: x.start, hours: x.hours })}
                    style={[
                      s.block,
                      {
                        top: (x.start - GRID_START) * HOUR,
                        height: x.hours * HOUR - 2,
                      },
                    ]}
                  >
                    <Text style={s.blockTitle} numberOfLines={1}>Training</Text>
                    <Text style={s.blockTime} numberOfLines={1}>{formatTime(x.start)}</Text>
                    <Text style={s.blockTime} numberOfLines={1}>{formatHours(x.hours)}</Text>
                  </Pressable>
                ))}
                {preview && !preview.id && preview.days.includes(day) && (
                  <View
                    pointerEvents="none"
                    style={[s.block, s.preview, { top: (preview.start - GRID_START) * HOUR, height: clampHours(preview.start, preview.hours) * HOUR - 2 }]}
                  >
                    <Text style={s.previewTime} numberOfLines={1}>{formatTime(preview.start)}</Text>
                    <Text style={s.blockTime} numberOfLines={1}>{formatTime(preview.start + clampHours(preview.start, preview.hours))}</Text>
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <View style={[s.footer, { paddingBottom: 14 + insets.bottom }]}>
          <View style={s.summary}>
            <Text style={s.summaryText}><Text style={s.summaryStrong}>{days}</Text> days a week</Text>
            <Text style={s.summaryText}><Text style={s.summaryStrong}>{formatHours(hours)}</Text> total</Text>
          </View>
          <Pressable
            disabled={!dirty}
            style={({ pressed }) => [s.saveBtn, !dirty && s.saveOff, pressed && { opacity: 0.85 }]}
            onPress={() => {
              setSaved(sessions)
              setJustSaved(true)
            }}
          >
            <Text style={[s.saveText, !dirty && { color: C.textMuted }]}>
              {justSaved ? "Saved as your default week" : "Save as default"}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>

      <WeekSessionSheet
        draft={draft}
        onSave={saveDraft}
        onDelete={(id) => {
          setSessions((all) => all.filter((x) => x.id !== id))
          setDraft(null)
        }}
        onClose={() => setDraft(null)}
        onChange={setPreview}
      />
    </ScreenGradient>
  )
}

const s = StyleSheet.create({
  addBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: C.green,
    alignItems: "center", justifyContent: "center",
  },
  dayRow: {
    flexDirection: "row", paddingRight: 8,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  gutter: { width: 40 },
  dayHead: { flex: 1, alignItems: "center", gap: 4, paddingTop: 4, paddingBottom: 8 },
  dayName: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", color: C.textSecondary },
  dayDot: { width: 6, height: 6, borderRadius: 3 },
  grid: { flexDirection: "row", paddingRight: 8 },
  hourLabel: {
    position: "absolute", right: 6, fontSize: 10, color: C.textMuted, fontVariant: ["tabular-nums"],
  },
  col: { flex: 1, borderLeftWidth: 1, borderLeftColor: "rgba(255,255,255,0.05)" },
  hourLine: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: "rgba(255,255,255,0.05)" },
  block: {
    position: "absolute", left: 2, right: 2, borderRadius: 8, borderLeftWidth: 3,
    borderLeftColor: C.green, backgroundColor: C.green + "2B",
    paddingHorizontal: 4, paddingVertical: 4, overflow: "hidden",
  },
  preview: { borderWidth: 1.5, borderStyle: "dashed", borderColor: C.green, backgroundColor: C.green + "1A" },
  previewTime: { fontSize: 11, fontWeight: "800", color: C.green, fontVariant: ["tabular-nums"] },
  blockTitle: { fontSize: 11, fontWeight: "800", color: C.textPrimary },
  blockTime: { fontSize: 10, color: C.textSecondary, fontVariant: ["tabular-nums"] },
  footer: {
    borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg,
    paddingHorizontal: 20, paddingTop: 12, gap: 10,
  },
  summary: { flexDirection: "row", justifyContent: "space-between" },
  summaryText: { fontSize: 13, fontWeight: "600", color: C.textSecondary },
  summaryStrong: { color: C.textPrimary },
  saveBtn: { borderRadius: 14, paddingVertical: 15, alignItems: "center", backgroundColor: C.green },
  saveOff: { backgroundColor: C.surfaceHigh },
  saveText: { fontSize: 16, fontWeight: "800", color: "#10251A" },
})
