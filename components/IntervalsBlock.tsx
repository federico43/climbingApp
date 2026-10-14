import { C } from "@/utils/theme"
import CustomButton from "@/components/customButton"
import { shared_styles, TopBar } from "@/utils/BlockStyles"
import type { Attempt } from "@/hooks/WorkoutHook"
import { getSessions } from "@/services/BoulderGraphService"
import { findBlockRuns } from "@/utils/blockHistory"
import {
  intervalsDescription, intervalsLog, liveWorkAfterFall, suggestNextIntervals, type IntervalsLog, type IntervalsSuggestion,
} from "@/utils/progression/intervals"
import { INTERVALS_RULES } from "@/utils/progression/profiles"
import { Audio } from "expo-av"
import React, { useEffect, useRef, useState } from "react"
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native"
import { AnimatedCircularProgress } from "react-native-circular-progress"

interface Props {
  block: any  // { blockName, description, series, workTime, restTime, kind? }
  logAttempt: (attempt: Omit<Attempt, "blockIndex" | "type" | "timestamp">) => void
  attempts: Attempt[]
  goToNextBlock: () => void
  goToPreviousBlock?: () => void
}

type Phase = "ready" | "prepare" | "work" | "rest" | "done"

const PREPARE_SECS = 5

function fmt(sec: number): string {
  if (sec >= 60) {
    const m = Math.floor(sec / 60), s = sec % 60
    return `${m}:${String(s).padStart(2, "0")}`
  }
  return `${sec}s`
}

// Configurable work/rest interval timer (a broader version of the 7/3s).
//
// Progression (spec §3.4, utils/progression/intervals.ts), when the coach
// set the block's kind: the suggested work time (and rounds) are preloaded
// with a banner that stays until the athlete chooses their own work time.
// "I fell" records the round — during work (which ends the round and starts
// the rest at once), or during the rest/done screen right after it, for a
// fall near the end of a round. Warm-up: each fall
// cuts 10 s off the following rounds. With no fall, the end asks one
// question — warm-up: "very pumped in the last two rounds?", power
// endurance: "felt very easy?".
export function IntervalsBlock({ block, logAttempt, attempts, goToNextBlock, goToPreviousBlock }: Props) {
  const plannedSeries = Math.max(1, block.series ?? 6)
  const plannedWork = Math.max(1, block.workTime ?? 30)
  const restTime = Math.max(0, block.restTime ?? 60)
  const kind = block.kind as IntervalsLog["kind"]
  const blockTitle = block.blockName || "Intervals"
  const attemptsDone = attempts.length
  // Revisiting a finished block shows what was logged, without re-logging.
  const logged = intervalsLog(attempts[attempts.length - 1])

  const [series, setSeries] = useState(logged?.series ?? plannedSeries)
  // Work time for the coming rounds. Mirrored in a ref because the round
  // timers chain from callbacks, and a warm-up fall changes it mid-block.
  const [workTime, setWorkTimeState] = useState(logged?.workTime ?? plannedWork)
  const workRef = useRef(workTime)
  function setWorkTime(v: number) { workRef.current = v; setWorkTimeState(v) }
  // Length of the work round now running (a cut applies from the next one).
  const [roundWork, setRoundWork] = useState(workTime)
  const [startWork, setStartWork] = useState(logged?.startWorkTime ?? workTime)
  const [suggestion, setSuggestion] = useState<IntervalsSuggestion | null>(null)
  const [suggestionReady, setSuggestionReady] = useState(attemptsDone > 0 || !kind)
  // True once the athlete chose to set their own work time.
  const [pickOwn, setPickOwn] = useState(false)
  // Rounds with a fall, in order. Power endurance only reads the first.
  const [falls, setFalls] = useState<number[]>(
    () => logged?.falls ?? (logged?.fellInRound != null ? [logged.fellInRound] : [])
  )
  const fellInRound = falls[0]
  const [fallNotice, setFallNotice] = useState<string | null>(null)
  // End-of-block answer (only asked with no fall): pumped / very easy.
  const [answer, setAnswer] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    if (attemptsDone > 0 || !kind) return
    let cancelled = false
    getSessions()
      .then((sessions) => {
        if (cancelled) return
        const runs = findBlockRuns(sessions, { type: "intervals", blockName: block.blockName, libraryBlockId: block.libraryBlockId })
        const sug = suggestNextIntervals(runs, kind)
        if (!sug) return
        setSuggestion(sug)
        setWorkTime(sug.workTime)
        setSeries(sug.series)
      })
      .catch(console.error)
      .finally(() => { if (!cancelled) setSuggestionReady(true) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Override: the athlete sets their own work time (the coach already
  // approved the block's rounds). The banner goes with it.
  function chooseOwnTime() {
    setSuggestion(null)
    setSeries(plannedSeries)
    setPickOwn(true)
  }
  const ownTimes: number[] = []
  for (let t = INTERVALS_RULES.minWork; t <= INTERVALS_RULES.maxWork; t += INTERVALS_RULES.workStep) ownTimes.push(t)

  // A fall in `r` (1-based). Reachable during that round's work, the rest
  // after it, or the done screen after the last round — a fall right at the
  // end of a round leaves no time to tap during work.
  function recordFall(r: number) {
    if (falls.includes(r) || (kind !== "warmup" && falls.length > 0)) return
    setFalls([...falls, r].sort((a, b) => a - b))
    if (kind === "warmup" && r < series) {
      const next = liveWorkAfterFall(workRef.current)
      if (next !== workRef.current) {
        setWorkTime(next)
        setFallNotice(`Next rounds: ${fmt(next)} work`)
      }
    }
  }

  const [phase, setPhase] = useState<Phase>(attemptsDone > 0 ? "done" : "ready")
  const [round, setRound] = useState(0) // completed work rounds
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const workSoundRef = useRef<Audio.Sound | null>(null)
  const restSoundRef = useRef<Audio.Sound | null>(null)

  useEffect(() => {
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true })
    async function load() {
      try {
        const { sound: w } = await Audio.Sound.createAsync(require("@/assets/images/sounds/beepExercise.mp3"))
        const { sound: r } = await Audio.Sound.createAsync(require("@/assets/images/sounds/beepRest.mp3"))
        workSoundRef.current = w
        restSoundRef.current = r
      } catch { /* sounds optional */ }
    }
    load()
    return () => {
      if (timerRef.current !== null) clearInterval(timerRef.current)
      workSoundRef.current?.unloadAsync()
      restSoundRef.current?.unloadAsync()
    }
  }, [])

  async function play(ref: React.MutableRefObject<Audio.Sound | null>) {
    try { await ref.current?.replayAsync() } catch { /* skip */ }
  }

  // The running countdown: what to call when it ends, and the ms left while
  // paused. One timer at a time — starting one replaces the last.
  const onDoneRef = useRef<(() => void) | null>(null)
  const endRef = useRef(0)
  const pausedMsRef = useRef(0)
  const [paused, setPaused] = useState(false)

  function clearTimer() {
    if (timerRef.current !== null) { clearInterval(timerRef.current); timerRef.current = null }
  }

  function tick(ms: number) {
    clearTimer()
    const end = Date.now() + ms
    endRef.current = end
    timerRef.current = setInterval(() => {
      const remaining = Math.ceil((end - Date.now()) / 1000)
      if (remaining <= 0) {
        clearTimer()
        setTimeRemaining(0)
        onDoneRef.current?.()
      } else {
        setTimeRemaining(remaining)
      }
    }, 100)
  }

  function startTimer(duration: number, onDone: () => void) {
    onDoneRef.current = onDone
    setPaused(false)
    setTimeRemaining(duration)
    tick(duration * 1000)
  }

  function pauseTimer() {
    if (timerRef.current === null) return
    pausedMsRef.current = Math.max(0, endRef.current - Date.now())
    clearTimer()
    setPaused(true)
  }

  function resumeTimer() {
    setPaused(false)
    tick(pausedMsRef.current)
  }


  function handleStart() {
    setRound(0)
    setFalls([])
    setFallNotice(null)
    setAnswer(undefined)
    setStartWork(workRef.current)
    setPhase("prepare")
    startTimer(PREPARE_SECS, () => { play(workSoundRef); runWork(0) })
  }

  function runWork(done: number) {
    setRound(done)
    setPhase("work")
    setRoundWork(workRef.current)
    startTimer(workRef.current, () => endWork(done))
  }

  // End of a work round — its timer ran out, or the athlete fell (a fall ends
  // the round there and the rest starts straight away).
  function endWork(done: number) {
    clearTimer()
    setPaused(false)
    play(restSoundRef)
    if (done + 1 >= series) {
      setRound(done + 1)
      setPhase("done")
    } else if (restTime > 0) {
      setPhase("rest")
      startTimer(restTime, () => { play(workSoundRef); runWork(done + 1) })
    } else {
      runWork(done + 1)
    }
  }

  // Asked only when the athlete didn't fall and the block has a kind.
  const question = attemptsDone > 0 || fellInRound != null || !kind
    ? null
    : kind === "warmup" ? "Did you feel very pumped in the last two rounds?" : "Did it feel very easy?"

  function handleFinish() {
    if (attemptsDone > 0) { goToNextBlock(); return }
    const scData: IntervalsLog = { kind, series, workTime, startWorkTime: startWork, restTime }
    if (fellInRound != null) { scData.fellInRound = fellInRound; scData.falls = falls }
    else if (kind === "warmup") scData.pumped = answer
    else if (kind === "power_endurance") scData.veryEasy = answer
    // Logged as completed, as before; the fall lives in scData.
    logAttempt({ success: true, scData })
    goToNextBlock()
  }

  // ── Ready ──
  if (phase === "ready") {
    return (
      <View style={shared_styles.screen}>
        <TopBar title={blockTitle} onBack={goToPreviousBlock} />
        <View style={s.center}>
          {/* Built from the settings actually being run (incl. a suggested
              work time), then the coach's notes, if any. */}
          {suggestionReady && (
            <Text style={shared_styles.description}>{intervalsDescription({ kind, series, workTime, restTime })}</Text>
          )}
          {!!block.description && <Text style={shared_styles.description}>{block.description}</Text>}
          {!suggestionReady ? <ActivityIndicator color={C.green} /> : (
            <View style={s.configBox}>
              <Text style={s.configMain}>{series} × {fmt(workTime)}</Text>
              <Text style={s.configSub}>work · {fmt(restTime)} rest</Text>
            </View>
          )}
          {/* Progression suggestion — stays until the athlete overrides it. */}
          {!!suggestion && (
            <View style={s.suggestionBanner}>
              <Text style={s.suggestionBannerLast}>{suggestion.lastTime}</Text>
              <Text style={s.suggestionBannerText}>{suggestion.note}</Text>
              <Pressable onPress={chooseOwnTime} hitSlop={8}>
                <Text style={s.suggestionDecline}>Choose my own time</Text>
              </Pressable>
            </View>
          )}
          {pickOwn && (
            <View style={s.answerRow}>
              {ownTimes.map((t) => (
                <Pressable key={t} onPress={() => setWorkTime(t)} style={[s.timeChip, workTime === t && s.answerBtnOn]}>
                  <Text style={[s.answerText, workTime === t && s.answerTextOn]}>{t}s</Text>
                </Pressable>
              ))}
            </View>
          )}
          <View style={{ width: "100%" }}>
            <CustomButton title="Start" onPress={handleStart} disabled={!suggestionReady} />
          </View>
        </View>
      </View>
    )
  }

  // ── Done / review ──
  if (phase === "done") {
    return (
      <View style={shared_styles.screen}>
        <TopBar title={blockTitle} />
        <View style={s.center}>
          <Text style={shared_styles.title}>Intervals complete</Text>
          <Text style={s.doneNum}>{series}</Text>
          <Text style={s.doneLabel}>rounds · {fmt(workTime)} work / {fmt(restTime)} rest</Text>
          {falls.length > 0 && <Text style={s.fellNote}>Fell in round{falls.length > 1 ? "s" : ""} {falls.join(", ")}</Text>}
          {attemptsDone === 0 && !falls.includes(series) && (kind === "warmup" || falls.length === 0) && (
            <Pressable onPress={() => recordFall(series)} hitSlop={8}>
              <Text style={s.lateFallLink}>I fell in the last round</Text>
            </Pressable>
          )}
          {!!question && (
            <View style={s.questionBox}>
              <Text style={s.questionText}>{question}</Text>
              <View style={s.answerRow}>
                {([true, false] as const).map((v) => (
                  <Pressable
                    key={String(v)}
                    onPress={() => setAnswer(v)}
                    style={[s.answerBtn, answer === v && s.answerBtnOn]}
                  >
                    <Text style={[s.answerText, answer === v && s.answerTextOn]}>{v ? "Yes" : "No"}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
          <View style={{ width: "100%", marginTop: 20 }}>
            <CustomButton title="Continue" onPress={handleFinish} disabled={!!question && answer === undefined} />
          </View>
        </View>
      </View>
    )
  }

  // ── Prepare / Work / Rest (live timer) ──
  const dur = phase === "prepare" ? PREPARE_SECS : phase === "work" ? roundWork : restTime
  const fill = dur > 0 ? ((timeRemaining ?? 0) / dur) * 100 : 0
  const label = phase === "prepare" ? "GET READY" : phase === "work" ? "WORK" : "REST"
  const tint = phase === "work" ? C.green : phase === "rest" ? C.textMuted : C.yellow

  return (
    <View style={shared_styles.screen}>
      <TopBar title={blockTitle} />
      <View style={s.center}>
        {phase !== "prepare" && (
          <Text style={s.counter}>Round {Math.min(round + 1, series)} of {series}</Text>
        )}
        <AnimatedCircularProgress
          size={240} width={12} fill={fill}
          tintColor={tint} backgroundColor={C.surface} rotation={0}
        >
          {() => (
            <>
              <Text style={s.phaseLabel}>{label}</Text>
              <Text style={s.timer}>{fmt(timeRemaining ?? 0)}</Text>
            </>
          )}
        </AnimatedCircularProgress>
        {/* A fall during work ends the round and starts the rest at once.
            During rest the button still records the round just finished
            (a fall right at the end of a round). */}
        {(() => {
          const r = round + 1
          const canFall = (phase === "work" || phase === "rest")
            && !falls.includes(r) && (kind === "warmup" || falls.length === 0)
          return (
            <>
              {canFall && (
                <Pressable
                  style={s.fellBtn}
                  onPress={() => { recordFall(r); if (phase === "work") endWork(round) }}
                >
                  <Text style={s.fellBtnText}>{phase === "rest" ? `I fell in round ${r}` : "I fell"}</Text>
                </Pressable>
              )}
              {falls.length > 0 && <Text style={s.fellNote}>Fall logged in round{falls.length > 1 ? "s" : ""} {falls.join(", ")}</Text>}
              {!!fallNotice && <Text style={s.fallNotice}>{fallNotice}</Text>}
            </>
          )
        })()}
        <View style={s.timerControls}>
          <Pressable style={s.controlBtn} onPress={paused ? resumeTimer : pauseTimer} hitSlop={6}>
            <Text style={s.controlBtnText}>{paused ? "Resume" : "Pause"}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 },
  configBox: { alignItems: "center", gap: 4, marginVertical: 12 },
  configMain: { fontSize: 40, fontWeight: "800", color: C.textPrimary },
  configSub: { fontSize: 14, color: C.textSecondary },
  counter: { fontSize: 15, color: C.textSecondary, fontWeight: "600" },
  phaseLabel: { fontSize: 13, fontWeight: "800", letterSpacing: 1.5, color: C.textSecondary },
  timer: { fontSize: 56, fontWeight: "800", color: C.textPrimary, fontVariant: ["tabular-nums"] },
  doneNum: { fontSize: 64, fontWeight: "800", color: C.green },
  doneLabel: { fontSize: 14, color: C.textSecondary },
  fellBtn: {
    paddingHorizontal: 28, paddingVertical: 12, borderRadius: 22,
    borderWidth: 1, borderColor: C.red, marginTop: 8,
  },
  fellBtnText: { fontSize: 15, fontWeight: "700", color: C.red },
  fellNote: { fontSize: 14, fontWeight: "600", color: C.red },
  timerControls: { flexDirection: "row", gap: 12, marginTop: 4 },
  controlBtn: {
    minWidth: 96, alignItems: "center", paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface,
  },
  controlBtnText: { fontSize: 15, fontWeight: "700", color: C.textPrimary },
  fallNotice: { fontSize: 14, fontWeight: "600", color: C.textSecondary },
  lateFallLink: { fontSize: 13, fontWeight: "600", color: C.textSecondary, textDecorationLine: "underline" },
  timeChip: {
    minWidth: 52, alignItems: "center", paddingVertical: 8, paddingHorizontal: 10, borderRadius: 18,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface,
  },
  questionBox: { width: "100%", gap: 10, alignItems: "center", marginTop: 8 },
  questionText: { fontSize: 15, fontWeight: "600", color: C.textPrimary, textAlign: "center" },
  answerRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 12 },
  answerBtn: {
    minWidth: 96, alignItems: "center", paddingVertical: 10, borderRadius: 20,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface,
  },
  answerBtnOn: { backgroundColor: C.green, borderColor: C.green },
  answerText: { fontSize: 15, fontWeight: "700", color: C.textSecondary },
  answerTextOn: { color: C.bg },
  suggestionBanner: {
    width: "100%", backgroundColor: "rgba(111,207,151,0.12)", borderWidth: 1, borderColor: C.green,
    borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, gap: 6,
  },
  suggestionBannerLast: { fontSize: 12.5, color: C.textSecondary, lineHeight: 17 },
  suggestionBannerText: { fontSize: 12.5, fontWeight: "600", color: C.green, lineHeight: 17 },
  suggestionDecline: { fontSize: 12.5, fontWeight: "600", color: C.textSecondary, textDecorationLine: "underline" },
})
