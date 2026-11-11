import CustomButton from "@/components/customButton"
import { PaperBackground, usePaper } from "@/components/paper"
import { PaperScope, paperSheet, useC, useSheet } from "@/theme/paper/legacy"
import { StatusBar } from "expo-status-bar"
import { hasWorkoutToday, saveCardioPlan, saveCardioSession } from "@/services/cardio"
import {
  CAPACITY_TEST, coordinationPassed, protocolFor, protocolLabel, recordSession, recordTest, STOP_COUNTS, todaySession,
  type CardioAnswers, type CardioPlan, type CardioProtocol, type Outcome, type StopCount, type TodaySession,
} from "@/utils/cardio"
import { localDateStr } from "@/utils/planRotation"
import { Ionicons } from "@expo/vector-icons"
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake"
import { useEffect, useRef, useState } from "react"
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context"
import { CardioQuestions } from "./CardioQuestions"
import { CardioTimer } from "./CardioTimer"
import { NoteRow, ProtocolCard, StepList, type CardioNote } from "./CardioVisuals"

// One jump rope session, full screen: the starting test (dry jumps, 3
// attempts counting stops, then 5 × 30/30) or a regular session (the plan's
// protocol), then the 4 questions, then what comes next. Saves the plan
// (users.cardioPlan) and a cardio_sessions row.

type Step =
  | { k: "intro" }
  | { k: "dry"; auto?: boolean }
  | { k: "attempt"; i: number }
  | { k: "stops"; i: number }
  | { k: "capacity" }
  | { k: "intervals"; auto?: boolean }
  | { k: "questions" }
  | { k: "result"; title: string; next: CardioProtocol; notes: CardioNote[] }

const KEEP_AWAKE_TAG = "cardio-session"

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

type ModalProps = {
  visible: boolean
  userId: string
  plan: CardioPlan
  onClose: () => void
  onSaved: (plan: CardioPlan) => void
}

// The session is part of the athlete workout flow: Paper Mint (theme/paper/legacy.tsx).
export function CardioSessionModal(props: ModalProps) {
  return (
    <PaperScope>
      <SessionModal {...props} />
    </PaperScope>
  )
}

function SessionModal({ visible, userId, plan, onClose, onSaved }: ModalProps) {
  const C = useC()
  const paper = usePaper()
  const st = useSheet(stSheet)
  const [step, setStep] = useState<Step>({ k: "intro" })
  const [climbedHard, setClimbedHard] = useState<boolean | null>(null)
  const [stops, setStops] = useState<StopCount[]>([])
  const [saving, setSaving] = useState(false)
  // A ref too: a quick double tap on the last stop count (or Done) fires
  // before `saving` re-renders, and would save the session twice.
  const savingRef = useRef(false)
  const savedRef = useRef(false)
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
    savedRef.current = false
    let cancelled = false
    hasWorkoutToday(userId).then((hard) => {
      if (cancelled) return
      setClimbedHard(hard)
      setSession(todaySession(planRef.current, localDateStr(new Date()), hard))
    })
    return () => { cancelled = true }
  }, [visible, userId])

  // 10–20 minutes of rope with the phone on the floor: without this the
  // screen locks mid-session and the timer and its beeps stop.
  useEffect(() => {
    if (!visible) return
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {})
    return () => { deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {}) }
  }, [visible])

  const isTest = session?.kind === "test"

  function close() {
    if (step.k === "intro" || step.k === "result") { onClose(); return }
    Alert.alert("Stop this session?", "Nothing is saved.", [
      { text: "Keep going", style: "cancel" },
      { text: "Stop", style: "destructive", onPress: onClose },
    ])
  }

  async function persist(next: CardioPlan, row: Parameters<typeof saveCardioSession>[0]) {
    if (savingRef.current || savedRef.current) return false
    savingRef.current = true
    setSaving(true)
    try {
      await saveCardioPlan(userId, next)
      await saveCardioSession(row).catch((e) => console.log("cardio session row failed", e))
      savedRef.current = true
      onSaved(next)
      return true
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof Error ? e.message : "Try again.")
      return false
    } finally {
      savingRef.current = false
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
    setStep({
      k: "result",
      title: "Your plan is ready",
      next: protocolFor(start, 1),
      notes: start === 0
        ? [{ icon: "school-outline", text: "First we learn the move: rope-less jumps, then short rounds with the rope." }]
        : [],
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
    const notes: CardioNote[] = []
    if (upcoming.kind === "deload" || result.needsDeload) notes.push({ icon: "leaf-outline", text: "Next week is a light week: fewer series, same move." })
    if (result.next.slowDown) notes.push({ icon: "speedometer-outline", text: "Go a bit slower next time — a pace you could keep for all the series.", tone: "warn" })
    if (result.next.painCap) notes.push({ icon: "calendar-outline", text: "At most 2 sessions a week until it stops hurting.", tone: "warn" })
    if (a.pain === "pain") notes.push({ icon: "medkit-outline", text: "If it keeps hurting, tell your coach.", tone: "warn" })
    setStep({ k: "result", title: outcomeTitle(result.outcome), next: protocolFor(result.next.step, result.next.cycle), notes })
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
      case "intro": return <Intro session={session} climbedHard={!!climbedHard} onStart={() => setStep(isTest || session.protocol.dryJumps ? { k: "dry", auto: true } : { k: "intervals", auto: true })} />
      case "dry": return (
        <Timed key="dry" autoStart={step.auto} icon="footsteps-outline" title="Rope-less jumps" text="30 seconds. Jump and turn your wrists as if you had the rope.">
          <CardioTimer series={1} workSec={30} restSec={0} label="Jump, no rope" onDone={() => setStep(isTest ? { k: "attempt", i: 0 } : { k: "intervals" })} />
        </Timed>
      )
      case "attempt": return (
        <Timed key={`attempt-${step.i}`} icon="repeat-outline" title={`Attempt ${step.i + 1} of 3`} text="30 seconds with the rope. Count every time it stops — you'll enter the number at the end.">
          <CardioTimer series={1} workSec={30} restSec={0} label="Jump rope" onDone={() => setStep({ k: "stops", i: step.i })} />
        </Timed>
      )
      case "stops": return (
        <View style={st.center}>
          <Text style={st.kicker}>Attempt {step.i + 1} of 3</Text>
          <Text style={st.h1}>How many times did the rope stop?</Text>
          {STOP_COUNTS.map((c) => (
            <Pressable key={c} disabled={saving} onPress={() => afterAttempt(step.i, c)} style={[st.choice, saving && { opacity: 0.5 }]}>
              <Text style={st.choiceText}>{STOP_LABEL[c]}</Text>
            </Pressable>
          ))}
        </View>
      )
      case "capacity": return (
        <Timed key="capacity" icon="pulse" title="5 × 30 s on / 30 s off" text="Jump 30 s, rest 30 s, 5 times. Pick a pace you think you could keep for 10 series.">
          <CardioTimer series={5} workSec={30} restSec={30} label="Jump rope" onDone={() => setStep({ k: "questions" })} />
        </Timed>
      )
      case "intervals": return (
        <Timed key="intervals" autoStart={step.auto} icon="pulse" title={protocolLabel(session.protocol)} text={intervalsText(session)}>
          <CardioTimer
            series={session.protocol.series} workSec={session.protocol.workSec} restSec={session.protocol.restSec}
            doublesEverySec={session.protocol.doublesEverySec} label="Jump rope" onDone={() => setStep({ k: "questions" })}
          />
        </Timed>
      )
      case "questions": return <CardioQuestions saving={saving} onDone={(a) => (isTest ? finishTest(a, stops) : finishSession(a))} />
      case "result": return (
        <Page footer={<CustomButton title="Done" onPress={onClose} />}>
          <View style={st.hero}>
            <View style={st.ring}><Ionicons name="checkmark" size={44} color={C.green} /></View>
            <Text style={st.kicker}>Session saved</Text>
            <Text style={st.h1}>{step.title}</Text>
          </View>
          <ProtocolCard p={step.next} kicker="Next session" />
          {step.notes.map((n) => <NoteRow key={n.text} note={n} />)}
        </Page>
      )
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
      {/* A Modal renders outside the app's SafeAreaProvider: without its own,
          insets read as zero and the header sits under the iOS status bar. */}
      <SafeAreaProvider>
      <PaperBackground>
      {visible && <StatusBar style={paper.mode === "dark" ? "light" : "dark"} />}
      <SafeAreaView style={st.screen}>
        <View style={st.top}>
          <Text style={st.topTitle}>{isTest ? "Starting test" : "Jump rope cardio"}</Text>
          <Pressable onPress={close} hitSlop={10} accessibilityLabel="Close">
            <Ionicons name="close" size={26} color={C.textSecondary} />
          </Pressable>
        </View>
        {body()}
      </SafeAreaView>
      </PaperBackground>
      </SafeAreaProvider>
    </Modal>
  )
}

// The session's only screen before the first timer: what today holds and
// the first piece's instructions; Start runs that piece's timer directly.
function Intro({ session, climbedHard, onStart }: { session: TodaySession; climbedHard: boolean; onStart: () => void }) {
  const st = useSheet(stSheet)
  const footer = <CustomButton title="Start" onPress={onStart} />
  if (session.kind === "test") {
    return (
      <Page footer={footer}>
        <View style={st.heading}>
          <Text style={st.kicker}>Session 1 · about 10 min</Text>
          <Text style={st.h1Left}>{"Let's find your starting point"}</Text>
        </View>
        <StepList steps={[
          { title: "Jumps without the rope", text: "30 s. Jump and turn your wrists as if you had it." },
          { title: "Three attempts with the rope", text: "30 s each. Count every time the rope stops." },
          { title: "5 × 30 s on / 30 s off", text: "Only if the rope flows. Then 4 quick questions." },
        ]} />
      </Page>
    )
  }
  const notes: CardioNote[] = []
  if (session.kind === "deload") notes.push({ icon: "leaf-outline", text: "Light week: fewer series than usual." })
  if (climbedHard) notes.push({ icon: "barbell-outline", text: "You trained today, so this one is a bit lighter." })
  if (session.slowDown) notes.push({ icon: "speedometer-outline", text: "Go a bit slower than last time.", tone: "warn" })
  if (session.protocol.dryJumps) notes.push({ icon: "footsteps-outline", text: "First, 30 s of jumps without the rope: jump and turn your wrists as if you had it." })
  return (
    <Page footer={footer}>
      <View style={st.heading}>
        <Text style={st.kicker}>{session.kind === "deload" ? "Light week" : "Today"}</Text>
        <Text style={st.h1Left}>Jump rope intervals</Text>
      </View>
      <ProtocolCard p={session.protocol} />
      {notes.map((n) => <NoteRow key={n.text} note={n} />)}
    </Page>
  )
}

// A scrolling page with its button pinned at the bottom, like the workout
// blocks' screens.
function Page({ children, footer }: { children: React.ReactNode; footer: React.ReactNode }) {
  const st = useSheet(stSheet)
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={st.page}>{children}</ScrollView>
      <View style={st.footer}>{footer}</View>
    </View>
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
// `autoStart`: the session intro already showed these instructions.
function Timed({ title, text, icon, autoStart, children }: {
  title: string; text: string | null; icon: React.ComponentProps<typeof Ionicons>["name"]
  autoStart?: boolean; children: React.ReactNode
}) {
  const C = useC()
  const st = useSheet(stSheet)
  const [started, setStarted] = useState(!!autoStart)
  if (!started) {
    return (
      <Page footer={<CustomButton title="Start" onPress={() => setStarted(true)} />}>
        <View style={[st.hero, { flexGrow: 1, justifyContent: "center" }]}>
          <View style={st.ring}><Ionicons name={icon} size={44} color={C.green} /></View>
          <Text style={st.h1}>{title}</Text>
          {text ? <Text style={st.lead}>{text}</Text> : null}
        </View>
      </Page>
    )
  }
  return (
    <ScrollView contentContainerStyle={st.timed}>
      <Text style={st.kicker}>{title}</Text>
      {children}
    </ScrollView>
  )
}

const stSheet = paperSheet((C) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  topTitle: { fontSize: 13, fontWeight: "800", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 1 },
  page: { flexGrow: 1, padding: 20, gap: 12 },
  footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 },
  heading: { gap: 6, marginBottom: 6, marginTop: 4 },
  hero: { alignItems: "center", gap: 10, paddingVertical: 12 },
  h1Left: { fontSize: 28, fontWeight: "800", color: C.textPrimary, letterSpacing: -0.4 },
  center: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 14 },
  timed: { alignItems: "center", padding: 24, gap: 8 },
  ring: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: "rgba(111,207,151,0.12)",
    borderWidth: 1, borderColor: "rgba(111,207,151,0.35)", alignItems: "center", justifyContent: "center",
  },
  h1: { fontSize: 24, fontWeight: "800", color: C.textPrimary, textAlign: "center", letterSpacing: -0.3 },
  kicker: { fontSize: 12, fontWeight: "700", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.8 },
  lead: { fontSize: 18, lineHeight: 26, color: C.textPrimary, textAlign: "center", fontWeight: "600" },
  choice: { width: "100%", maxWidth: 340, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  choiceText: { fontSize: 16, fontWeight: "700", color: C.textPrimary },
}))
