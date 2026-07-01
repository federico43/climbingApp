import { C } from "@/utils/theme"
import CustomButton from "@/components/customButton"
import { shared_styles, TopBar } from "@/utils/BlockStyles"
import { amountLabel, unitNoun, ExerciseUnit } from "@/utils/exerciseUnit"
import { useBlockTimer } from "@/utils/blockTimer"
import { Audio } from "expo-av"
import React, { useEffect, useRef, useState } from "react"
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { AnimatedCircularProgress } from "react-native-circular-progress"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RepExercise {
  type: "reps"
  name: string
  reps: string
  unit?: ExerciseUnit
}

export interface BothSidesExercise {
  type: "both_sides"
  name: string
  reps: string
  unit?: ExerciseUnit
}

export interface SevenThreesExercise {
  type: "7/3s"
  name: string
  edge: string
  series: number
}

export type Exercise = RepExercise | BothSidesExercise | SevenThreesExercise

export interface StrengthConditioningBlock {
  type: "strength_conditioning"
  description?: string
  rounds: number
  restBetweenRounds: number
  exercises: Exercise[]
}

type WeightUnit = "kg" | "lb"

interface ExerciseLog {
  exerciseIndex: number
  exerciseName: string
  round: number
  // reps
  repsCompleted?: string
  weight?: string
  weightUnit?: WeightUnit
  rpe?: string
  notes?: string
  // both sides
  repsLeft?: string
  repsRight?: string
  weightLeft?: string
  weightRight?: string
  rpeLeft?: string
  rpeRight?: string
  // 7/3s
  edge?: string
  seriesDone?: number
}

type Phase = "intro" | "circuit" | "rest" | "review"

interface Props {
  block: StrengthConditioningBlock
  goToNextBlock: () => void
  goToPreviousBlock?: () => void
  logAttempt: (attempt: any) => void
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function StrengthConditioningBlock({ block, goToNextBlock, goToPreviousBlock, logAttempt }: Props) {
  const blockTimer = useBlockTimer()
  const [phase, setPhase] = useState<Phase>("intro")
  const [currentRound, setCurrentRound] = useState(0)
  const [currentExerciseIndex, setCurrentExerciseIndex] = useState(0)
  const [logs, setLogs] = useState<ExerciseLog[]>([])
  const [weightUnit, setWeightUnit] = useState<WeightUnit>("kg")
  // Last weight / RPE used per exercise, so later rounds prefill them (set once,
  // adjust only when they change).
  const [lastWeights, setLastWeights] = useState<Record<number, string>>({})
  const [lastRpe, setLastRpe] = useState<Record<number, string>>({})
  const [restTimeRemaining, setRestTimeRemaining] = useState<number | null>(null)
  const restTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const restEndTimeRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (restTimerRef.current !== null) clearInterval(restTimerRef.current)
    }
  }, [])

  function startRestTimer(duration: number, onDone: () => void) {
    if (restTimerRef.current !== null) clearInterval(restTimerRef.current)
    const end = Date.now() + duration * 1000
    restEndTimeRef.current = end
    setRestTimeRemaining(duration)

    restTimerRef.current = setInterval(() => {
      const remaining = Math.ceil((restEndTimeRef.current! - Date.now()) / 1000)
      if (remaining <= 0) {
        clearInterval(restTimerRef.current!)
        restTimerRef.current = null
        setRestTimeRemaining(0)
        onDone()
      } else {
        setRestTimeRemaining(remaining)
      }
    }, 200)
  }

  function handleExerciseDone(log: Omit<ExerciseLog, "round">) {
    const idx = currentExerciseIndex
    const fullLog: ExerciseLog = { ...log, exerciseIndex: idx, round: currentRound }
    setLogs((prev) => [...prev, fullLog])

    // Remember the weight / RPE for this exercise so the next round prefills them.
    const usedWeight = log.weight ?? log.weightRight ?? log.weightLeft
    if (usedWeight) setLastWeights((prev) => ({ ...prev, [idx]: usedWeight }))
    const usedRpe = log.rpe ?? log.rpeRight ?? log.rpeLeft
    if (usedRpe) setLastRpe((prev) => ({ ...prev, [idx]: usedRpe }))

    logAttempt({
      success: true,
      scData: {
        exerciseName: log.exerciseName,
        round: currentRound + 1,
        repsCompleted: log.repsCompleted,
        weight: log.weight,
        weightUnit: log.weightUnit ?? "kg",
        rpe: log.rpe,
        repsLeft: log.repsLeft,
        repsRight: log.repsRight,
        weightLeft: log.weightLeft,
        weightRight: log.weightRight,
        rpeLeft: log.rpeLeft,
        rpeRight: log.rpeRight,
        edge: log.edge,
        seriesDone: log.seriesDone,
        notes: log.notes,
      },
    })

    const isLastExercise = currentExerciseIndex === block.exercises.length - 1
    const isLastRound = currentRound === block.rounds - 1

    if (isLastExercise) {
      if (isLastRound) {
        setPhase("review")
      } else {
        setPhase("rest")
        startRestTimer(block.restBetweenRounds, () => {
          setCurrentRound((r) => r + 1)
          setCurrentExerciseIndex(0)
          setPhase("circuit")
        })
      }
    } else {
      setCurrentExerciseIndex((i) => i + 1)
    }
  }

  // ── Intro ───────────────────────────────────────────────────────────────────

  if (phase === "intro") {
    const blockTitle = (block as any).blockName || "Strength & conditioning"
    return (
      <View style={shared_styles.screen}>
        <TopBar title={blockTitle} onBack={goToPreviousBlock} />
        <ScrollView
                   contentContainerStyle={styles.introContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {!!block.description && (
            <Text style={styles.description}>{block.description}</Text>
          )}

          <View style={styles.overviewCard}>
            <Text style={styles.overviewLabel}>
              {block.rounds} round{block.rounds !== 1 ? "s" : ""} · {block.exercises.length} exercise{block.exercises.length !== 1 ? "s" : ""}
            </Text>
            {block.exercises.map((ex, i) => (
              <View key={i} style={styles.overviewRow}>
                <Text style={styles.overviewDot}>·</Text>
                <Text style={styles.overviewExercise}>
                  {ex.name}
                  {ex.type === "reps"
                    ? `  ${amountLabel(ex.reps, ex.unit)}`
                    : ex.type === "both_sides"
                    ? `  ${amountLabel(ex.reps, ex.unit)} · both sides`
                    : `  ${ex.series} series · ${ex.edge}`}
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.unitRow}>
            <Text style={styles.unitLabel}>Weight unit</Text>
            <View style={styles.unitToggle}>
              {(["kg", "lb"] as WeightUnit[]).map((u) => (
                <Pressable
                  key={u}
                  style={[styles.unitChip, weightUnit === u && styles.unitChipSelected]}
                  onPress={() => setWeightUnit(u)}
                >
                  <Text style={[styles.unitChipText, weightUnit === u && styles.unitChipTextSelected]}>
                    {u}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <CustomButton title="Start" onPress={() => { blockTimer.start(); setPhase("circuit") }} />
        </ScrollView>
      </View>
    )
  }

  // ── Rest between rounds ─────────────────────────────────────────────────────

  if (phase === "rest") {
    const fillPercent =
      restTimeRemaining != null
        ? (restTimeRemaining / block.restBetweenRounds) * 100
        : 0
    const restUrgent = (restTimeRemaining ?? 99) <= 15

    const skipRest = () => {
      if (restTimerRef.current !== null) clearInterval(restTimerRef.current)
      setCurrentRound((r) => r + 1)
      setCurrentExerciseIndex(0)
      setPhase("circuit")
    }
    return (
      <View style={styles.restContainer}>
        <View style={styles.restHeader}>
          <Text style={styles.restRoundLabel}>Next: round {currentRound + 2} of {block.rounds}</Text>
          <Text style={styles.restSub}>Rest</Text>
        </View>
        <View style={styles.restCircle}>
          <AnimatedCircularProgress
            size={300} width={10} fill={fillPercent}
            tintColor={restUrgent ? C.red : C.green}
            backgroundColor={C.surface}
            rotation={0}
          >
            {() => {
              const t = restTimeRemaining ?? 0
              const display = t > 0
                ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`
                : "go!"
              return <Text style={styles.restTimerText}>{display}</Text>
            }}
          </AnimatedCircularProgress>
        </View>
        <View style={styles.restFooter}>
          <Pressable style={styles.skipBtn} onPress={skipRest}>
            <Text style={styles.skipBtnText}>Skip rest</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  // ── Circuit ─────────────────────────────────────────────────────────────────

  if (phase === "circuit") {
    const exercise = block.exercises[currentExerciseIndex]

    return (
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <TopBar
          title={`Round ${currentRound + 1} of ${block.rounds}`}
          onBack={() => {
            if (currentExerciseIndex > 0) {
              setCurrentExerciseIndex((i) => i - 1)
            } else if (currentRound > 0) {
              setCurrentRound((r) => r - 1)
              setCurrentExerciseIndex(block.exercises.length - 1)
            } else {
              setPhase("intro")
            }
          }}
          right={
            <Text style={styles.topBarRight}>
              {currentExerciseIndex + 1}/{block.exercises.length}
            </Text>
          }
        />
        <ScrollView
          contentContainerStyle={styles.circuitContainer}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {exercise.type === "reps" ? (
            <RepsExerciseUI
              key={`${currentRound}-${currentExerciseIndex}`}
              exercise={exercise}
              weightUnit={weightUnit}
              initialWeight={lastWeights[currentExerciseIndex] ?? ""}
              initialRpe={lastRpe[currentExerciseIndex] ?? ""}
              onDone={(log) => handleExerciseDone(log)}
            />
          ) : exercise.type === "both_sides" ? (
            <BothSidesExerciseUI
              key={`${currentRound}-${currentExerciseIndex}`}
              exercise={exercise}
              weightUnit={weightUnit}
              initialWeight={lastWeights[currentExerciseIndex] ?? ""}
              initialRpe={lastRpe[currentExerciseIndex] ?? ""}
              onDone={(log) => handleExerciseDone(log)}
            />
          ) : (
            <SevenThreesUI
              exercise={exercise}
              onDone={(log) => handleExerciseDone(log)}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    )
  }

  // ── Review ──────────────────────────────────────────────────────────────────

  if (phase === "review") {
    return (
      <ScrollView contentContainerStyle={styles.reviewContainer}>
        <Text style={styles.title}>Circuit complete</Text>

        {Array.from({ length: block.rounds }).map((_, roundIndex) => (
          <View key={roundIndex} style={styles.reviewRound}>
            <Text style={styles.reviewRoundTitle}>Round {roundIndex + 1}</Text>
            {logs
              .filter((l) => l.round === roundIndex)
              .map((l, i) => {
                const exUnit = (block.exercises[l.exerciseIndex] as any)?.unit as ExerciseUnit | undefined
                return (
                <View key={i} style={styles.reviewRow}>
                  <Text style={styles.reviewExerciseName}>{l.exerciseName}</Text>

                  {l.repsCompleted != null && (
                    <Text style={styles.reviewDetail}>
                      {amountLabel(l.repsCompleted, exUnit)}
                      {l.weight ? ` · ${l.weight}${l.weightUnit ?? "kg"}` : ""}
                      {l.rpe ? ` · RPE ${l.rpe}` : ""}
                    </Text>
                  )}

                  {l.repsLeft != null && (
                    <>
                      <Text style={styles.reviewDetail}>
                        L: {amountLabel(l.repsLeft, exUnit)}
                        {l.weightLeft ? ` · ${l.weightLeft}${l.weightUnit ?? "kg"}` : ""}
                        {l.rpeLeft ? ` · RPE ${l.rpeLeft}` : ""}
                      </Text>
                      <Text style={styles.reviewDetail}>
                        R: {amountLabel(l.repsRight, exUnit)}
                        {l.weightRight ? ` · ${l.weightRight}${l.weightUnit ?? "kg"}` : ""}
                        {l.rpeRight ? ` · RPE ${l.rpeRight}` : ""}
                      </Text>
                    </>
                  )}

                  {l.seriesDone != null && (
                    <Text style={styles.reviewDetail}>
                      {l.seriesDone} series · {l.edge}
                      {l.rpe ? ` · RPE ${l.rpe}` : ""}
                    </Text>
                  )}

                  {l.notes ? (
                    <Text style={styles.reviewNotes}>"{l.notes}"</Text>
                  ) : null}
                </View>
                )
              })}
          </View>
        ))}

        <CustomButton title="Continue" onPress={goToNextBlock} />
      </ScrollView>
    )
  }

  return null
}

// ─── RPE Chips ────────────────────────────────────────────────────────────────

function RPEChips({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <>
      <Text style={styles.rpeLabel}>{label ?? "RPE"}</Text>
      <View style={styles.rpeRow}>
        {["6", "7", "8", "9", "10"].map((val) => (
          <Pressable
            key={val}
            style={[styles.rpeChip, value === val && styles.rpeChipSelected]}
            onPress={() => onChange(val)}
          >
            <Text style={[styles.rpeChipText, value === val && styles.rpeChipTextSelected]}>
              {val}
            </Text>
          </Pressable>
        ))}
      </View>
    </>
  )
}

// The prescribed amount may be a single value or a range ("10", "4-6"). Use the
// largest number as the default "completed" value for the stepper.
function targetNumber(s: string): number {
  const nums = (s.match(/\d+/g) ?? []).map(Number)
  return nums.length ? Math.max(...nums) : 0
}

// ─── − value + stepper ────────────────────────────────────────────────────────

function Stepper({ value, onChange, step = 1, min = 0, suffix }: {
  value: number; onChange: (v: number) => void; step?: number; min?: number; suffix?: string
}) {
  const set = (v: number) => onChange(Math.max(min, parseFloat(v.toFixed(2))))
  return (
    <View style={styles.stepperRow}>
      <Pressable style={styles.stepperBtn} onPress={() => set(value - step)} hitSlop={6}>
        <Text style={styles.stepperBtnText}>−</Text>
      </Pressable>
      <Text style={styles.stepperValue}>
        {value}{suffix ? <Text style={styles.stepperSuffix}>{suffix}</Text> : null}
      </Text>
      <Pressable style={styles.stepperBtn} onPress={() => set(value + step)} hitSlop={6}>
        <Text style={styles.stepperBtnText}>+</Text>
      </Pressable>
    </View>
  )
}

// ─── Timed amount control ─────────────────────────────────────────────────────
// A real countdown timer for timed exercises: adjust the target duration, then
// Start → a short "get ready" prep countdown → the hold counts DOWN from the
// target to zero (or Stop early). The completed seconds are reported via onChange.

const TIMED_PREP_SECS = 5

function TimedAmountControl({ target, onChange }: { target: number; onChange: (v: number) => void }) {
  type Phase = "idle" | "prepare" | "running" | "done"
  const [phase, setPhase] = useState<Phase>("idle")
  const [dur, setDur] = useState(Math.max(1, target || 30))
  const [remaining, setRemaining] = useState(Math.max(1, target || 30))
  const [prep, setPrep] = useState(TIMED_PREP_SECS)
  const [completed, setCompleted] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const beepRef = useRef<Audio.Sound | null>(null)   // go / done cue
  const tickRef = useRef<Audio.Sound | null>(null)   // last-3s ticks
  const lastSecRef = useRef(-1)

  useEffect(() => {
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true })
    async function load() {
      try {
        const { sound: b } = await Audio.Sound.createAsync(require("@/assets/images/sounds/beepExercise.mp3"))
        const { sound: t } = await Audio.Sound.createAsync(require("@/assets/images/sounds/beepRest.mp3"))
        beepRef.current = b
        tickRef.current = t
      } catch { /* sounds optional */ }
    }
    load()
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      beepRef.current?.unloadAsync()
      tickRef.current?.unloadAsync()
    }
  }, [])
  function play(ref: React.MutableRefObject<Audio.Sound | null>) {
    ref.current?.replayAsync().catch(() => {})
  }
  function clearTick() { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null } }

  function startPrepare() {
    setPhase("prepare")
    setPrep(TIMED_PREP_SECS)
    lastSecRef.current = -1
    const end = Date.now() + TIMED_PREP_SECS * 1000
    intervalRef.current = setInterval(() => {
      const r = Math.ceil((end - Date.now()) / 1000)
      if (r !== lastSecRef.current) { lastSecRef.current = r; if (r >= 1 && r <= 3) play(tickRef) }
      if (r <= 0) { clearTick(); play(beepRef); beginRun() } else setPrep(r)
    }, 100)
  }
  function beginRun() {
    setPhase("running")
    setRemaining(dur)
    lastSecRef.current = -1
    const end = Date.now() + dur * 1000
    intervalRef.current = setInterval(() => {
      const r = Math.max(0, Math.ceil((end - Date.now()) / 1000))
      if (r !== lastSecRef.current) { lastSecRef.current = r; if (r >= 1 && r <= 3) play(tickRef) }
      setRemaining(r)
      if (r <= 0) { clearTick(); play(beepRef); finish(dur) }
    }, 100)
  }
  function finish(secs: number) { setCompleted(secs); setPhase("done"); onChange(secs) }
  function stopEarly() { clearTick(); finish(dur - remaining) }
  function reset() { clearTick(); setPhase("idle"); setRemaining(dur) }

  if (phase === "idle") {
    return (
      <View style={styles.timedControl}>
        <View style={[styles.stepperRow, { flex: 1 }]}>
          <Pressable style={styles.stepperBtn} hitSlop={6} onPress={() => setDur((d) => Math.max(1, d - 1))}>
            <Text style={styles.stepperBtnText}>−</Text>
          </Pressable>
          <Text style={styles.stepperValue}>{dur}<Text style={styles.stepperSuffix}>s</Text></Text>
          <Pressable style={styles.stepperBtn} hitSlop={6} onPress={() => setDur((d) => d + 1)}>
            <Text style={styles.stepperBtnText}>+</Text>
          </Pressable>
        </View>
        <Pressable style={styles.holdTimerBtn} onPress={startPrepare}>
          <Text style={styles.holdTimerBtnText}>Start{"\n"}timer</Text>
        </Pressable>
      </View>
    )
  }

  if (phase === "prepare") {
    return (
      <View style={styles.timedActive}>
        <Text style={styles.timedPhaseLabel}>GET READY</Text>
        <Text style={[styles.timedBig, { color: C.yellow }]}>{prep}</Text>
      </View>
    )
  }

  if (phase === "running") {
    const urgent = remaining <= 3
    return (
      <View style={styles.timedActive}>
        <Text style={styles.timedPhaseLabel}>HOLD</Text>
        <Text style={[styles.timedBig, { color: urgent ? C.red : C.green }]}>
          {remaining}<Text style={styles.timedBigUnit}>s</Text>
        </Text>
        <Pressable style={[styles.holdTimerBtn, styles.holdTimerBtnStop, styles.timedStopBtn]} onPress={stopEarly}>
          <Text style={[styles.holdTimerBtnText, { color: "#fff" }]}>Stop</Text>
        </Pressable>
      </View>
    )
  }

  // done
  return (
    <View style={styles.timedActive}>
      <Text style={styles.timedPhaseLabel}>DONE</Text>
      <Text style={[styles.timedBig, { color: C.textPrimary }]}>
        {completed}<Text style={styles.timedBigUnit}>s</Text>
      </Text>
      <Pressable style={styles.holdTimerBtn} onPress={reset}>
        <Text style={styles.holdTimerBtnText}>Again</Text>
      </Pressable>
    </View>
  )
}

// Weight + RPE, collapsed behind a toggle by default (timed holds rarely log
// them). The caret flips ▸/▾ to open/close.
function ExerciseDetail({ open, onToggle, weight, setWeight, weightUnit, weightStep, rpe, setRpe, rpeLabel }: {
  open: boolean; onToggle: () => void
  weight: number; setWeight: (v: number) => void; weightUnit: WeightUnit; weightStep: number
  rpe: string; setRpe: (v: string) => void; rpeLabel?: string
}) {
  return (
    <View style={{ width: "100%", gap: 12 }}>
      <Pressable style={styles.detailToggle} onPress={onToggle}>
        <Text style={styles.detailCaret}>{open ? "▾" : "▸"}</Text>
        <Text style={styles.detailToggleText}>Weight & RPE</Text>
      </Pressable>
      {open && (
        <>
          <Text style={styles.miniLabel}>Weight ({weightUnit})</Text>
          <Stepper value={weight} onChange={setWeight} step={weightStep} />
          <RPEChips value={rpe} onChange={setRpe} label={rpeLabel} />
        </>
      )}
    </View>
  )
}

// ─── Reps Exercise UI ─────────────────────────────────────────────────────────

interface RepsExerciseUIProps {
  exercise: RepExercise
  weightUnit: WeightUnit
  initialWeight?: string
  initialRpe?: string
  onDone: (log: Omit<ExerciseLog, "round">) => void
}

function RepsExerciseUI({ exercise, weightUnit, initialWeight, initialRpe, onDone }: RepsExerciseUIProps) {
  const isTimed = exercise.unit === "seconds"
  const startWeight = parseFloat(initialWeight ?? "") || 0
  // Prefill the target; the timer refines it to the actual completed seconds.
  const [amount, setAmount] = useState<number>(targetNumber(exercise.reps))
  const [weight, setWeight] = useState<number>(startWeight)
  const [rpe, setRpe] = useState(initialRpe ?? "")
  const [showDetail, setShowDetail] = useState(startWeight > 0 || !!initialRpe)
  const weightStep = 0.5

  function handleSave() {
    onDone({
      exerciseIndex: 0,
      exerciseName: exercise.name,
      repsCompleted: String(amount),
      weight: weight > 0 ? String(weight) : undefined,
      weightUnit,
      rpe: rpe || undefined,
    })
  }

  return (
    <View style={styles.exerciseCard}>
      <View style={styles.cardTop}>
        <View style={styles.targetRepsBox}>
          <Text style={styles.exerciseName}>{exercise.name}</Text>
          <View style={styles.targetRow}>
            <Text style={styles.targetRepsNumber}>{exercise.reps}</Text>
            <Text style={styles.targetRepsUnit}>{unitNoun(exercise.unit)}</Text>
          </View>
        </View>

        <Text style={styles.miniLabel}>{isTimed ? "Seconds completed" : "Reps completed"}</Text>
        {isTimed
          ? <TimedAmountControl target={targetNumber(exercise.reps)} onChange={setAmount} />
          : <Stepper value={amount} onChange={setAmount} />}
      </View>

      <View style={styles.cardBottom}>
        <ExerciseDetail
          open={showDetail} onToggle={() => setShowDetail((v) => !v)}
          weight={weight} setWeight={setWeight} weightUnit={weightUnit} weightStep={weightStep}
          rpe={rpe} setRpe={setRpe}
        />
        <CustomButton title="Done" onPress={handleSave} />
      </View>
    </View>
  )
}

// ─── Both Sides Exercise UI ───────────────────────────────────────────────────

interface BothSidesExerciseUIProps {
  exercise: BothSidesExercise
  weightUnit: WeightUnit
  initialWeight?: string
  initialRpe?: string
  onDone: (log: Omit<ExerciseLog, "round">) => void
}

type Side = "left" | "right"

function BothSidesExerciseUI({ exercise, weightUnit, initialWeight, initialRpe, onDone }: BothSidesExerciseUIProps) {
  const isTimed = exercise.unit === "seconds"
  // Prefill the target; for timed exercises the timer refines it.
  const initialAmount = targetNumber(exercise.reps)
  const startWeight = parseFloat(initialWeight ?? "") || 0
  const weightStep = 0.5

  const [side, setSide] = useState<Side>("left")
  const [repsLeft, setRepsLeft] = useState(initialAmount)
  const [weightLeft, setWeightLeft] = useState(startWeight)
  const [rpeLeft, setRpeLeft] = useState(initialRpe ?? "")
  const [repsRight, setRepsRight] = useState(initialAmount)
  const [weightRight, setWeightRight] = useState(startWeight)
  const [rpeRight, setRpeRight] = useState(initialRpe ?? "")
  const [showDetail, setShowDetail] = useState(startWeight > 0 || !!initialRpe)

  function handleLeftDone() {
    // Carry the left side's entries over as the right side's starting point.
    setRepsRight(repsLeft)
    setWeightRight(weightLeft)
    setSide("right")
  }

  function handleRightDone() {
    onDone({
      exerciseIndex: 0,
      exerciseName: exercise.name,
      repsLeft: String(repsLeft),
      repsRight: String(repsRight),
      weightLeft: weightLeft > 0 ? String(weightLeft) : undefined,
      weightRight: weightRight > 0 ? String(weightRight) : undefined,
      weightUnit,
      rpeLeft: rpeLeft || undefined,
      rpeRight: rpeRight || undefined,
    })
  }

  const amount = side === "left" ? repsLeft : repsRight
  const setAmount = side === "left" ? setRepsLeft : setRepsRight
  const weight = side === "left" ? weightLeft : weightRight
  const setWeight = side === "left" ? setWeightLeft : setWeightRight

  return (
    <View style={styles.exerciseCard}>
      <View style={styles.cardTop}>
        <View style={styles.targetRepsBox}>
          <View style={styles.nameRow}>
            <Text style={styles.exerciseName}>{exercise.name}</Text>
            <View style={styles.sideChip}>
              <Text style={styles.sideChipText}>{side === "left" ? "LEFT" : "RIGHT"}</Text>
            </View>
          </View>
          <View style={styles.targetRow}>
            <Text style={styles.targetRepsNumber}>{exercise.reps}</Text>
            <Text style={styles.targetRepsUnit}>{unitNoun(exercise.unit)} each side</Text>
          </View>
        </View>

        <Text style={styles.miniLabel}>{isTimed ? "Seconds completed" : "Reps completed"}</Text>
        {isTimed
          ? <TimedAmountControl key={side} target={targetNumber(exercise.reps)} onChange={setAmount} />
          : <Stepper value={amount} onChange={setAmount} />}
      </View>

      <View style={styles.cardBottom}>
        <ExerciseDetail
          open={showDetail} onToggle={() => setShowDetail((v) => !v)}
          weight={weight} setWeight={setWeight} weightUnit={weightUnit} weightStep={weightStep}
          rpe={side === "left" ? rpeLeft : rpeRight}
          setRpe={side === "left" ? setRpeLeft : setRpeRight}
          rpeLabel={side === "left" ? "RPE — Left" : "RPE — Right"}
        />

        {side === "left" ? (
          <CustomButton title="Done — switch to right side" onPress={handleLeftDone} />
        ) : (
          <CustomButton title="Done" onPress={handleRightDone} />
        )}
      </View>
    </View>
  )
}

// ─── 7/3s Exercise UI ─────────────────────────────────────────────────────────

interface SevenThreesUIProps {
  exercise: SevenThreesExercise
  onDone: (log: Omit<ExerciseLog, "round">) => void
}

type SevenThreesPhase = "ready" | "hanging" | "prepare" | "resting" | "done"

function SevenThreesUI({ exercise, onDone }: SevenThreesUIProps) {
  const [seriesDone, setSeriesDone] = useState(0)
  const [innerPhase, setInnerPhase] = useState<SevenThreesPhase>("ready")
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null)
  const [rpe, setRpe] = useState("")
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hangSoundRef = useRef<Audio.Sound | null>(null)
  const restSoundRef = useRef<Audio.Sound | null>(null)

  useEffect(() => {
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true })

    async function loadSounds() {
      const { sound: hangSound } = await Audio.Sound.createAsync(
        require("@/assets/images/sounds/beepExercise.mp3")
      )
      const { sound: restSound } = await Audio.Sound.createAsync(
        require("@/assets/images/sounds/beepRest.mp3")
      )
      hangSoundRef.current = hangSound
      restSoundRef.current = restSound
    }
    loadSounds()

    return () => {
      if (timerRef.current !== null) clearInterval(timerRef.current)
      hangSoundRef.current?.unloadAsync()
      restSoundRef.current?.unloadAsync()
    }
  }, [])

  async function playSound(ref: React.MutableRefObject<Audio.Sound | null>) {
    try {
      await ref.current?.replayAsync()
    } catch {
      // sound not yet loaded or already unloaded, skip
    }
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
    setSeriesDone(0)
    setInnerPhase("prepare")
    startTimer(5, () => {
      playSound(hangSoundRef)
      runNextSeries(0)
    })
  }

  function runNextSeries(done: number) {
    setInnerPhase("hanging")
    startTimer(7, () => {
      playSound(restSoundRef)
      if (done + 1 >= exercise.series) {
        setSeriesDone(done + 1)
        setInnerPhase("done")
      } else {
        setInnerPhase("resting")
        startTimer(3, () => {
          playSound(hangSoundRef)
          const next = done + 1
          setSeriesDone(next)
          runNextSeries(next)
        })
      }
    })
  }

  function handleFinish() {
    onDone({
      exerciseIndex: 0,
      exerciseName: exercise.name,
      edge: exercise.edge,
      seriesDone,
      rpe: rpe || undefined,
    })
  }

  const fillPercent =
    innerPhase === "hanging"
      ? ((timeRemaining ?? 0) / 7) * 100
      : ((timeRemaining ?? 0) / 3) * 100

  if (innerPhase === "ready") {
    return (
      <View style={styles.exerciseCard}>
        <Text style={styles.exerciseName}>7/3s</Text>
        <Text style={styles.exerciseTarget}>
          {exercise.series} series · {exercise.edge}
        </Text>
        <Text style={styles.sevenThreesExplainer}>
          7s hang → 3s rest, repeated {exercise.series}×
        </Text>
        <CustomButton title="Start" onPress={handleStart} />
      </View>
    )
  }

  if (innerPhase === "prepare") {
    return (
      <View style={styles.exerciseCard}>
        <Text style={styles.exerciseName}>Get ready</Text>
        <Text style={styles.exerciseTarget}>{exercise.edge}</Text>

        <AnimatedCircularProgress
          style={styles.circularProgress}
          size={200}
          width={10}
          fill={((timeRemaining ?? 0) / 5) * 100}
          tintColor={C.textMuted}
          backgroundColor={C.surface}
        >
          {() => (
            <>
              <Text style={styles.hangRestLabel}>PREPARE</Text>
              <Text style={styles.timerText}>{timeRemaining}s</Text>
            </>
          )}
        </AnimatedCircularProgress>
      </View>
    )
  }

  if (innerPhase === "hanging" || innerPhase === "resting") {
    return (
      <View style={styles.exerciseCard}>
        <Text style={styles.exerciseName}>7/3s · {exercise.edge}</Text>
        <Text style={styles.seriesCounter}>
          Series {seriesDone + 1} of {exercise.series}
        </Text>

        <AnimatedCircularProgress
          style={styles.circularProgress}
          size={200}
          width={10}
          fill={fillPercent}
          tintColor={innerPhase === "hanging" ? C.green : C.textMuted}
          backgroundColor={C.surface}
        >
          {() => (
            <>
              <Text style={styles.hangRestLabel}>
                {innerPhase === "hanging" ? "HANG" : "REST"}
              </Text>
              <Text style={styles.timerText}>{timeRemaining}s</Text>
            </>
          )}
        </AnimatedCircularProgress>
      </View>
    )
  }

  if (innerPhase === "done") {
    return (
      <View style={styles.exerciseCard}>
        <Text style={styles.exerciseName}>7/3s complete</Text>
        <Text style={styles.exerciseTarget}>
          {seriesDone} / {exercise.series} series · {exercise.edge}
        </Text>

        <RPEChips value={rpe} onChange={setRpe} />
        <CustomButton title="Done" onPress={handleFinish} />
      </View>
    )
  }

  return null
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  introContent: { flexGrow: 1, padding: 20, gap: 16 },
  circuitContainer: { paddingHorizontal: 30, paddingVertical: 20, flexGrow: 1 },
  title: { fontSize: 24, fontWeight: "700", marginBottom: 12, color: C.textPrimary },
  description: { fontSize: 16, color: C.textSecondary, lineHeight: 24 },
  topBarRight: { fontSize: 13, fontWeight: "600", color: C.textSecondary },
  overviewCard: { width: "100%", backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 16 },
  overviewLabel: { fontSize: 13, color: C.textSecondary, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 },
  overviewRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  overviewDot: { fontSize: 18, marginRight: 8, color: C.textMuted },
  overviewExercise: { fontSize: 15, fontWeight: "500", flex: 1, color: C.textPrimary },

  unitRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%", marginBottom: 20 },
  unitLabel: { fontSize: 14, color: C.textSecondary },
  unitToggle: { flexDirection: "row", gap: 8 },
  unitChip: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: C.border },
  unitChipSelected: { backgroundColor: C.green, borderColor: C.green },
  unitChipText: { fontSize: 14, fontWeight: "600", color: C.textSecondary },
  unitChipTextSelected: { color: C.bg },

  exerciseCard: { flex: 1, width: "100%", justifyContent: "space-between" },
  cardTop: { gap: 12 },
  cardBottom: { gap: 12 },
  exerciseName: { fontSize: 20, fontWeight: "700", textAlign: "center", color: C.textPrimary },
  exerciseTarget: { fontSize: 15, color: C.textSecondary, marginBottom: 8, textAlign: "center" },

  targetRepsBox: {
    alignItems: "center",
    gap: 4,
    backgroundColor: C.surface,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  targetRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "center", gap: 8 },
  targetRepsNumber: { fontSize: 24, fontWeight: "800", color: C.textPrimary },
  targetRepsUnit: { fontSize: 12, color: C.textSecondary, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase" },

  nameRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  sideChip: { backgroundColor: C.green, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  sideChipText: { fontSize: 11, fontWeight: "800", color: C.bg, letterSpacing: 0.5 },

  circularProgress: { alignSelf: "center" },
  sevenThreesExplainer: { fontSize: 14, color: C.textMuted, marginBottom: 8, textAlign: "center" },
  seriesCounter: { fontSize: 16, color: C.textSecondary, marginBottom: 12, textAlign: "center" },
  hangRestLabel: { fontSize: 13, fontWeight: "700", letterSpacing: 1, color: C.textSecondary, textAlign: "center" },
  timerText: { fontSize: 42, fontWeight: "700", textAlign: "center", color: C.textPrimary },

  input: { width: "100%", borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, fontSize: 15, color: C.textPrimary, backgroundColor: C.surfaceHigh },

  miniLabel: { fontSize: 12, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: -4 },

  // − value + stepper
  stepperRow: {
    flexDirection: "row", alignItems: "center", width: "100%",
    backgroundColor: C.surfaceHigh, borderRadius: 12, overflow: "hidden",
  },
  stepperBtn: { width: 60, paddingVertical: 16, alignItems: "center", justifyContent: "center" },
  stepperBtnText: { fontSize: 28, fontWeight: "400", color: C.green },
  stepperValue: { flex: 1, textAlign: "center", fontSize: 24, fontWeight: "800", color: C.textPrimary },
  stepperSuffix: { fontSize: 15, fontWeight: "600", color: C.textSecondary },

  // Rest-between-rounds timer (mirrors the project-bouldering rest screen)
  restContainer: { flex: 1, backgroundColor: C.bg, paddingTop: 16, paddingBottom: 48, paddingHorizontal: 24 },
  restHeader: { alignItems: "center", gap: 4 },
  restRoundLabel: { fontSize: 22, fontWeight: "700", color: C.textPrimary },
  restSub: { fontSize: 14, color: C.textMuted },
  restCircle: { flex: 1, alignItems: "center", justifyContent: "center" },
  restTimerText: { fontSize: 72, fontWeight: "700", color: C.textPrimary, textAlign: "center" },
  restFooter: { alignItems: "center", width: "100%" },
  skipBtn: {
    borderRadius: 20, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 28, paddingVertical: 10,
  },
  skipBtnText: { fontSize: 15, fontWeight: "600", color: C.textSecondary },

  // Timed amount control — stepper box with the hold button on its right
  timedControl: { width: "100%", flexDirection: "row", alignItems: "stretch", gap: 10 },
  timedActive: { width: "100%", alignItems: "center", gap: 8, paddingVertical: 8 },
  timedPhaseLabel: { fontSize: 12, fontWeight: "800", letterSpacing: 1.5, color: C.textSecondary },
  timedBig: { fontSize: 60, fontWeight: "800", fontVariant: ["tabular-nums"], lineHeight: 66 },
  timedBigUnit: { fontSize: 24, fontWeight: "700", color: C.textSecondary },
  timedStopBtn: { alignSelf: "stretch" },
  holdTimerBtn: {
    paddingHorizontal: 18, borderRadius: 14,
    borderWidth: 1.5, borderColor: C.green,
    alignItems: "center", justifyContent: "center",
  },
  holdTimerBtnStop: { backgroundColor: C.red, borderColor: C.red },
  holdTimerBtnText: { fontSize: 14, fontWeight: "800", color: C.green, textAlign: "center" },

  // Collapsible weight/RPE toggle
  detailToggle: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 6,
  },
  detailCaret: { fontSize: 12, color: C.textSecondary, width: 12, textAlign: "center" },
  detailToggleText: { fontSize: 13, fontWeight: "700", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.5 },

  rpeLabel: { fontSize: 13, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  rpeRow: { flexDirection: "row", gap: 8, width: "100%", marginBottom: 8 },
  rpeChip: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: C.border, alignItems: "center" },
  rpeChipSelected: { backgroundColor: C.green, borderColor: C.green },
  rpeChipText: { fontSize: 15, fontWeight: "500", color: C.textSecondary },
  rpeChipTextSelected: { color: C.bg },

  reviewContainer: { padding: 20, gap: 16 },
  reviewRound: { backgroundColor: C.surface, borderRadius: 14, padding: 16, gap: 10 },
  reviewRoundTitle: { fontSize: 14, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, color: C.textSecondary, marginBottom: 4 },
  reviewRow: { gap: 2 },
  reviewExerciseName: { fontSize: 15, fontWeight: "600", color: C.textPrimary },
  reviewDetail: { fontSize: 14, color: C.textSecondary },
  reviewNotes: { fontSize: 13, color: C.textMuted, fontStyle: "italic", marginTop: 2 },
})
