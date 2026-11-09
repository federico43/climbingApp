import { C } from "@/utils/theme"
import { validDays, WEEKDAY_SHORT, type Weekday } from "@/utils/cardio"
import { Ionicons } from "@expo/vector-icons"
import { useEffect, useState } from "react"
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"

// The jump rope cardio intro: why, how it works, how often, the athlete's
// days and reminder time, then the commitment. Same look as the app's
// feature pop-ups (components/schedule/FeatureIntro). With `daysOnly` it
// opens straight on the days page, to change days or time later.

const TIMES = ["06:00", "07:00", "08:00", "12:00", "17:00", "18:00", "19:00", "20:00"]

const INFO: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string }[] = [
  {
    icon: "heart-outline",
    title: "Now you can train cardio",
    text: "Jump rope builds the aerobic base that helps you recover between attempts and last through long sessions.",
  },
  {
    icon: "options-outline",
    title: "A plan that adjusts itself",
    text: "Short rounds of rope. After each session you answer 4 quick questions and the app decides: move up, repeat or go lighter.",
  },
  {
    icon: "calendar-outline",
    title: "2 or 3 times a week",
    text: "About 15 minutes, never two days in a row. Every few weeks a lighter week protects your calves and shins.",
  },
]

export function CardioIntro({ visible, daysOnly, hasTest = true, initialDays, initialTime, onClose, onCommit }: {
  visible: boolean
  daysOnly?: boolean
  /** The first session is the starting test (the coach didn't set a step). */
  hasTest?: boolean
  initialDays?: Weekday[]
  initialTime?: string
  onClose: () => void
  onCommit: (days: Weekday[], time: string) => Promise<void> | void
}) {
  const daysPage = INFO.length
  const [i, setI] = useState(0)
  const [days, setDays] = useState<Weekday[]>([])
  const [time, setTime] = useState("18:00")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!visible) return
    setI(daysOnly ? daysPage : 0)
    setDays(initialDays ?? [])
    setTime(initialTime ?? "18:00")
  }, [visible, daysOnly, initialDays, initialTime, daysPage])

  const ok = validDays(days)
  const toggle = (d: Weekday) => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d])

  async function commit() {
    setSaving(true)
    try { await onCommit(days, time) } finally { setSaving(false) }
  }

  const total = INFO.length + 2
  let content: React.ReactNode
  let button: { label: string; onPress: () => void; disabled?: boolean }
  if (i < INFO.length) {
    const p = INFO[i]
    content = (
      <>
        <Art icon={p.icon} onClose={onClose} />
        <View style={s.body}>
          <Text style={s.title}>{p.title}</Text>
          <Text style={s.text}>{p.text}</Text>
        </View>
      </>
    )
    button = { label: "Next", onPress: () => setI(i + 1) }
  } else if (i === daysPage) {
    content = (
      <>
        <Art icon="alarm-outline" onClose={onClose} />
        <View style={s.body}>
          <Text style={s.title}>Your days</Text>
          <Text style={s.text}>Pick 2 or 3 days, not back to back. We&apos;ll remind you that day.</Text>
          <View style={s.days}>
            {WEEKDAY_SHORT.map((label, d) => (
              <Pressable key={label} onPress={() => toggle(d as Weekday)} style={[s.day, days.includes(d as Weekday) && s.on]}>
                <Text style={[s.dayText, days.includes(d as Weekday) && s.onText]}>{label[0]}</Text>
              </Pressable>
            ))}
          </View>
          {days.length > 0 && !ok && <Text style={s.warn}>2 or 3 days, with a rest day between them.</Text>}
          <Text style={s.label}>Reminder</Text>
          <View style={s.times}>
            {TIMES.map((t) => (
              <Pressable key={t} onPress={() => setTime(t)} style={[s.time, time === t && s.on]}>
                <Text style={[s.timeText, time === t && s.onText]}>{t}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </>
    )
    button = daysOnly
      ? { label: saving ? "Saving…" : "Save", onPress: commit, disabled: !ok || saving }
      : { label: "Next", onPress: () => setI(i + 1), disabled: !ok }
  } else {
    content = (
      <>
        <Art icon="flag-outline" onClose={onClose} />
        <View style={s.body}>
          <Text style={s.title}>Your commitment</Text>
          <Text style={s.text}>
            {days.length} sessions a week ({[...days].sort((a, b) => a - b).map((d) => WEEKDAY_SHORT[d]).join(", ")}) for the next 6 weeks.
            {hasTest ? " Your first session is a short test that finds your starting point." : " Your coach already set your starting point."}
          </Text>
        </View>
      </>
    )
    button = { label: saving ? "Saving…" : "I'm in", onPress: commit, disabled: saving }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.scrim}>
        <ScrollView contentContainerStyle={s.scrollIn} style={{ width: "100%" }}>
          <View style={s.card}>
            {content}
            <View style={s.footer}>
              {!daysOnly && (
                <View style={s.dots}>
                  {Array.from({ length: total }, (_, n) => <View key={n} style={[s.dot, n === i && s.dotOn]} />)}
                </View>
              )}
              <Pressable
                disabled={button.disabled}
                style={({ pressed }) => [s.btn, pressed && { opacity: 0.85 }, button.disabled && { opacity: 0.4 }]}
                onPress={button.onPress}
              >
                <Text style={s.btnText}>{button.label}</Text>
              </Pressable>
              {i > 0 && !daysOnly && (
                <Pressable onPress={() => setI(i - 1)} hitSlop={8}><Text style={s.back}>Back</Text></Pressable>
              )}
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  )
}

function Art({ icon, onClose }: { icon: keyof typeof Ionicons.glyphMap; onClose: () => void }) {
  return (
    <View style={s.art}>
      <View style={s.ring}><Ionicons name={icon} size={56} color={C.green} /></View>
      <Pressable style={s.close} hitSlop={10} onPress={onClose} accessibilityLabel="Close">
        <Ionicons name="close" size={20} color={C.textSecondary} />
      </Pressable>
    </View>
  )
}

const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)" },
  scrollIn: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  card: { width: "100%", maxWidth: 380, backgroundColor: C.surface, borderRadius: 20, overflow: "hidden" },
  art: { height: 170, backgroundColor: "#1B2A22", alignItems: "center", justifyContent: "center" },
  ring: {
    width: 112, height: 112, borderRadius: 56, backgroundColor: "rgba(111,207,151,0.12)",
    borderWidth: 1, borderColor: "rgba(111,207,151,0.35)", alignItems: "center", justifyContent: "center",
  },
  close: { position: "absolute", top: 14, right: 14 },
  body: { paddingHorizontal: 24, paddingTop: 22, alignItems: "center", gap: 12 },
  title: { fontSize: 22, fontWeight: "800", color: C.textPrimary, textAlign: "center", letterSpacing: -0.3 },
  text: { fontSize: 15, lineHeight: 21, color: C.textSecondary, textAlign: "center" },
  label: { fontSize: 12, fontWeight: "700", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.8, marginTop: 4 },
  days: { flexDirection: "row", gap: 6 },
  day: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.surfaceHigh, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "transparent" },
  dayText: { fontSize: 14, fontWeight: "700", color: C.textPrimary },
  times: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6 },
  time: { backgroundColor: C.surfaceHigh, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: "transparent" },
  timeText: { fontSize: 13, fontWeight: "700", color: C.textPrimary },
  on: { borderColor: C.green, backgroundColor: "rgba(111,207,151,0.12)" },
  onText: { color: C.green },
  warn: { fontSize: 13, color: C.yellow, textAlign: "center" },
  footer: { alignItems: "center", gap: 12, paddingTop: 16, paddingBottom: 22 },
  dots: { flexDirection: "row", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.surfaceHigh },
  dotOn: { backgroundColor: C.green, width: 18 },
  btn: { backgroundColor: C.green, borderRadius: 24, paddingVertical: 13, paddingHorizontal: 40 },
  btnText: { fontSize: 15, fontWeight: "800", color: "#10251A", letterSpacing: 0.3 },
  back: { fontSize: 14, fontWeight: "600", color: C.textSecondary },
})
