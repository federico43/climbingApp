import { C } from "@/utils/theme"
import { Ionicons } from "@expo/vector-icons"
import { Audio } from "expo-av"
import { useEffect, useRef, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { AnimatedCircularProgress } from "react-native-circular-progress"

// Work / rest countdown for jump rope cardio: 5 s to get ready, then
// `series` rounds of work and rest, with the interval blocks' beeps. Also
// used for single timed pieces (dry jumps, a test attempt): series 1, rest 0.

const PREPARE_SECS = 5

type Phase = "prepare" | "work" | "rest"

export function CardioTimer({ series, workSec, restSec, label, doublesEverySec, onDone }: {
  series: number
  workSec: number
  restSec: number
  /** Shown over the clock during work, e.g. "Jump rope" or "Attempt 2 of 3". */
  label: string
  doublesEverySec?: number | null
  onDone: () => void
}) {
  const [phase, setPhase] = useState<Phase>("prepare")
  const [round, setRound] = useState(0)
  const [left, setLeft] = useState(PREPARE_SECS)
  const [paused, setPaused] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const endAt = useRef(0)
  const pausedMs = useRef(0)
  const onEnd = useRef<() => void>(() => {})
  const workSound = useRef<Audio.Sound | null>(null)
  const restSound = useRef<Audio.Sound | null>(null)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  const clear = () => { if (timer.current) { clearInterval(timer.current); timer.current = null } }
  const play = (s: React.MutableRefObject<Audio.Sound | null>) => { s.current?.replayAsync().catch(() => {}) }

  function tick(ms: number) {
    clear()
    endAt.current = Date.now() + ms
    timer.current = setInterval(() => {
      const r = Math.ceil((endAt.current - Date.now()) / 1000)
      if (r <= 0) { clear(); setLeft(0); onEnd.current() } else setLeft(r)
    }, 100)
  }
  function run(sec: number, then: () => void) {
    onEnd.current = then
    setLeft(sec)
    tick(sec * 1000)
  }
  function work(r: number) {
    setRound(r)
    setPhase("work")
    run(workSec, () => {
      play(restSound)
      if (r + 1 >= series) { onDoneRef.current(); return }
      if (restSec <= 0) { play(workSound); work(r + 1); return }
      setPhase("rest")
      run(restSec, () => { play(workSound); work(r + 1) })
    })
  }

  useEffect(() => {
    let unmounted = false
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true }).catch(() => {})
    // Each sound is unloaded even when it finishes loading after the timer
    // is gone (a quick Skip, or a 30 s piece): otherwise it leaks.
    const load = async (file: number, into: React.MutableRefObject<Audio.Sound | null>) => {
      try {
        const { sound } = await Audio.Sound.createAsync(file)
        if (unmounted) sound.unloadAsync().catch(() => {})
        else into.current = sound
      } catch { /* sounds optional */ }
    }
    load(require("@/assets/images/sounds/beepExercise.mp3"), workSound)
    load(require("@/assets/images/sounds/beepRest.mp3"), restSound)
    run(PREPARE_SECS, () => { play(workSound); work(0) })
    return () => {
      unmounted = true
      clear()
      // A moment later: the last beep plays right as the timer closes.
      // Read at cleanup on purpose: the sounds load after the effect starts.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const sounds = [workSound.current, restSound.current]
      setTimeout(() => sounds.forEach((x) => x?.unloadAsync().catch(() => {})), 2000)
    }
    // Runs once: the timer owns its own sequence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Dev builds only: jump past the whole timer to test the flow quickly.
  function skipAll() {
    clear()
    onDoneRef.current()
  }

  function togglePause() {
    if (paused) { setPaused(false); tick(pausedMs.current) }
    else { pausedMs.current = Math.max(0, endAt.current - Date.now()); clear(); setPaused(true) }
  }

  const dur = phase === "prepare" ? PREPARE_SECS : phase === "work" ? workSec : restSec
  const color = paused ? C.textPrimary : phase === "work" ? C.green : phase === "rest" ? C.yellow : C.textSecondary
  const title = paused ? "Paused" : phase === "prepare" ? "Get ready" : phase === "work" ? label : "Rest"
  const elapsedInWork = workSec - left
  const doubles = phase === "work" && !!doublesEverySec && elapsedInWork > 0 && elapsedInWork % doublesEverySec === 0

  return (
    <View style={s.wrap}>
      <Text style={[s.phase, { color }]}>{title}</Text>
      {series > 1 && <Text style={s.round}>Series {Math.min(round + 1, series)} of {series}</Text>}
      <AnimatedCircularProgress
        size={240} width={14} fill={dur ? ((dur - left) / dur) * 100 : 0}
        tintColor={color} backgroundColor={C.surfaceHigh} rotation={0} lineCap="round"
      >
        {() => <Text style={s.clock}>{left}</Text>}
      </AnimatedCircularProgress>
      {doublesEverySec ? (
        <Text style={[s.hint, doubles && { color: C.yellow }]}>
          {doubles ? "Doubles now!" : `Doubles every ${doublesEverySec}s`}
        </Text>
      ) : null}
      <Pressable onPress={togglePause} style={s.pause} hitSlop={8} accessibilityLabel={paused ? "Resume" : "Pause"}>
        <Ionicons name={paused ? "play" : "pause"} size={26} color={C.textPrimary} />
      </Pressable>
      {__DEV__ && (
        <Pressable onPress={skipAll} hitSlop={8} style={s.skip} accessibilityLabel="Skip (dev)">
          <Text style={s.skipText}>Skip (dev)</Text>
        </Pressable>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { alignItems: "center", gap: 14, paddingTop: 20 },
  phase: { fontSize: 28, fontWeight: "800", letterSpacing: -0.3 },
  round: { fontSize: 15, color: C.textSecondary, fontWeight: "600" },
  clock: { fontSize: 72, fontWeight: "800", color: C.textPrimary },
  hint: { fontSize: 15, color: C.textSecondary, fontWeight: "700" },
  skip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: C.textMuted },
  skipText: { fontSize: 13, fontWeight: "700", color: C.textSecondary },
  pause: {
    marginTop: 10, width: 64, height: 64, borderRadius: 32, backgroundColor: C.surfaceHigh,
    alignItems: "center", justifyContent: "center",
  },
})
