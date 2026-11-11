import { paperSheet, useSheet } from "@/theme/paper/legacy"
import type { CardioAnswers, Effort, Pace, Pain, PainZone, Rest, StopReason } from "@/utils/cardio"
import { useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"

// The 4 end-of-session questions (rest, pain, rhythm, effort) plus the two
// follow-ups: why they stopped, and where it hurt. They replace heart rate:
// the plan moves up, repeats or goes down from them (utils/cardio.ts).

type Opt<T> = { value: T; label: string }

const REST: Opt<Rest>[] = [
  { value: "plenty", label: "More than enough" },
  { value: "enough", label: "Just right" },
  { value: "short", label: "A bit short" },
  { value: "notRecovering", label: "I couldn't recover" },
]
const PAIN: Opt<Pain>[] = [
  { value: "none", label: "None" },
  { value: "mild", label: "Mild discomfort" },
  { value: "pain", label: "Pain" },
]
const ZONE: Opt<PainZone>[] = [
  { value: "calf", label: "Calf" },
  { value: "achilles", label: "Achilles" },
  { value: "shin", label: "Shin" },
  { value: "foot", label: "Foot" },
]
const PACE: Opt<Pace>[] = [
  { value: "all", label: "Every series, no stops" },
  { value: "stopped1to2", label: "Stopped 1–2 times" },
  { value: "stoppedMany", label: "Stopped many times" },
]
const WHY: Opt<StopReason>[] = [
  { value: "coordination", label: "The rope caught" },
  { value: "tired", label: "I was tired" },
]
const EFFORT: Opt<Effort>[] = [
  { value: "easy", label: "Easy" },
  { value: "steady", label: "Steady" },
  { value: "mixed", label: "Hard and easy in turns" },
  { value: "allOut", label: "All out" },
]

function Question<T extends string>({ title, options, value, onPick }: {
  title: string; options: Opt<T>[]; value: T | undefined; onPick: (v: T) => void
}) {
  const s = useSheet(sheet)
  return (
    <View style={s.q}>
      <Text style={s.qTitle}>{title}</Text>
      <View style={s.opts}>
        {options.map((o) => (
          <Pressable key={o.value} onPress={() => onPick(o.value)} style={[s.opt, value === o.value && s.optOn]}>
            <Text style={[s.optText, value === o.value && s.optTextOn]}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

export function CardioQuestions({ onDone, saving }: { onDone: (a: CardioAnswers) => void; saving?: boolean }) {
  const s = useSheet(sheet)
  const [rest, setRest] = useState<Rest>()
  const [pain, setPain] = useState<Pain>()
  const [zone, setZone] = useState<PainZone>()
  const [pace, setPace] = useState<Pace>()
  const [why, setWhy] = useState<StopReason>()
  const [effort, setEffort] = useState<Effort>()

  const needZone = pain === "pain"
  const needWhy = pace != null && pace !== "all"
  const ready = rest && pain && pace && effort && (!needZone || zone) && (!needWhy || why)

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <Text style={s.title}>How did it go?</Text>
      <Question title="Rest between series" options={REST} value={rest} onPick={setRest} />
      <Question title="Any pain?" options={PAIN} value={pain} onPick={setPain} />
      {needZone && <Question title="Where?" options={ZONE} value={zone} onPick={setZone} />}
      <Question title="Did you keep the rhythm?" options={PACE} value={pace} onPick={setPace} />
      {needWhy && <Question title="Why did you stop?" options={WHY} value={why} onPick={setWhy} />}
      <Question title="How hard did it feel?" options={EFFORT} value={effort} onPick={setEffort} />
      <Pressable
        disabled={!ready || saving}
        onPress={() => ready && onDone({
          rest: rest!, pain: pain!, pace: pace!, effort: effort!,
          stopReason: needWhy ? why ?? null : null, painZone: needZone ? zone ?? null : null,
        })}
        style={[s.btn, (!ready || saving) && { opacity: 0.4 }]}
      >
        <Text style={s.btnText}>{saving ? "Saving…" : "Done"}</Text>
      </Pressable>
    </ScrollView>
  )
}

export const sheet = paperSheet((C) => StyleSheet.create({
  scroll: { padding: 20, gap: 12, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: "800", color: C.textPrimary, letterSpacing: -0.4, marginBottom: 6 },
  q: { gap: 12, backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16 },
  qTitle: { fontSize: 17, fontWeight: "700", color: C.textPrimary },
  opts: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  opt: { backgroundColor: C.surfaceHigh, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, borderWidth: 1, borderColor: "transparent" },
  optOn: { borderColor: C.green, backgroundColor: "rgba(111,207,151,0.12)" },
  optText: { fontSize: 15, fontWeight: "600", color: C.textPrimary },
  optTextOn: { color: C.green },
  btn: { marginTop: 8, backgroundColor: C.green, borderRadius: 24, paddingVertical: 14, alignItems: "center" },
  btnText: { fontSize: 16, fontWeight: "800", color: "#10251A" },
}))
