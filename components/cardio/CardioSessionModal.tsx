import { C } from "@/utils/theme"
import { hasWorkoutToday, saveCardioPlan, saveCardioSession } from "@/services/cardio"
import {
  CAPACITY_TEST, coordinationPassed, protocolFor, protocolLabel, recordSession, recordTest, STOP_COUNTS, todaySession,
  type CardioAnswers, type CardioPlan, type Outcome, type StopCount, type TodaySession,
} from "@/utils/cardio"
import { localDateStr } from "@/utils/planRotation"
import { Ionicons } from "@expo/vector-icons"
import { useEffect, useRef, useState } from "react"
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context"
import { CardioQuestions } from "./CardioQuestions"
import { CardioTimer } from "./CardioTimer"

// One jump rope session, full screen: the starting test (dry jumps, 3
// attempts counting stops, then 5 × 30/30) or a regular session (the plan's
// protocol), then the 4 questions, then what comes next. Saves the plan
// (users.cardioPlan) and a cardio_sessions row.

type Step =
  | { k: "intro" }
  | { k: "dry" }
  | { k: "attempt"; i: number }
  | { k: "stops"; i: number }
  | { k: "capacity" }
  | { k: "intervals" }
  | { k: "questions" }
  | { k: "result"; title: string; lines: string[] }

const STOP_LABEL: Record<StopCount, string> = { "0": "None", "1-3": "1 to 3", "4-5": "4 or 5", "6+": "More than 5" }

function outcomeTitle(o: Outcome): string {
  switch (o) {
    case "up": return "Step up!"
    case "skip": return "Two steps up!"
    case "cycleUp": return "New cycle!"
    case "down": return "A lighter session next"
    case "deloadHold": return "Moving up after a light week"
    default: return "Same session next time"
  }
}

export function CardioSessionModal({ visible, userId, plan, onClose, onSaved }: {
  visible: boolean
  userId: string
  plan: CardioPlan
  onClose: () => void
  onSaved: (plan: CardioPlan) => void
}) {
  const [step, setStep] = useState<Step>({ k: "intro" })
  const [climbedHard, setClimbedHard] = useState<boolean | null>(null)
  const [stops, setStops] = useState<StopCount[]>([])
  const [saving, setSaving] = useState(false)
  const today = localDateStr(new Date())

  // Today's session is fixed when the screen opens: saving the plan mid-way
  // (after the test) must not turn it into another one.
  const [session, setSession] = useState<TodaySession | null>(null)
  const planRef = useRef(plan)
  planRef.current = plan

  useEffect(() => {
    if (!visible) return
    setStep({ k: "intro" })
    setStops([])
    setClimbedHard(null)
    setSession(null)
    let cancelled = false
    hasWorkoutToday(userId).then((hard) => {
      if (cancelled) return
      setClimbedHard(hard)
      setSession(todaySession(planRef.current, localDateStr(new Date()), hard))
    })
    return () => { cancelled = true }
  }, [visible, userId])

  const isTest = session?.kind === "test"

  function close() {
    if (step.k === "intro" || step.k === "result") { onClose(); return }
    Alert.alert("Stop this session?", "Nothing is saved.", [
      { text: "Keep going", style: "cancel" },
      { text: "Stop", style: "destructive", onPress: onClose },
    ])
  }

  async function persist(next: CardioPlan, row: Parameters<typeof saveCardioSession>[0]) {
    setSaving(true)
    try {
      await saveCardioPlan(userId, next)
      await saveCardioSession(row).catch((e) => console.log("cardio session row failed", e))
      onSaved(next)
      return true
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof Error ? e.message : "Try again.")
      return false
    } finally {
      setSaving(false)
    }
  }

  async function finishTest(capacity: CardioAnswers | null, attempts: StopCount[]) {
    const { plan: next, step: start } = recordTest(plan, today, attempts, capacity)
    const ok = await persist(next, {
      userId, date: today, kind: "test", step: start, cycle: 1,
      protocol: JSON.stringify(CAPACITY_TEST), answers: JSON.stringify({ attempts, capacity }),
      outcome: "start", rule: null, nextStep: start, nextCycle: 1, climbedHard: false,
    })
    if (!ok) return
    const p = protocolFor(start, 1)
    setStep({
      k: "result",
      title: `You start at step ${start}`,
      lines: [
        start === 0 ? "First we learn the move: rope-less jumps, then short rounds with the rope." : "Your plan is ready.",
        `Next session: ${protocolLabel(p)}`,
      ],
    })
  }

  async function finishSession(a: CardioAnswers) {
    if (!session) return
    const { plan: next, result } = recordSession(plan, today, a, !!climbedHard)
    const ok = await persist(next, {
      userId, date: today, kind: session.kind === "deload" ? "deload" : "session",
      step: session.step, cycle: session.cycle, protocol: JSON.stringify(session.protocol), answers: JSON.stringify(a),
      outcome: result.outcome, rule: result.rule, nextStep: result.next.step, nextCycle: result.next.cycle, climbedHard: !!climbedHard,
    })
    if (!ok) return
    const upcoming = todaySession(next, today, false)
    const lines = [`Next session: ${protocolLabel(protocolFor(result.next.step, result.next.cycle))}`]
    if (upcoming.kind === "deload" || result.needsDeload) lines.push("Next week is a light week: fewer series, same move.")
    if (result.next.slowDown) lines.push("Go a bit slower next time — a pace you could keep for all the series.")
    if (result.next.painCap) lines.push("At most 2 sessions a week until it stops hurting.")
    if (a.pain === "pain") lines.push("If it keeps hurting, tell your coach.")
    setStep({ k: "result", title: outcomeTitle(result.outcome), lines })
  }

  function afterAttempt(i: number, c: StopCount) {
    const all = [...stops.slice(0, i), c]
    setStops(all)
    if (i < 2) { setStep({ k: "attempt", i: i + 1 }); return }
    if (coordinationPassed(all)) setStep({ k: "capacity" })
    else finishTest(null, all)
  }

  function body() {
    if (!session) return <ActivityIndicator style={{ marginTop: 80 }} color={C.green} />
    switch (step.k) {
      case "intro": return <Intro session={session} climbedHard={!!climbedHard} onStart={() => setStep(isTest || session.protocol.dryJumps ? { k: "dry" } : { k: "intervals" })} />
      case "dry": return (
        <Timed key="dry" title="Rope-less jumps" text="30 seconds. Jump and turn your wrists as if you had the rope.">
          <CardioTimer series={1} workSec={30} restSec={0} label="Jump, no rope" onDone={() => setStep(isTest ? { k: "attempt", i: 0 } : { k: "intervals" })} />
        </Timed>
      )
      case "attempt": return (
        <Timed key={`attempt-${step.i}`} title={`Attempt ${step.i + 1} of 3`} text="30 seconds with the rope. Count every time it stops — you'll enter the number at the end.">
          <CardioTimer series={1} workSec={30} restSec={0} label="Jump rope" onDone={() => setStep({ k: "stops", i: step.i })} />
        </Timed>
      )
      case "stops": return (
        <View style={st.center}>
          <Text style={st.h1}>How many times did the rope stop?</Text>
          {STOP_COUNTS.map((c) => (
            <Pressable key={c} onPress={() => afterAttempt(step.i, c)} style={st.choice}>
              <Text style={st.choiceText}>{STOP_LABEL[c]}</Text>
            </Pressable>
          ))}
        </View>
      )
      case "capacity": return (
        <Timed key="capacity" title="5 × 30 s on / 30 s off" text="Jump 30 s, rest 30 s, 5 times. Pick a pace you think you could keep for 10 series.">
          <CardioTimer series={5} workSec={30} restSec={30} label="Jump rope" onDone={() => setStep({ k: "questions" })} />
        </Timed>
      )
      case "intervals": return (
        <Timed key="intervals" title={protocolLabel(session.protocol)} text={intervalsText(session)}>
          <CardioTimer
            series={session.protocol.series} workSec={session.protocol.workSec} restSec={session.protocol.restSec}
            doublesEverySec={session.protocol.doublesEverySec} label="Jump rope" onDone={() => setStep({ k: "questions" })}
          />
        </Timed>
      )
      case "questions": return <CardioQuestions saving={saving} onDone={(a) => (isTest ? finishTest(a, stops) : finishSession(a))} />
      case "result": return (
        <View style={st.center}>
          <View style={st.ring}><Ionicons name="checkmark" size={48} color={C.green} /></View>
          <Text style={st.h1}>{step.title}</Text>
          {step.lines.map((l) => <Text key={l} style={st.text}>{l}</Text>)}
          <Pressable onPress={onClose} style={st.btn}><Text style={st.btnText}>Done</Text></Pressable>
        </View>
      )
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
      {/* A Modal renders outside the app's SafeAreaProvider: without its own,
          insets read as zero and the header sits under the iOS status bar. */}
      <SafeAreaProvider>
      <SafeAreaView style={st.screen}>
        <View style={st.top}>
          <Text style={st.topTitle}>{isTest ? "Starting test" : "Jump rope cardio"}</Text>
          <Pressable onPress={close} hitSlop={10} accessibilityLabel="Close">
            <Ionicons name="close" size={26} color={C.textSecondary} />
          </Pressable>
        </View>
        {body()}
      </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  )
}

function Intro({ session, climbedHard, onStart }: { session: TodaySession; climbedHard: boolean; onStart: () => void }) {
  const lines: string[] = []
  if (session.kind === "test") {
    lines.push("1. 30 s of jumps without the rope.", "2. Three 30 s attempts with the rope, counting stops.", "3. If the rope flows, 5 × 30 s on / 30 s off and 4 quick questions.")
  } else {
    if (session.protocol.dryJumps) lines.push("Starts with 30 s of jumps without the rope.")
    if (session.kind === "deload") lines.push("Light week: fewer series than usual.")
    if (climbedHard) lines.push("You trained today, so this one is a bit lighter.")
    if (session.slowDown) lines.push("Go a bit slower this time.")
  }
  return (
    <ScrollView contentContainerStyle={st.center}>
      <View style={st.ring}><Ionicons name="pulse" size={48} color={C.green} /></View>
      <Text style={st.h1}>{session.kind === "test" ? "Let's find your starting point" : protocolLabel(session.protocol)}</Text>
      {session.kind !== "test" && <Text style={st.kicker}>Step {session.step} · Cycle {session.cycle}</Text>}
      {lines.map((l) => <Text key={l} style={st.text}>{l}</Text>)}
      <Pressable onPress={onStart} style={st.btn}><Text style={st.btnText}>Next</Text></Pressable>
    </ScrollView>
  )
}

function intervalsText(session: TodaySession): string {
  const p = session.protocol
  let t = `Jump ${p.workSec} s, rest ${p.restSec} s, ${p.series} times.`
  if (p.triplesOrHeavy) t += " Use triples or a heavy rope."
  else if (p.doublesEverySec) t += ` Do doubles or crosses every ${p.doublesEverySec} s.`
  if (session.slowDown) t += " Go a bit slower than last time."
  return t
}

// A timed piece: first its instructions and a Start button, so the clock
// doesn't run while the athlete is still reading; then the timer. Each step
// gets its own key so a new piece always starts a fresh timer.
function Timed({ title, text, children }: { title: string; text: string | null; children: React.ReactNode }) {
  const [started, setStarted] = useState(false)
  if (!started) {
    return (
      <ScrollView contentContainerStyle={st.center}>
        <Text style={st.h1}>{title}</Text>
        {text ? <Text style={st.lead}>{text}</Text> : null}
        <Pressable onPress={() => setStarted(true)} style={st.btn}><Text style={st.btnText}>Start</Text></Pressable>
      </ScrollView>
    )
  }
  return (
    <ScrollView contentContainerStyle={st.timed}>
      <Text style={st.h2}>{title}</Text>
      {children}
    </ScrollView>
  )
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  topTitle: { fontSize: 13, fontWeight: "800", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 1 },
  center: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 14 },
  timed: { alignItems: "center", padding: 24, gap: 8 },
  ring: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: "rgba(111,207,151,0.12)",
    borderWidth: 1, borderColor: "rgba(111,207,151,0.35)", alignItems: "center", justifyContent: "center",
  },
  h1: { fontSize: 24, fontWeight: "800", color: C.textPrimary, textAlign: "center", letterSpacing: -0.3 },
  h2: { fontSize: 20, fontWeight: "800", color: C.textPrimary, textAlign: "center" },
  kicker: { fontSize: 12, fontWeight: "700", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.8 },
  text: { fontSize: 16, lineHeight: 23, color: C.textPrimary, textAlign: "center" },
  lead: { fontSize: 18, lineHeight: 26, color: C.textPrimary, textAlign: "center", fontWeight: "600" },
  choice: { width: "100%", maxWidth: 320, backgroundColor: C.surfaceHigh, borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  choiceText: { fontSize: 16, fontWeight: "700", color: C.textPrimary },
  btn: { marginTop: 10, backgroundColor: C.green, borderRadius: 24, paddingVertical: 14, paddingHorizontal: 56 },
  btnText: { fontSize: 16, fontWeight: "800", color: "#10251A" },
})
