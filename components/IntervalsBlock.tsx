import { C } from "@/utils/theme"
import CustomButton from "@/components/customButton"
import { shared_styles, TopBar } from "@/utils/BlockStyles"
import type { Attempt } from "@/hooks/WorkoutHook"
import { Audio } from "expo-av"
import React, { useEffect, useRef, useState } from "react"
import { StyleSheet, Text, View } from "react-native"
import { AnimatedCircularProgress } from "react-native-circular-progress"

interface Props {
  block: any  // { blockName, description, series, workTime, restTime }
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
export function IntervalsBlock({ block, logAttempt, attempts, goToNextBlock, goToPreviousBlock }: Props) {
  const series   = Math.max(1, block.series ?? 6)
  const workTime = Math.max(1, block.workTime ?? 30)
  const restTime = Math.max(0, block.restTime ?? 60)
  const blockTitle = block.blockName || "Intervals"
  const attemptsDone = attempts.length

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

  function startTimer(duration: number, onDone: () => void) {
    if (timerRef.current !== null) clearInterval(timerRef.current)
    const end = Date.now() + duration * 1000
    setTimeRemaining(duration)
    timerRef.current = setInterval(() => {
      const remaining = Math.ceil((end - Date.now()) / 1000)
      if (remaining <= 0) {
        clearInterval(timerRef.current!)
        timerRef.current = null
        setTimeRemaining(0)
        onDone()
      } else {
        setTimeRemaining(remaining)
      }
    }, 100)
  }

  function handleStart() {
    setRound(0)
    setPhase("prepare")
    startTimer(PREPARE_SECS, () => { play(workSoundRef); runWork(0) })
  }

  function runWork(done: number) {
    setRound(done)
    setPhase("work")
    startTimer(workTime, () => {
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
    })
  }

  function handleFinish() {
    logAttempt({ success: true, scData: { series, workTime, restTime } })
    goToNextBlock()
  }

  // ── Ready ──
  if (phase === "ready") {
    return (
      <View style={shared_styles.screen}>
        <TopBar title={blockTitle} onBack={goToPreviousBlock} />
        <View style={s.center}>
          {!!block.description && <Text style={shared_styles.description}>{block.description}</Text>}
          <View style={s.configBox}>
            <Text style={s.configMain}>{series} × {fmt(workTime)}</Text>
            <Text style={s.configSub}>work · {fmt(restTime)} rest</Text>
          </View>
          <View style={{ width: "100%" }}>
            <CustomButton title="Start" onPress={handleStart} />
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
          <View style={{ width: "100%", marginTop: 20 }}>
            <CustomButton title="Continue" onPress={handleFinish} />
          </View>
        </View>
      </View>
    )
  }

  // ── Prepare / Work / Rest (live timer) ──
  const dur = phase === "prepare" ? PREPARE_SECS : phase === "work" ? workTime : restTime
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
})
