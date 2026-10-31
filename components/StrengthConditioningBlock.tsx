import { C } from "@/utils/theme"
import { shared_styles, TopBar } from "@/utils/BlockStyles"
import { amountLabel, ExerciseUnit, isTimedExercise } from "@/utils/exerciseUnit"
import { useBlockTimer } from "@/utils/blockTimer"
import { loadWeightUnit, saveWeightUnit, WeightUnit } from "@/utils/weightUnit"
import { getSessions, getUsers, setEdgeLiftMax, type ExerciseRow as LibraryExercise, type SessionRow } from "@/services/BoulderGraphService"
import { currentMax, EDGE_WARMUP, needsWarmup, warmupRamp, type WarmupSet } from "@/utils/edgeWarmup"
import { loadCachedEdgeMax, saveCachedEdgeMax } from "@/utils/edgeMaxCache"
import {
  Effort, EFFORT_LABEL, effortToRpe, EFFORTS, Focus, FOCUS_COLOR, FOCUS_CUE, FOCUS_LABEL, convertWeight, DEFAULT_LOAD_STEP, LevelStep, LoadMode, planRoundDrop, planRoundRaise, repChoices, targetFor, type RoundDrop, type Target,
} from "@/utils/scProgression"
import { readRound, setsAtFinalLoad } from "@/utils/scHistory"
import { basisLine, planNextForFocus, type FocusEntry, type NextPlan } from "@/utils/scNext"
import { planFromHistory, type ExerciseSetting } from "@/utils/scPrefill"
import { chainIds, chainIndexOf, findLibraryRow, usableAt, type ResolvedChain } from "@/utils/levelChain"
import { getExerciseLibrary } from "@/utils/exerciseLibraryCache"
import { MOVEMENT_TYPE_LABEL, MOVEMENT_TYPES, type MovementType } from "@/utils/movementTypes"
import { planPickFor, swapCandidates, swappedExercise, type PatternPicks, type SwapReason, type SwapScope } from "@/utils/scSwap"
import { useWorkoutLink } from "@/contexts/WorkoutContext"
import { useRestNotification } from "@/hooks/useRestNotification"
import { useAuth } from "@/components/auth-context"
import { planForWorkout, swapExerciseInPlan } from "@/services/planSwap"
import { Audio } from "expo-av"
import * as Haptics from "expo-haptics"
import React, { useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native"
import { Image } from "expo-image"
import { ZoomableImage } from "@/components/ZoomableImage"
import { Ionicons } from "@expo/vector-icons"
import { LinearGradient } from "expo-linear-gradient"
import { AnimatedCircularProgress } from "react-native-circular-progress"
import { useNextBlockLabel } from "@/utils/blockNav"

const SC_HERO = require("@/assets/images/SCPicture.jpeg")

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RepExercise {
  type: "reps"
  name: string
  exerciseId?: string  // back-reference to the library row this was added from
  reps: string
  unit?: ExerciseUnit
  photoUri?: string
  notes?: string
  focus?: Focus
  loadMode?: LoadMode
  levels?: LevelStep[]
  loadStep?: number     // weight mode: smallest jump; the live library's value wins
  settingHarder?: string // adjustable-setting hints; the live library's win
  settingEasier?: string
  movementType?: string // "mobility" = no weight/RPE/progression, just done
  maxTest?: boolean     // Edge Lifts max test (utils/edgeWarmup.ts)
}

export interface BothSidesExercise {
  type: "both_sides"
  name: string
  exerciseId?: string  // back-reference to the library row this was added from
  reps: string
  unit?: ExerciseUnit
  photoUri?: string
  notes?: string
  focus?: Focus
  loadMode?: LoadMode
  levels?: LevelStep[]
  loadStep?: number     // weight mode: smallest jump; the live library's value wins
  settingHarder?: string // adjustable-setting hints; the live library's win
  settingEasier?: string
  movementType?: string // "mobility" = no weight/RPE/progression, just done
  maxTest?: boolean     // Edge Lifts max test (utils/edgeWarmup.ts)
}

export interface SevenThreesExercise {
  type: "7/3s"
  name: string
  exerciseId?: string  // back-reference to the library row this was added from
  edge: string
  series: number
  photoUri?: string
  notes?: string
}

export type Exercise = RepExercise | BothSidesExercise | SevenThreesExercise

export interface StrengthConditioningBlockData {
  type: "strength_conditioning"
  description?: string
  rounds: number
  restBetweenRounds: number
  exercises: Exercise[]
}

interface ExerciseLog {
  exerciseIndex: number
  exerciseName: string
  round: number
  // reps
  repsCompleted?: string
  weight?: string
  weightUnit?: WeightUnit
  // When the exercise's loadMode is "level", the level actually performed —
  // its identity (id + exerciseName above) is what gets logged and matched
  // against next time, not the container exercise's.
  levelId?: string
  rpe?: string
  effort?: Effort   // what the athlete tapped; rpe is its mapping
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
  // Set when this round ran at an automatic easier load (planRoundDrop) and
  // the athlete kept it: what the load was before the drop.
  adjustedFrom?: { weight?: string; levelId?: string }
  // Done as another library exercise the athlete swapped in (its id), and why.
  swappedTo?: string
  swapReason?: SwapReason
  swapScope?: SwapScope
  // How the exercise done was measured (a swap can change it).
  unit?: ExerciseUnit
  // Exercises with an adjustable setting: the athlete's "I'm on the
  // hardest setting" switch for this round.
  atHardestSetting?: boolean
}

type Phase = "intro" | "circuit" | "rest" | "review"

interface Props {
  block: StrengthConditioningBlockData
  goToNextBlock: () => void
  goToPreviousBlock?: () => void
  logAttempt: (attempt: any) => void
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function StrengthConditioningBlock({ block, goToNextBlock, goToPreviousBlock, logAttempt }: Props) {
  const nextLabel = useNextBlockLabel("Continue")
  const blockTimer = useBlockTimer()
  // The plan workout this block belongs to, if any: a "Change exercise" can
  // then also be made for the rest of the plan (utils/scSwap).
  const link = useWorkoutLink()
  const { User } = useAuth()
  const [planPatterns, setPlanPatterns] = useState<PatternPicks[] | null>(null)
  useEffect(() => {
    if (!link?.planId || !User?.$id) return
    let cancelled = false
    planForWorkout(User.$id, link.planId).then((plan) => { if (!cancelled && plan) setPlanPatterns(plan.scPatterns) })
    return () => { cancelled = true }
  }, [link?.planId, User?.$id])
  // The plan pick behind a block exercise — a ladder step stands for the
  // pick on its ladder (the plan prescribes the athlete's step).
  const planPickAt = (idx: number) => planPatterns
    ? planPickFor(planPatterns, block.exercises[idx]?.exerciseId, chains[idx] ? chainIds(chains[idx]) : [])
    : undefined
  const canSwapInPlan = (idx: number) => !!planPickAt(idx)
  const { height: winHeight } = useWindowDimensions()
  const [phase, setPhase] = useState<Phase>("intro")
  const [currentRound, setCurrentRound] = useState(0)
  const [currentExerciseIndex, setCurrentExerciseIndex] = useState(0)
  const [logs, setLogs] = useState<ExerciseLog[]>([])
  // Remembered per device (utils/weightUnit) and switched from the weight
  // stepper itself, so blocks without weights never ask for it.
  const [weightUnit, setWeightUnitState] = useState<WeightUnit>("kg")
  // Switching converts the remembered weights too, so 20 kg becomes 44 lb
  // rather than "20 lb".
  function setWeightUnit(u: WeightUnit) {
    if (u === weightUnit) return
    const from = weightUnit
    setLastWeights((prev) => Object.fromEntries(Object.entries(prev).map(([k, w]) => [k, String(convertWeight(parseFloat(w) || 0, from, u))])))
    setOriginals((prev) => Object.fromEntries(Object.entries(prev).map(([k, p]) => [k, p.weight ? { ...p, weight: String(convertWeight(parseFloat(p.weight) || 0, from, u)) } : p])))
    setWeightUnitState(u)
    saveWeightUnit(u)
  }
  // Last weight / level used per exercise, so later rounds prefill them
  // (set once, adjust only when they change). Seeded from the athlete's own
  // history on mount (see the effect below), then kept up to date round to
  // round within this session by handleExerciseDone.
  const [lastWeights, setLastWeights] = useState<Record<number, string>>({})
  const [lastLevels, setLastLevels] = useState<Record<number, LevelStep>>({})
  // Each level exercise's full chain, resolved from the live library on
  // mount (see resolveExerciseChain). Absent = weight mode.
  const [chains, setChains] = useState<Record<number, ResolvedChain>>({})
  // Each weight-mode exercise's smallest weight jump (library first).
  const [loadSteps, setLoadSteps] = useState<Record<number, number | undefined>>({})
  // Adjustable-setting hints per exercise (library first, block copy offline)
  // and the "hardest setting" switch to start each round on.
  const [settings, setSettings] = useState<Record<number, ExerciseSetting>>({})
  const [lastHardest, setLastHardest] = useState<Record<number, boolean>>({})
  // Each exercise's recent sessions (any focus, newest first) — the
  // end-of-block card judges today on top of them (deload / stall rules,
  // explosiveness following max force).
  const [pastSessions, setPastSessions] = useState<Record<number, FocusEntry[]>>({})
  // History + library loaded (or given up on) — Start waits for it so round
  // 1 doesn't mount before its prefill exists.
  const [prefillReady, setPrefillReady] = useState(false)
  // Why the seeded weight/level is what it is, e.g. "▲ 20 → 21 kg — 6 reps
  // on every set" (see planNextForFocus). Unset when there's nothing to judge.
  const [suggestionNotes, setSuggestionNotes] = useState<Record<number, string>>({})
  // What each note is based on ("Last time · Sep 30 · 10, 9, 8 reps").
  const [suggestionDetails, setSuggestionDetails] = useState<Record<number, string>>({})
  // An exercise's last round came in under the floor: its next round is one
  // step easier (already applied to lastWeights / lastLevels), with this
  // banner + Undo. Cleared once that round is logged.
  const [roundDrops, setRoundDrops] = useState<Record<number, RoundDrop>>({})
  // The live exercise library (null offline) — the swap picker reads it.
  // Swaps: block exercise index → the library exercise the athlete picked
  // instead (an easier one after a missed floor, or any one by choice), used
  // for the rest of the block. This session only; the block isn't changed.
  const [library, setLibrary] = useState<LibraryExercise[] | null>(null)
  const [swaps, setSwaps] = useState<Record<number, ActiveSwap>>({})
  // While swapped: the block exercise's own prefill / in-session state, put
  // back on Undo (and used by the review to judge its own rounds).
  const [originals, setOriginals] = useState<Record<number, Prefill>>({})
  // Sessions read on mount — a swapped-in exercise is prefilled from them.
  const sessionsRef = useRef<SessionRow[] | null>(null)
  // Which exercise the picker is for, and why; kept after closing so the
  // sheet's content doesn't change while it slides away.
  const [pickerFor, setPickerFor] = useState<{ idx: number; reason: SwapReason } | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  // The full-screen "Switch sides" card (timed both-sides holds) is shown on
  // the block's first switch only; after that the glow + haptic carry it.
  const [switchCardSeen, setSwitchCardSeen] = useState(false)
  // The athlete's Edge Lifts max (kg; null = none yet, undefined = couldn't
  // read it, e.g. offline), read on mount — max force Edge Lifts start on
  // it, after a warm-up built from it (utils/edgeWarmup.ts).
  const [edgeMax, setEdgeMax] = useState<number | null | undefined>(undefined)

  // The setting hints for the exercise as it's being done (a swap's prefill
  // brings its own).
  function settingFor(idx: number): ExerciseSetting | undefined {
    return settings[idx]
  }

  // The exercise as it's actually being done: a swap takes the picked
  // exercise's identity, photo, notes and ladder, and keeps the block's
  // target where it fits (see swappedExercise).
  function effectiveExercise(idx: number): Exercise {
    const ex = block.exercises[idx]
    const swap = swaps[idx]
    if (!swap || ex.type === "7/3s") return ex
    return swappedExercise(ex, swap.row) as Exercise
  }

  // One exercise's prefill / in-session state, read from (or written to) the
  // per-index maps below — so a swap can stash the original's and Undo can
  // put it back.
  function prefillAt(idx: number): Prefill {
    return {
      chain: chains[idx], loadStep: loadSteps[idx], setting: settings[idx], weight: lastWeights[idx], level: lastLevels[idx],
      note: suggestionNotes[idx], detail: suggestionDetails[idx], hardest: lastHardest[idx], past: pastSessions[idx],
    }
  }
  function applyPrefill(idx: number, p: Prefill | null) {
    const put = <V,>(set: React.Dispatch<React.SetStateAction<Record<number, V>>>, v: V | undefined) =>
      set((prev) => { const n = { ...prev }; if (v === undefined) delete n[idx]; else n[idx] = v; return n })
    put(setChains, p?.chain)
    put<number | undefined>(setLoadSteps, p?.loadStep)
    put(setSettings, p?.setting)
    put(setLastWeights, p?.weight)
    put(setLastLevels, p?.level)
    put(setSuggestionNotes, p?.note)
    put(setSuggestionDetails, p?.detail)
    put(setLastHardest, p?.hardest)
    put(setPastSessions, p?.past)
  }

  function swapExercise(idx: number, row: LibraryExercise, reason: SwapReason, scope: SwapScope = "session") {
    // Stash the block exercise's own state the first time only — swapping
    // again from a swap still undoes back to the original.
    if (!swaps[idx]) setOriginals((prev) => ({ ...prev, [idx]: prefillAt(idx) }))
    const pickId = swaps[idx]?.pick?.id ?? planPickAt(idx)
    const pick = pickId ? { id: pickId, name: chains[idx]?.chain.find((l) => l.exerciseId === pickId)?.name ?? block.exercises[idx].name } : undefined
    setSwaps((prev) => ({ ...prev, [idx]: { row, reason, scope, ...(scope === "plan" && pick ? { pick } : {}) } }))
    if (scope === "plan" && pick) changePlan(idx, swaps[idx]?.scope === "plan" ? swaps[idx].row.$id : pick.id, row.$id, row.name, false, pick.name)
    // The picked exercise starts from its own history (nothing carried over
    // from a different exercise); a pending easier-round banner was for the
    // old one.
    applyPrefill(idx, prefillFor(swappedExercise(block.exercises[idx], row) as Exercise, sessionsRef.current, library, weightUnit))
    setRoundDrops((prev) => { const n = { ...prev }; delete n[idx]; return n })
  }

  // Replace the plan's pick (and later built workouts) on the server. On
  // failure the swap stays for today only and the athlete is told.
  function changePlan(idx: number, fromId: string, toId: string, toName: string, undoing = false, pickName?: string) {
    if (!link?.planId) return
    const fromName = undoing ? swaps[idx]?.row.name ?? "" : swaps[idx]?.scope === "plan" ? swaps[idx].row.name : pickName ?? block.exercises[idx].name
    swapExerciseInPlan({ planId: link.planId, fromExerciseId: fromId, fromExerciseName: fromName, toExerciseId: toId, afterPlanIndex: link.planIndex })
      .then(() => {
        setPlanPatterns((prev) => prev?.map((p) => ({ ...p, exerciseIds: p.exerciseIds.map((id) => (id === fromId ? toId : id)) })) ?? prev)
      })
      .catch((e: any) => {
        if (!undoing) setSwaps((prev) => (prev[idx]?.row.$id === toId ? { ...prev, [idx]: { ...prev[idx], scope: "session" } } : prev))
        Alert.alert(
          undoing ? "Plan not changed back" : "Plan not changed",
          `${e?.message ?? "Couldn't reach the server."} ${undoing ? `Your plan still uses ${fromName}.` : `${toName} is used for today only.`}`,
        )
      })
  }

  function undoSwap(idx: number) {
    // A plan swap is undone in the plan too.
    const swap = swaps[idx]
    const original = swap?.pick ?? (block.exercises[idx]?.exerciseId ? { id: block.exercises[idx].exerciseId!, name: block.exercises[idx].name } : undefined)
    if (swap?.scope === "plan" && original) changePlan(idx, swap.row.$id, original.id, original.name, true)
    applyPrefill(idx, originals[idx] ?? null)
    setOriginals((prev) => { const n = { ...prev }; delete n[idx]; return n })
    setSwaps((prev) => { const n = { ...prev }; delete n[idx]; return n })
    setRoundDrops((prev) => { const n = { ...prev }; delete n[idx]; return n })
  }
  const [restTimeRemaining, setRestTimeRemaining] = useState<number | null>(null)
  const restTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const restEndTimeRef = useRef<number | null>(null)
  const [restEndsAt, setRestEndsAt] = useState<number | null>(null)
  useRestNotification(restEndsAt)

  useEffect(() => {
    return () => {
      if (restTimerRef.current !== null) clearInterval(restTimerRef.current)
    }
  }, [])

  // Seed round-1 prefills from the athlete's most recent prior session, run
  // through the focus-vs-RPE-band suggestion so the first round of a new
  // session already reflects last time's result rather than starting blank.
  // Level chains come from the live library, so a chain edited after this
  // block was saved (or one the block's copy never knew about) still applies.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      withTimeout(getSessions(), PREFILL_TIMEOUT_MS).catch(() => null),
      withTimeout(getExerciseLibrary(), PREFILL_TIMEOUT_MS).catch(() => null),
      loadWeightUnit(),
      User?.$id ? readEdgeMax(User.$id) : Promise.resolve(undefined),
    ])
      .then(([sessions, library, unit, max]) => {
        if (cancelled) return
        setWeightUnitState(unit)
        setEdgeMax(max)
        const resolved: Record<number, ResolvedChain> = {}
        const weights: Record<number, string> = {}
        const levels: Record<number, LevelStep> = {}
        const notes: Record<number, string> = {}

        const steps: Record<number, number | undefined> = {}
        const sets: Record<number, ExerciseSetting> = {}
        const details: Record<number, string> = {}
        const hardest: Record<number, boolean> = {}
        const past: Record<number, FocusEntry[]> = {}

        sessionsRef.current = sessions
        block.exercises.forEach((ex, idx) => {
          const p = prefillFor(ex, sessions, library, unit)
          if (!p) return
          if (p.chain) resolved[idx] = p.chain
          steps[idx] = p.loadStep
          if (p.setting) sets[idx] = p.setting
          if (p.past) past[idx] = p.past
          if (p.hardest != null) hardest[idx] = p.hardest
          if (p.level) levels[idx] = p.level
          if (p.weight != null) weights[idx] = p.weight
          if (p.note) notes[idx] = p.note
          if (p.detail) details[idx] = p.detail
          // Edge Lifts with a max: the rounds are at the max, not last
          // time's weight.
          if (max != null && ex.type !== "7/3s" && needsWarmup(ex)) {
            weights[idx] = String(convertWeight(max, "kg", unit))
            delete notes[idx]
            delete details[idx]
          }
        })

        setChains(resolved)
        setLibrary(library)
        setLoadSteps(steps)
        setSettings(sets)
        setSuggestionDetails(details)
        setLastHardest((prev) => ({ ...hardest, ...prev }))
        setPastSessions(past)
        setLastWeights((prev) => ({ ...weights, ...prev }))
        setLastLevels((prev) => ({ ...levels, ...prev }))
        setSuggestionNotes((prev) => ({ ...notes, ...prev }))
      })
      .finally(() => { if (!cancelled) setPrefillReady(true) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function startRestTimer(duration: number, onDone: () => void) {
    if (restTimerRef.current !== null) clearInterval(restTimerRef.current)
    const end = Date.now() + duration * 1000
    restEndTimeRef.current = end
    setRestTimeRemaining(duration)
    setRestEndsAt(duration > 0 ? end : null)

    restTimerRef.current = setInterval(() => {
      const remaining = Math.ceil((restEndTimeRef.current! - Date.now()) / 1000)
      if (remaining <= 0) {
        clearInterval(restTimerRef.current!)
        restTimerRef.current = null
        setRestTimeRemaining(0)
        setRestEndsAt(null)
        onDone()
      } else {
        setRestTimeRemaining(remaining)
      }
    }, 200)
  }

  function handleExerciseDone(log: Omit<ExerciseLog, "round">) {
    const idx = currentExerciseIndex
    const swap = swaps[idx]
    const ex = effectiveExercise(idx)
    const fullLog: ExerciseLog = {
      ...log, exerciseIndex: idx, round: currentRound, swappedTo: swap?.row.$id, swapReason: swap?.reason, swapScope: swap?.scope,
      unit: ex.type === "7/3s" ? undefined : isTimedExercise(ex) ? "seconds" : ex.unit,
    }
    setLogs((prev) => [...prev, fullLog])

    // Remember the weight / level for this exercise so the next round prefills them.
    // (Reps and effort are never prefilled — see AmountInput.)
    const usedWeight = log.weight ?? log.weightRight ?? log.weightLeft
    if (usedWeight) setLastWeights((prev) => ({ ...prev, [idx]: usedWeight }))
    // Always remember the level picked, the prescribed step included — so
    // stepping back down in round 2 isn't undone by round 3 reopening on
    // round 1's harder level.
    const chainNow = chains[idx]
    if (chainNow) setLastLevels((prev) => ({ ...prev, [idx]: { exerciseId: log.levelId ?? "", name: log.exerciseName } }))
    const setting = settingFor(idx)
    if (setting) setLastHardest((prev) => ({ ...prev, [idx]: !!log.atHardestSetting }))

    // Under the floor → the next round of this exercise starts one step
    // easier (weaker side for both-sides). Only when there is a next round.
    let drop: RoundDrop | null = null
    if (ex && ex.type !== "7/3s" && ex.movementType !== "mobility" && currentRound < block.rounds - 1) {
      const round = readRound(log)
      const chain = chainNow
      const target = targetFor(ex.focus, ex.reps, ex.unit === "seconds" ? "seconds" : "reps")
      if (setting?.easier) {
        // An adjustable setting: the banner says how to make it easier;
        // nothing changes automatically (sc-modifications-plan Q5).
        drop = planRoundDrop(target, round.amount, { kind: "weight", weight: 0, unit: weightUnit }, setting.easier)
      } else if (chain) {
        const at = chainIndexOf(chain, log.levelId)
        // Only levels tagged for today's focus ("Used for") — e.g. never a
        // negative pull-up on an explosiveness day.
        drop = planRoundDrop(target, round.amount, { kind: "level", chain: chain.chain, idx: at >= 0 ? at : chain.prescribedIdx, usable: usableAt(chain, ex.focus) })
      } else {
        drop = planRoundDrop(target, round.amount, { kind: "weight", weight: round.weight ?? 0, loadStep: loadSteps[idx], unit: weightUnit })
      }
      // Above the range: make it harder now (setup hint, or a little more
      // weight) — a suggestion only.
      drop ??= planRoundRaise(target, round.amount, ex.focus, {
        settingHarder: setting?.harder, atHardest: !!log.atHardestSetting,
        weight: round.weight, loadStep: loadSteps[idx], unit: weightUnit, level: !!chain,
      })
    }
    setRoundDrops((prev) => {
      const next = { ...prev }
      if (drop) next[idx] = drop
      else delete next[idx]
      return next
    })
    if (drop?.weight != null) setLastWeights((prev) => ({ ...prev, [idx]: String(drop!.weight) }))
    if (drop?.level) setLastLevels((prev) => ({ ...prev, [idx]: drop!.level! }))
    if (drop?.bannerOnly && !drop.raise && setting) setLastHardest((prev) => ({ ...prev, [idx]: false }))

    logAttempt({
      success: true,
      scData: {
        // A level round is logged under the LEVEL's identity, not the
        // container's — reps/sets belong to whichever exercise was actually
        // performed, and next time's history lookup needs to find it there.
        exerciseId: log.levelId ?? ex?.exerciseId,
        exerciseName: log.exerciseName,
        // The focus it was programmed for, so next time's prefill only
        // compares against rounds done at the same focus.
        focus: ex.type !== "7/3s" ? ex.focus : undefined,
        round: currentRound + 1,
        repsCompleted: log.repsCompleted,
        weight: log.weight,
        weightUnit: log.weightUnit ?? "kg",
        rpe: log.rpe,
        effort: log.effort,
        repsLeft: log.repsLeft,
        repsRight: log.repsRight,
        weightLeft: log.weightLeft,
        weightRight: log.weightRight,
        rpeLeft: log.rpeLeft,
        rpeRight: log.rpeRight,
        edge: log.edge,
        seriesDone: log.seriesDone,
        notes: log.notes,
        adjustedFrom: log.adjustedFrom,
        atHardestSetting: log.atHardestSetting,
        // A swapped round belongs to the picked exercise's history; this
        // points back at what the block prescribed, and why it was swapped
        // (for the coach — see utils/scSwap).
        swappedFrom: swap ? { exerciseId: block.exercises[idx]?.exerciseId, exerciseName: block.exercises[idx]?.name } : undefined,
        swapReason: swap?.reason,
        // "plan" = the athlete also replaced it for the rest of the plan.
        swapScope: swap ? swap.scope : undefined,
      },
    })

    // No mid-session popup on reaching the top of the range: a single round
    // at the ceiling isn't the rule (every set is — see decideNext), and the
    // old "add weight" alert contradicted next session's call. The review
    // screen's "Next time" card says what the rule decided.

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
          {/* Full-bleed hero, fading into the background at the bottom */}
          <View style={styles.hero}>
            <Image source={SC_HERO} style={styles.heroImg} contentFit="cover" contentPosition={{ top: "25%" }} />
            <LinearGradient colors={["transparent", C.bg]} style={styles.heroFade} pointerEvents="none" />
          </View>

          <View style={styles.introHead}>
            <Text style={styles.exKicker}>Strength & conditioning</Text>
            <Text style={styles.introTitle}>{blockTitle}</Text>
            <Text style={styles.introMeta}>
              {block.rounds} round{block.rounds !== 1 ? "s" : ""} · {block.exercises.length} exercise{block.exercises.length !== 1 ? "s" : ""}
              {block.restBetweenRounds > 0 ? ` · ${formatRest(block.restBetweenRounds)} rest` : ""}
            </Text>
          </View>

          {!!block.description && (
            <Text style={styles.description}>{block.description}</Text>
          )}

          <View style={styles.exList}>
            {block.exercises.map((ex, i) => <ExerciseRow key={i} exercise={ex} />)}
          </View>
        </ScrollView>
        <View style={styles.screenFooter}>
          {prefillReady ? (
            <PillButton title="Start" icon="play" onPress={() => { blockTimer.start(); setPhase("circuit") }} />
          ) : (
            <View style={styles.prefillLoading}>
              <ActivityIndicator color={C.green} />
              <Text style={styles.prefillLoadingText}>Loading your last session…</Text>
            </View>
          )}
        </View>
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
      setRestEndsAt(null)
      setCurrentRound((r) => r + 1)
      setCurrentExerciseIndex(0)
      setPhase("circuit")
    }
    const upNext = effectiveExercise(0)
    // Ring sized to the screen, and smaller for each easier-round note, so
    // the notes and "Up next" fit without scrolling on most phones. The
    // content still scrolls if they don't.
    const dropCount = Object.keys(roundDrops).length
    const ringSize = Math.round(Math.max(150, Math.min(260, winHeight * 0.32) - dropCount * 40))
    return (
      <View style={shared_styles.screen}>
        <ScrollView contentContainerStyle={styles.restContainer} showsVerticalScrollIndicator={false}>
          <Text style={styles.exKicker}>Rest</Text>
          <Text style={styles.introTitle}>Round {currentRound + 2} of {block.rounds} next</Text>
          <View style={styles.restCircle}>
            <AnimatedCircularProgress
              size={ringSize} width={ringSize > 200 ? 10 : 8} fill={fillPercent}
              tintColor={restUrgent ? C.red : C.green}
              backgroundColor={C.surface}
              rotation={0}
            >
              {() => {
                const t = restTimeRemaining ?? 0
                const display = t > 0
                  ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`
                  : "go!"
                return <Text style={[styles.restTimerText, { fontSize: Math.round(ringSize * 0.25) }]}>{display}</Text>
              }}
            </AnimatedCircularProgress>
          </View>
          {Object.entries(roundDrops).map(([i, d]) => (
            <View key={i} style={styles.restDrop}>
              <Ionicons name="arrow-down-circle" size={20} color={C.yellow} />
              <View style={{ flex: 1 }}>
                <Text style={styles.restDropName}>{effectiveExercise(Number(i))?.name}</Text>
                <Text style={styles.restDropText}>{d.note}</Text>
              </View>
            </View>
          ))}
          {!!upNext && (
            <>
              <Text style={styles.sectionLabel}>Up next</Text>
              <ExerciseRow exercise={upNext} />
            </>
          )}
        </ScrollView>
        <View style={styles.screenFooter}>
          <PillButton title="Skip rest" icon="play-skip-forward" variant="secondary" onPress={skipRest} />
        </View>
      </View>
    )
  }

  // ── Circuit ─────────────────────────────────────────────────────────────────

  if (phase === "circuit") {
    const exercise = effectiveExercise(currentExerciseIndex)
    const swapped = swaps[currentExerciseIndex]
    const roundKey = `${currentRound}-${currentExerciseIndex}-${swapped?.row.$id ?? ""}`
    const openPicker = (reason: SwapReason) => { setPickerFor({ idx: currentExerciseIndex, reason }); setPickerOpen(true) }
    const pickEasier = () => openPicker("easier")
    const changeExercise = () => openPicker("choice")
    const undoCurrentSwap = () => undoSwap(currentExerciseIndex)
    const swapNote = swapped
      ? swapped.scope === "plan"
        ? `Replaces ${block.exercises[currentExerciseIndex].name} from now on in your plan`
        : `Replaces ${block.exercises[currentExerciseIndex].name} for the rest of this block (today only)`
      : undefined
    // Round 2+ skips the brief (the athlete knows the exercise) unless the
    // load was just made easier or the exercise was just swapped.
    const justSwapped = !!swapped && !logs.some((l) => l.exerciseIndex === currentExerciseIndex && l.swappedTo === swapped.row.$id)
    const startOnBrief = currentRound === 0 || !!roundDrops[currentExerciseIndex] || justSwapped
    // Share of the block's exercises done so far, across all rounds.
    const progress = (currentRound * block.exercises.length + currentExerciseIndex) / (block.rounds * block.exercises.length)

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
        />
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        {exercise.type !== "7/3s" && exercise.maxTest ? (
          <MaxTestUI
            key={roundKey}
            exercise={exercise}
            userId={User?.$id}
            currentMaxKg={edgeMax}
            weightUnit={weightUnit}
            onSaved={(kg) => { setEdgeMax(kg); if (User?.$id) saveCachedEdgeMax(User.$id, kg) }}
            onDone={(log) => handleExerciseDone(log)}
          />
        ) : exercise.type !== "7/3s" && exercise.movementType === "mobility" ? (
          <MobilityExerciseUI
            key={roundKey}
            exercise={exercise}
            showSwitchCard={!switchCardSeen}
            onSwitchCardShown={() => setSwitchCardSeen(true)}
            onChangeExercise={changeExercise}
            swapNote={swapNote}
            onUndoSwap={undoCurrentSwap}
            onDone={(log) => handleExerciseDone(log)}
          />
        ) : exercise.type !== "7/3s" ? (
          <LoggedExerciseUI
            key={roundKey}
            exercise={exercise}
            levelChain={chains[currentExerciseIndex]}
            weightUnit={weightUnit}
            onWeightUnitChange={setWeightUnit}
            initialWeight={lastWeights[currentExerciseIndex] ?? ""}
            initialLevel={lastLevels[currentExerciseIndex]}
            setting={settingFor(currentExerciseIndex)}
            initialHardest={!!lastHardest[currentExerciseIndex]}
            suggestionNote={currentRound === 0 || justSwapped ? suggestionNotes[currentExerciseIndex] : undefined}
            suggestionDetail={currentRound === 0 || justSwapped ? suggestionDetails[currentExerciseIndex] : undefined}
            roundDrop={roundDrops[currentExerciseIndex]}
            onPickEasier={pickEasier}
            onChangeExercise={changeExercise}
            swapNote={swapNote}
            onUndoSwap={undoCurrentSwap}
            startOnBrief={startOnBrief}
            warmup={currentRound === 0 && !swapped && edgeMax != null && needsWarmup(exercise) ? warmupRamp(edgeMax, weightUnit, loadSteps[currentExerciseIndex]) : undefined}
            noMax={currentRound === 0 && !swapped && edgeMax === null && needsWarmup(exercise)}
            showSwitchCard={!switchCardSeen}
            onSwitchCardShown={() => setSwitchCardSeen(true)}
            onDone={(log) => handleExerciseDone(log)}
          />
        ) : (
          <SevenThreesUI
            exercise={exercise}
            onDone={(log) => handleExerciseDone(log)}
          />
        )}
        <ExerciseSwapPicker
          visible={pickerOpen}
          reason={pickerFor?.reason ?? "choice"}
          original={pickerFor !== null ? block.exercises[pickerFor.idx] : undefined}
          current={pickerFor !== null ? swaps[pickerFor.idx]?.row : undefined}
          planOption={pickerFor !== null && pickerFor.reason === "choice" && canSwapInPlan(pickerFor.idx)}
          library={library}
          onClose={() => setPickerOpen(false)}
          onPick={(row, scope) => {
            swapExercise(pickerFor!.idx, row, pickerFor!.reason, scope)
            setPickerOpen(false)
          }}
        />
      </KeyboardAvoidingView>
    )
  }

  // ── Review ──────────────────────────────────────────────────────────────────

  if (phase === "review") {
    // What next session will start on, per exercise — the same rule the
    // prefill applies, run over today's rounds.
    const judge = (ex: Exercise, roundLogs: ExerciseLog[], p: Prefill): string => {
      if (ex.type === "7/3s" || ex.movementType === "mobility") return ""
      // The max decides Edge Lifts' weight (utils/edgeWarmup.ts), not the
      // progression rule.
      if (ex.maxTest || (edgeMax != null && needsWarmup(ex))) return ""
      const rounds = roundLogs
        .sort((a, b) => a.round - b.round)
        .map((l) => readRound({ ...l, exerciseId: l.levelId ?? ex.exerciseId }, weightUnit))
      const summary = setsAtFinalLoad(rounds)
      const today: FocusEntry | null = summary ? { focus: ex.focus, date: new Date().toISOString(), prescribed: ex.reps, unit: ex.unit === "seconds" ? "seconds" : "reps", summary } : null
      return today ? planNextForFocus({ ...ex, setting: p.setting }, p.chain, p.loadStep, weightUnit, [today, ...(p.past ?? [])], "today").note : ""
    }
    const nextTime = block.exercises.flatMap((ex, idx) => {
      const out: { name: string; note: string }[] = []
      const swap = swaps[idx]
      // Swapped rounds were a different exercise — they don't judge this
      // one; the block exercise is judged on its own rounds and state.
      const note = judge(ex, logs.filter((l) => l.exerciseIndex === idx && !l.swappedTo), swap ? originals[idx] ?? {} : prefillAt(idx))
      const easier = logs.find((l) => l.exerciseIndex === idx && l.swappedTo && l.swapReason === "easier")
      const swapNote = easier ? `Swapped to ${easier.exerciseName} — this exercise needs an easier version on its ladder` : ""
      const text = [note, swapNote].filter(Boolean).join("\n")
      if (text) out.push({ name: ex.name, note: text })
      // The exercise swapped in is judged on its own rounds and history.
      if (swap) {
        const now = effectiveExercise(idx)
        const swappedNote = judge(now, logs.filter((l) => l.exerciseIndex === idx && l.swappedTo === swap.row.$id), prefillAt(idx))
        if (swappedNote) out.push({ name: now.name, note: swappedNote })
      }
      return out
    })
    return (
      <View style={shared_styles.screen}>
        <ScrollView contentContainerStyle={styles.reviewContainer} showsVerticalScrollIndicator={false}>
          <View style={styles.introHead}>
            <Text style={styles.exKicker}>Block done</Text>
            <Text style={styles.introTitle}>Circuit complete</Text>
          </View>

          {nextTime.length > 0 && (
            <View style={styles.nextTimeCard}>
              <Text style={styles.nextTimeTitle}>Next time</Text>
              {nextTime.map((n, i) => (
                <View key={i} style={styles.nextTimeRow}>
                  <Text style={styles.nextTimeName}>{n.name}</Text>
                  <Text style={styles.nextTimeNote}>{n.note}</Text>
                </View>
              ))}
            </View>
          )}

          {Array.from({ length: block.rounds }).map((_, roundIndex) => (
            <View key={roundIndex} style={styles.reviewRound}>
              <Text style={styles.reviewRoundTitle}>Round {roundIndex + 1}</Text>
              {logs
                .filter((l) => l.round === roundIndex)
                .map((l, i) => {
                  const exUnit = l.unit ?? (block.exercises[l.exerciseIndex] as any)?.unit as ExerciseUnit | undefined
                  return (
                  <View key={i} style={styles.reviewRow}>
                    <Text style={styles.reviewExerciseName}>{l.exerciseName}</Text>
                    {!!l.swappedTo && (
                      <Text style={styles.reviewDetail}>In place of {block.exercises[l.exerciseIndex]?.name}</Text>
                    )}

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
                      <Text style={styles.reviewNotes}>&quot;{l.notes}&quot;</Text>
                    ) : null}
                  </View>
                  )
                })}
            </View>
          ))}
        </ScrollView>
        <View style={styles.screenFooter}>
          <PillButton title={nextLabel} icon="arrow-forward" onPress={goToNextBlock} />
        </View>
      </View>
    )
  }

  return null
}

// Named-step equivalent of RPEChips, for exercises that progress by level
// (e.g. calisthenics) instead of a numeric weight. Wraps rather than scrolls
// since most lists are short enough to fit two rows.
//
// Shows the whole chain, easiest → hardest, including levels easier than
// the one the coach prescribed — the athlete can always step down.
function LevelPicker({ levelChain, value, suggested, onChange }: {
  levelChain: ResolvedChain; value?: string; suggested?: string; onChange: (v: LevelStep) => void
}) {
  const prescribedId = levelChain.chain[levelChain.prescribedIdx]?.exerciseId
  return (
    <>
      <Text style={styles.sectionLabel}>Level</Text>
      <View style={styles.levelPickerRow}>
        {levelChain.chain.map((lvl) => {
          const selected = value === lvl.exerciseId
          // One tag per chip: the recommended step wins over the coach's
          // pick, and stays marked after the athlete picks something else so
          // they can still see (and return to) it.
          const tag = suggested === lvl.exerciseId ? "Suggested" : prescribedId === lvl.exerciseId ? "Prescribed" : null
          return (
            <Pressable
              key={lvl.exerciseId || lvl.name}
              style={[styles.levelChip, selected && styles.levelChipSelected]}
              onPress={() => onChange(lvl)}
            >
              <Text style={[styles.levelChipText, selected && styles.levelChipTextSelected]} numberOfLines={1}>
                {lvl.name}
              </Text>
              {!!tag && (
                <Text style={[styles.levelChipSuggested, selected && styles.levelChipSuggestedSelected]}>
                  {tag}
                </Text>
              )}
            </Pressable>
          )
        })}
      </View>
    </>
  )
}

// A block exercise swapped for another library exercise (see utils/scSwap).
// `pick`: the plan pick a plan-scope swap replaced, restored on undo.
interface ActiveSwap { row: LibraryExercise; reason: SwapReason; scope: SwapScope; pick?: { id: string; name: string } }

// What an exercise starts on: its ladder, weight jump and setting hints from
// the live library, and the weight / level / note from the athlete's own
// history at today's focus (see planNextForFocus).
interface Prefill {
  chain?: ResolvedChain
  loadStep?: number
  setting?: ExerciseSetting
  weight?: string
  level?: LevelStep
  note?: string
  detail?: string     // what the note is based on
  hardest?: boolean
  past?: FocusEntry[] // recent sessions, any focus, newest first
}

// null for exercises that don't progress (mobility, 7/3s).
function prefillFor(ex: Exercise, sessions: SessionRow[] | null, library: LibraryExercise[] | null, unit: WeightUnit): Prefill | null {
  if (ex.type === "7/3s" || ex.movementType === "mobility") return null
  const { next, ...out }: Prefill & { next?: NextPlan } = planFromHistory(ex, sessions, library, unit)
  if (!next) return out
  if (next.atHardest != null) out.hardest = next.atHardest
  if (next.level) out.level = next.level
  if (next.weight != null) out.weight = String(next.weight)
  if (next.note) out.note = next.note
  const basis = basisLine(next, ex.focus, next.level?.name ?? ex.name, unit)
  if (basis) out.detail = basis
  return out
}

// History + library fetches can hang offline; past this, start without them
// (the block's own copy of each chain is the fallback).
const PREFILL_TIMEOUT_MS = 6000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms)
    promise.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
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
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(String(value))

  const set = (v: number) => onChange(Math.max(min, parseFloat(v.toFixed(2))))

  function startEditing() {
    setText(value ? String(value) : "")
    setEditing(true)
  }

  function commit() {
    const parsed = parseFloat(text.replace(",", "."))
    if (!Number.isNaN(parsed)) set(parsed)
    setEditing(false)
  }

  // If a +/- tap lands while the field is mid-edit, step from the typed
  // value (not the last committed one) so an in-progress edit isn't lost.
  function stepBy(delta: number) {
    const base = editing ? (parseFloat(text.replace(",", ".")) || 0) : value
    setEditing(false)
    set(base + delta)
  }

  return (
    <View style={styles.stepperRow}>
      <Pressable style={styles.stepperBtn} onPress={() => stepBy(-step)} hitSlop={6}>
        <Text style={styles.stepperBtnText}>−</Text>
      </Pressable>
      {editing ? (
        <TextInput
          style={styles.stepperInput}
          value={text}
          onChangeText={setText}
          onBlur={commit}
          onSubmitEditing={commit}
          keyboardType="decimal-pad"
          returnKeyType="done"
          autoFocus
          selectTextOnFocus
        />
      ) : (
        <Pressable style={styles.stepperValueTouch} onPress={startEditing} hitSlop={4}>
          <Text style={styles.stepperValue}>
            {value}{suffix ? <Text style={styles.stepperSuffix}>{suffix}</Text> : null}
          </Text>
        </Pressable>
      )}
      <Pressable style={styles.stepperBtn} onPress={() => stepBy(step)} hitSlop={6}>
        <Text style={styles.stepperBtnText}>+</Text>
      </Pressable>
    </View>
  )
}

// ─── Timed amount control ─────────────────────────────────────────────────────
// A real countdown timer for timed exercises: set the timer length (±5 s,
// captioned so it doesn't read as the logged value), then Start → a short
// "get ready" prep countdown → the hold counts DOWN to zero (or Stop early).
// The completed seconds are reported via onChange and shown as "Logged".

const TIMED_PREP_SECS = 5

// `fixed`: the length isn't the athlete's to change (warm-up holds).
function TimedAmountControl({ target, onChange, fixed }: { target: number; onChange: (v: number) => void; fixed?: boolean }) {
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
      <View style={styles.timerCard}>
        <View style={styles.timerLengthRow}>
          {!fixed && <Pressable style={styles.timerAdjustBtn} hitSlop={6} onPress={() => setDur((d) => Math.max(5, d - 5))}>
            <Text style={styles.timerAdjustText}>−5 s</Text>
          </Pressable>}
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={styles.timerLengthValue}>{dur}<Text style={styles.timedBigUnit}> s</Text></Text>
            <Text style={styles.timerLengthCaption}>{fixed ? "Hold" : "Timer length"}</Text>
          </View>
          {!fixed && <Pressable style={styles.timerAdjustBtn} hitSlop={6} onPress={() => setDur((d) => d + 5)}>
            <Text style={styles.timerAdjustText}>+5 s</Text>
          </Pressable>}
        </View>
        <Pressable style={({ pressed }) => [styles.timerStartBtn, pressed && { opacity: 0.8 }]} onPress={startPrepare}>
          <Ionicons name="play" size={16} color={C.green} />
          <Text style={styles.timerStartText}>Start {dur} s hold</Text>
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
      <Text style={styles.timedPhaseLabel}>LOGGED</Text>
      <Text style={[styles.timedBig, { color: C.textPrimary }]}>
        {completed}<Text style={styles.timedBigUnit}> s</Text>
      </Text>
      <Pressable style={[styles.holdTimerBtn, styles.timedAgainBtn]} onPress={reset}>
        <Text style={styles.holdTimerBtnText}>Redo hold</Text>
      </Pressable>
    </View>
  )
}

// ─── Logging controls ────────────────────────────────────────────────────────

// How many reps (or seconds) were done. Nothing is preselected: Done stays
// locked until the athlete picks, so a tap-through can't log a perfect set
// by accident. Buttons run one under the floor to one over the top ("13+");
// "Other" opens a stepper for anything else. (Timed holds use the Timer
// step instead — see LoggedExerciseUI.)
function AmountInput({ target, value, onChange }: {
  target: Target | null
  value: number | null
  onChange: (v: number) => void
}) {
  const [manual, setManual] = useState(false)
  if (!target || manual) {
    return <Stepper value={value ?? target?.low ?? 0} onChange={onChange} />
  }
  const choices = repChoices(target)
  const top = choices[choices.length - 1]
  const inChoices = value != null && choices.includes(value)
  return (
    <View style={styles.chipGrid}>
      {choices.map((n) => {
        const selected = value === n
        return (
          <Pressable key={n} style={[styles.repChip, selected && styles.repChipSelected]} onPress={() => onChange(n)}>
            <Text style={[styles.repChipText, selected && styles.repChipTextSelected]}>{n === top ? `${n}+` : n}</Text>
          </Pressable>
        )
      })}
      <Pressable
        style={[styles.repChip, styles.repChipWide, value != null && !inChoices && styles.repChipSelected]}
        onPress={() => { setManual(true); if (value == null) onChange(target.low) }}
      >
        <Text style={[styles.repChipText, value != null && !inChoices && styles.repChipTextSelected]}>Other</Text>
      </Pressable>
    </View>
  )
}

// Effort in three words, optional; tapping the selected one clears it.
function EffortChips({ value, onChange }: { value: Effort | null; onChange: (v: Effort | null) => void }) {
  return (
    <View style={styles.chipGrid}>
      {EFFORTS.map((e) => {
        const selected = value === e
        return (
          <Pressable key={e} style={[styles.repChip, styles.effortChip, selected && styles.repChipSelected]} onPress={() => onChange(selected ? null : e)}>
            <Text style={[styles.repChipText, selected && styles.repChipTextSelected]}>{EFFORT_LABEL[e]}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

// The load, as a line ("20 kg" / "Bodyweight") that opens the stepper and
// the kg / lb switch only when tapped. Level mode shows the ladder instead.
function LoadControl({
  weight, setWeight, weightUnit, onWeightUnitChange, weightStep,
  levelChain, level, setLevel, suggestedLevelId, suggestionNote, suggestionDetail, prefix,
}: {
  weight: number; setWeight: (v: number) => void; weightUnit: WeightUnit; weightStep: number
  onWeightUnitChange: (u: WeightUnit) => void
  levelChain?: ResolvedChain   // present = level mode
  level?: LevelStep; setLevel?: (v: LevelStep) => void
  suggestedLevelId?: string
  suggestionNote?: string
  suggestionDetail?: string
  prefix?: string   // before the weight on the line ("Then 30 kg")
}) {
  const [editing, setEditing] = useState(false)
  return (
    <View style={{ width: "100%", gap: 12 }}>
      {!!suggestionNote && (
        <View style={styles.suggestionBanner}>
          <Text style={styles.suggestionBannerText}>{suggestionNote}</Text>
          {!!suggestionDetail && <Text style={styles.suggestionBannerDetail}>{suggestionDetail}</Text>}
        </View>
      )}
      {levelChain ? (
        <LevelPicker
          levelChain={levelChain} value={level?.exerciseId} suggested={suggestedLevelId}
          onChange={(v) => setLevel?.(v)}
        />
      ) : editing ? (
        <View style={styles.inputSection}>
          <View style={styles.weightLabelRow}>
            <Text style={styles.sectionLabel}>Weight</Text>
            <View style={styles.unitToggle}>
              {(["kg", "lb"] as WeightUnit[]).map((u) => (
                <Pressable
                  key={u}
                  style={[styles.unitChip, weightUnit === u && styles.unitChipSelected]}
                  onPress={() => { if (u !== weightUnit) setWeight(convertWeight(weight, weightUnit, u)); onWeightUnitChange(u) }}
                  hitSlop={6}
                >
                  <Text style={[styles.unitChipText, weightUnit === u && styles.unitChipTextSelected]}>{u}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <Stepper value={weight} onChange={setWeight} step={weightStep} suffix={` ${weightUnit}`} />
        </View>
      ) : (
        <Pressable style={styles.weightLine} onPress={() => setEditing(true)}>
          <Ionicons name="barbell-outline" size={18} color={C.textSecondary} />
          <Text style={styles.weightLineValue}>{weight > 0 ? `${prefix ? `${prefix} ` : ""}${weight} ${weightUnit}` : "Bodyweight"}</Text>
          <Text style={styles.linkText}>{weight > 0 ? "Change" : "Add weight"}</Text>
        </Pressable>
      )}
    </View>
  )
}

// ─── Easier-round banner ──────────────────────────────────────────────────────

// Shown at the top of an exercise when its previous round came in under the
// floor and this round was made one step easier (planRoundDrop). Undo puts
// the load back; a note-only drop (nothing to lower) has no Undo.
function RoundDropBanner({ drop, onUndo, onPickEasier }: { drop: RoundDrop; onUndo: () => void; onPickEasier?: () => void }) {
  return (
    <View style={[styles.roundDropBanner, drop.raise && styles.roundRaiseBanner]}>
      <View style={styles.roundDropTop}>
        <Ionicons name={drop.raise ? "arrow-up-circle" : "arrow-down-circle"} size={20} color={drop.raise ? C.green : C.yellow} />
        <Text style={styles.roundDropText}>{drop.note}</Text>
        {!!drop.undo && (
          <Pressable onPress={onUndo} hitSlop={8} style={styles.roundDropUndo}>
            <Text style={styles.roundDropUndoText}>Undo</Text>
          </Pressable>
        )}
      </View>
      {drop.pickEasier && !!onPickEasier && (
        <Pressable onPress={onPickEasier} style={styles.roundDropPick}>
          <Ionicons name="swap-horizontal" size={16} color={C.bg} />
          <Text style={styles.roundDropPickText}>Pick an easier exercise</Text>
        </Pressable>
      )}
    </View>
  )
}

// Shown while a block exercise is swapped for another one; Undo goes back.
function SwapBanner({ note, onUndo }: { note: string; onUndo: () => void }) {
  return (
    <View style={[styles.roundDropBanner, styles.swapBanner]}>
      <View style={styles.roundDropTop}>
        <Ionicons name="swap-horizontal" size={20} color={C.green} />
        <Text style={styles.roundDropText}>{note}</Text>
        <Pressable onPress={onUndo} hitSlop={8} style={styles.roundDropUndo}>
          <Text style={styles.roundDropUndoText}>Undo</Text>
        </Pressable>
      </View>
    </View>
  )
}

// The library exercises to swap to (utils/scSwap swapCandidates).
// "easier": offered when nothing on the prescribed exercise can be lowered —
// same movement pattern first, then the rest, never mobility. "choice": the
// athlete replaces it themselves — search + a pattern filter (starting on
// the exercise's own pattern) over the whole library. Either way the pick is
// used for the rest of this block only and the logs point back to the
// original.
function ExerciseSwapPicker({ visible, reason, original, current, planOption, library, onPick, onClose }: {
  visible: boolean
  reason: SwapReason
  original?: Exercise
  current?: LibraryExercise // already swapped in, if any
  planOption: boolean        // can also be changed for the rest of the plan
  library: LibraryExercise[] | null
  onPick: (row: LibraryExercise, scope: SwapScope) => void
  onClose: () => void
}) {
  const [scope, setScope] = useState<SwapScope>("session")
  const own = original && library ? findLibraryRow(original, library) : undefined
  const pattern = (own?.movementType ?? (original && original.type !== "7/3s" ? original.movementType : undefined)) as MovementType | undefined
  const [query, setQuery] = useState("")
  const [patternFilter, setPatternFilter] = useState<MovementType | null>(null)
  // Fresh search each time it opens, filtered to the exercise's own pattern.
  useEffect(() => {
    if (!visible) return
    setQuery("")
    setScope("session")
    setPatternFilter(reason === "choice" ? pattern ?? null : null)
  }, [visible, reason, pattern])

  const easier = reason === "easier"
  const exclude = [own?.$id, original?.exerciseId, current?.$id]
  const candidates = swapCandidates(library ?? [], exclude, pattern, easier ? {} : { query, movementType: patternFilter }, easier)
  // Patterns that have something to offer, for the filter chips.
  const patterns = MOVEMENT_TYPES.filter((m) => (library ?? []).some((row) => row.movementType === m && row.type !== "7/3s"))
  const row = (r: LibraryExercise) => (
    <Pressable key={r.$id} style={styles.pickerRow} onPress={() => onPick(r, planOption ? scope : "session")}>
      {r.photoUri ? (
        <Image source={{ uri: r.photoUri }} style={styles.exRowThumb} contentFit="cover" />
      ) : (
        <View style={[styles.exRowThumb, styles.exRowIcon]}>
          <Ionicons name={r.movementType === "mobility" ? "body-outline" : "barbell-outline"} size={20} color={C.green} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.pickerName} numberOfLines={2}>{r.name}</Text>
        {!!r.movementType && (
          <Text style={styles.pickerMeta} numberOfLines={1}>{MOVEMENT_TYPE_LABEL[r.movementType as MovementType] ?? r.movementType}</Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color={C.textMuted} />
    </Pressable>
  )
  const section = (title: string, rows: LibraryExercise[]) => rows.length > 0 && (
    <>
      <Text style={styles.pickerSection}>{title}</Text>
      {rows.map(row)}
    </>
  )
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.pickerBackdrop}>
        <View style={[styles.pickerSheet, !easier && styles.pickerSheetTall]}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>{easier ? "Pick an easier exercise" : "Change exercise"}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={C.textSecondary} />
            </Pressable>
          </View>
          {planOption && (
            <View style={styles.scopeRow}>
              {(["session", "plan"] as const).map((sc) => {
                const sel = scope === sc
                return (
                  <Pressable key={sc} style={[styles.scopeBtn, sel && styles.scopeBtnSelected]} onPress={() => setScope(sc)}>
                    <Text style={[styles.scopeText, sel && styles.scopeTextSelected]}>{sc === "session" ? "Today only" : "Rest of the plan"}</Text>
                  </Pressable>
                )
              })}
            </View>
          )}
          <Text style={styles.pickerHint}>
            {planOption && scope === "plan"
              ? `Replaces ${original?.name ?? "this exercise"} today and in every later workout of your plan.`
              : `Used instead of ${original?.name ?? "this exercise"} for the rest of this block, today only.`}
            {" "}Your coach will see the change.
          </Text>
          {!easier && library !== null && (
            <>
              <View style={styles.pickerSearch}>
                <Ionicons name="search" size={16} color={C.textMuted} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search exercises"
                  placeholderTextColor={C.textMuted}
                  style={styles.pickerSearchInput}
                  autoCorrect={false}
                />
                {!!query && (
                  <Pressable onPress={() => setQuery("")} hitSlop={10}>
                    <Ionicons name="close-circle" size={18} color={C.textMuted} />
                  </Pressable>
                )}
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickerChips} keyboardShouldPersistTaps="handled">
                {[null, ...patterns].map((m) => {
                  const sel = patternFilter === m
                  return (
                    <Pressable key={m ?? "all"} style={[styles.pickerChip, sel && styles.pickerChipSelected]} onPress={() => setPatternFilter(m)}>
                      <Text style={[styles.pickerChipText, sel && styles.pickerChipTextSelected]}>
                        {m ? MOVEMENT_TYPE_LABEL[m] : "All"}
                      </Text>
                    </Pressable>
                  )
                })}
              </ScrollView>
            </>
          )}
          <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
            {library === null ? (
              <Text style={styles.pickerHint}>{"Couldn't load the exercise library — check your connection."}</Text>
            ) : easier ? (
              <>
                {section(pattern ? `${MOVEMENT_TYPE_LABEL[pattern] ?? pattern} exercises` : "Exercises", candidates.filter((r) => !pattern || r.movementType === pattern))}
                {!!pattern && section("Other exercises", candidates.filter((r) => r.movementType !== pattern))}
              </>
            ) : candidates.length === 0 ? (
              <Text style={styles.pickerHint}>No exercises match.</Text>
            ) : (
              candidates.map(row)
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

// The pre-drop load to log on a round done at the easier load — only while
// the athlete is still on it (not undone, not changed by hand).
function adjustedFromFor(drop: RoundDrop | undefined, weight: number, level: LevelStep | undefined): ExerciseLog["adjustedFrom"] {
  if (!drop?.undo) return undefined
  if (drop.weight != null && weight === drop.weight) return { weight: String(drop.undo.weight) }
  if (drop.level && level?.exerciseId === drop.level.exerciseId) return { levelId: drop.undo.level?.exerciseId || undefined }
  return undefined
}

// ─── Exercise Photo (shown directly, not behind a tap) ────────────────────────

// The exercise's demo photo is the first thing on the screen — what to do
// matters most when an exercise comes up — so it renders as a full-bleed
// hero (4:3, cover-cropped, fading into the name below) whenever the
// exercise has one. Tapping still opens a larger view
// (useful for reading the coach's notes, if any, or zooming in), but seeing
// the photo itself no longer requires that tap.
function ExercisePhotoBanner({ photoUri, notes }: { photoUri?: string; notes?: string }) {
  // "sheet" = photo + coach's notes; "full" = photo alone, filling the screen
  // (pinch / double-tap to zoom, swipe down to close — see ZoomableImage). One Modal with swapped content rather than two
  // stacked Modals, which iOS doesn't present reliably.
  const [view, setView] = useState<"sheet" | "full" | null>(null)
  const close = () => setView(null)
  // The remote photo can take up to ~30s to fetch (no CDN in front of
  // Appwrite storage yet). Track load state so the banner shows progress
  // instead of sitting there as a flat, inert-looking box — otherwise it
  // reads as broken/empty rather than "still loading". Reset whenever the
  // uri changes (e.g. exercise swapped).
  const [imageLoading, setImageLoading] = useState(true)
  // Percent of bytes downloaded so far. Starts at 0/indeterminate — the
  // server doesn't report a content-length until the response headers
  // arrive, so we show a plain spinner until the first onProgress event
  // gives us something real to draw, then switch to an actual percentage.
  const [progress, setProgress] = useState(0)
  const [hasProgress, setHasProgress] = useState(false)
  useEffect(() => {
    setImageLoading(true)
    setProgress(0)
    setHasProgress(false)
  }, [photoUri])
  const { height: winHeight } = useWindowDimensions()
  if (!photoUri) return null

  // Compute explicit pixel caps instead of leaning on percentage-height +
  // flexShrink — ScrollView needs a real bounded height to know when to
  // start scrolling rather than growing to fit all of the notes text.
  const sheetMaxHeight = Math.round(winHeight * 0.75)
  const notesMaxHeight = Math.max(100, sheetMaxHeight - 220)
  // The hero: full width, 4:3, but never more than ~45% of the screen so
  // the inputs below stay in reach.
  const heroMaxHeight = Math.round(winHeight * 0.45)

  return (
    <>
      <Pressable
        // Nothing to read alongside the photo → skip the sheet and go straight
        // to fullscreen.
        onPress={() => setView(notes ? "sheet" : "full")}
        style={({ pressed }) => [styles.exercisePhotoBanner, { maxHeight: heroMaxHeight }, pressed && { opacity: 0.9 }]}
      >
        <Image
          source={{ uri: photoUri }}
          style={styles.exercisePhotoBannerImage}
          contentFit="cover"
          onLoadEnd={() => setImageLoading(false)}
          onProgress={({ loaded, total }) => {
            if (total > 0) {
              setHasProgress(true)
              setProgress(Math.round((loaded / total) * 100))
            }
          }}
        />
        {imageLoading && (
          <View style={styles.exercisePhotoBannerLoading}>
            {hasProgress ? (
              <AnimatedCircularProgress
                size={48}
                width={4}
                fill={progress}
                tintColor={C.green}
                backgroundColor={C.border}
                rotation={0}
              >
                {() => <Text style={styles.exercisePhotoProgressText}>{progress}%</Text>}
              </AnimatedCircularProgress>
            ) : (
              <ActivityIndicator size="small" color={C.textSecondary} />
            )}
          </View>
        )}
        <LinearGradient colors={["transparent", C.bg]} style={styles.exercisePhotoFade} pointerEvents="none" />
        <View style={[styles.exercisePhotoExpandBadge, styles.exercisePhotoExpandBadgeHero]}>
          <Ionicons name="expand" size={13} color={C.bg} />
        </View>
      </Pressable>
      <Modal visible={view !== null} transparent animationType="fade" onRequestClose={close}>
        {view === "full" ? (
          <View style={styles.exercisePhotoFullBackdrop}>
            <ZoomableImage
              uri={photoUri}
              onTap={() => (notes ? setView("sheet") : close())}
              onDismiss={close}
            />
            <Pressable style={styles.exercisePhotoCloseBtn} onPress={close} hitSlop={10}>
              <Ionicons name="close" size={22} color={C.textPrimary} />
            </Pressable>
          </View>
        ) : (
          <Pressable style={styles.exercisePhotoModalBackdrop} onPress={close}>
            <Pressable style={[styles.exerciseInfoSheet, { maxHeight: sheetMaxHeight }]} onPress={() => {}}>
              {/* contain, not cover — this is the "see the whole photo" view, so
                  letterboxing beats cropping content out when the aspect ratio
                  doesn't match the sheet. Tap it for fullscreen. */}
              <Pressable onPress={() => setView("full")}>
                <Image source={{ uri: photoUri }} style={styles.exerciseInfoSheetImage} contentFit="contain" />
                <View style={styles.exercisePhotoExpandBadge}>
                  <Ionicons name="expand" size={13} color={C.bg} />
                </View>
              </Pressable>
              {notes && (
                <ScrollView style={{ maxHeight: notesMaxHeight }} contentContainerStyle={styles.exerciseInfoNotesContent}>
                  <Text style={styles.exerciseInfoNotesText}>{notes}</Text>
                </ScrollView>
              )}
            </Pressable>
            <Pressable style={styles.exercisePhotoCloseBtn} onPress={close} hitSlop={10}>
              <Ionicons name="close" size={22} color={C.textPrimary} />
            </Pressable>
          </Pressable>
        )}
      </Modal>
    </>
  )
}

// ─── Exercise Notes (text-only fallback, no photo to show by default) ────────

// When there's no photo, there's nothing to show inline — coach's notes stay
// behind a plain "i" trigger next to the exercise name, same as before.
function ExerciseNotesIcon({ notes }: { notes?: string }) {
  const [expanded, setExpanded] = useState(false)
  const { height: winHeight } = useWindowDimensions()
  if (!notes) return null
  const sheetMaxHeight = Math.round(winHeight * 0.75)

  return (
    <>
      <Pressable
        onPress={() => setExpanded(true)}
        style={({ pressed }) => [styles.exerciseInfoIconWrap, pressed && { opacity: 0.7 }]}
      >
        <Ionicons name="information-circle-outline" size={26} color={C.textSecondary} />
      </Pressable>
      <Modal visible={expanded} transparent animationType="fade" onRequestClose={() => setExpanded(false)}>
        <Pressable style={styles.exercisePhotoModalBackdrop} onPress={() => setExpanded(false)}>
          <Pressable style={[styles.exerciseInfoSheet, { maxHeight: sheetMaxHeight }]} onPress={() => {}}>
            <ScrollView style={{ maxHeight: sheetMaxHeight }} contentContainerStyle={styles.exerciseInfoNotesContent}>
              <Text style={styles.exerciseInfoNotesText}>{notes}</Text>
            </ScrollView>
          </Pressable>
          <Pressable style={styles.exercisePhotoCloseBtn} onPress={() => setExpanded(false)} hitSlop={10}>
            <Ionicons name="close" size={22} color={C.textPrimary} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  )
}

// ─── Screen scaffolding (same look as Home / Plan) ───────────────────────────

// The app's main action button: 52 high, radius 16, as on LatestWorkoutCard.
// "secondary" is the quieter grey version (Skip rest).
function PillButton({ title, onPress, icon, variant = "primary", disabled }: {
  title: string
  onPress: () => void
  icon?: React.ComponentProps<typeof Ionicons>["name"]
  variant?: "primary" | "secondary"
  disabled?: boolean
}) {
  const primary = variant === "primary"
  const color = primary ? C.bg : C.textPrimary
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.pillBtn,
        !primary && styles.pillBtnSecondary,
        pressed && { opacity: 0.8 },
        disabled && { opacity: 0.4 },
      ]}
    >
      {!!icon && <Ionicons name={icon} size={18} color={color} />}
      <Text style={[styles.pillBtnText, { color }]}>{title}</Text>
    </Pressable>
  )
}

// Scrolling content with the action pinned below it, so Done is always in
// the same place no matter how long the exercise's content is.
// `background` sits behind everything (the both-sides glow — the footer goes
// transparent so it shows through); `overlay` covers the whole screen, button
// included (the switch card); changing `scrollKey` remounts the scroll so it
// starts at the top.
function ExerciseScreen({ children, footer, background, overlay, scrollKey }: {
  children: React.ReactNode; footer?: React.ReactNode; background?: React.ReactNode; overlay?: React.ReactNode; scrollKey?: string
}) {
  return (
    <View style={{ flex: 1 }}>
      {background}
      <ScrollView
        key={scrollKey}
        contentContainerStyle={styles.screenContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
      {!!footer && <View style={[styles.screenFooter, !!background && { backgroundColor: "transparent" }]}>{footer}</View>}
      {overlay}
    </View>
  )
}

// A lavender (C.side) glow coming in from the edge of the side being worked — left to
// right on the left side, right to left on the right. A background: render
// it before the content it sits behind. Timed both-sides holds only.
// Doesn't take touches.
const GLOW_STOPS = [0, 0.4, 0.8]
const GLOW_ALPHA = { normal: [0.16, 0.04, 0], strong: [0.35, 0.08, 0] }
const SIDE_RGB = "167,139,250"   // C.side

function SideGlow({ side, strong }: { side: Side; strong?: boolean }) {
  const from = { x: side === "left" ? 0 : 1, y: 0.5 }
  const to = { x: side === "left" ? 1 : 0, y: 0.5 }
  const alpha = strong ? GLOW_ALPHA.strong : GLOW_ALPHA.normal
  return (
    <LinearGradient
      colors={alpha.map((a) => `rgba(${SIDE_RGB},${a})`) as [string, string, string]}
      locations={GLOW_STOPS as [number, number, number]}
      start={from} end={to}
      style={styles.sideGlow}
      pointerEvents="none"
    />
  )
}

// Text on a both-sides screen sits on the side being worked: left on the
// left side, right on the right.
function sideAlign(side?: Side) {
  return side === "right" ? styles.alignRight : undefined
}

// The moment athletes used to miss: switching sides. A full-screen card for
// ~1.5 s (tap to skip), the glow already on the new side, so the change
// can't go unnoticed. First switch of the block only — later switches get
// the glow, the title and a haptic, without the wait.
function SwitchSidesCard({ side, onDone }: { side: Side; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start the timer once on mount; a new onDone each render must not restart it
  }, [])
  return (
    <Pressable style={styles.switchCard} onPress={onDone}>
      <SideGlow side={side} strong />
      <View style={{ gap: 10 }}>
        <Ionicons name={side === "left" ? "arrow-back" : "arrow-forward"} size={40} color={C.side} />
        <Text style={styles.switchCardKicker}>Switch sides</Text>
        <Text style={styles.switchCardTitle}>{side === "left" ? "Left side" : "Right side"}</Text>
      </View>
    </Pressable>
  )
}

// What to do, in one glance: the target paired with the trained quality —
// "● Max force · 3–6 reps" — so the athlete knows why this rep range.
function targetLine(ex: Exercise): { label?: string; color?: string; amount: string } {
  if (ex.type === "7/3s") return { amount: `7s hang · 3s rest × ${ex.series} · ${ex.edge}` }
  // A mobility hold typed as "30s" on a reps exercise reads as seconds.
  const timed = isTimedExercise(ex)
  const reps = timed && ex.unit !== "seconds" ? ex.reps.match(/\d+(\s*[-–]\s*\d+)?/)?.[0] ?? ex.reps : ex.reps
  const range = reps ? amountLabel(reps.replace(/\s*-\s*/, "–"), timed ? "seconds" : ex.unit) : ""
  const amount = ex.type === "both_sides" && range ? `${range} each side` : range
  if (ex.movementType === "mobility") return { label: "Mobility", color: C.textSecondary, amount }
  if (ex.focus) return { label: FOCUS_LABEL[ex.focus], color: FOCUS_COLOR[ex.focus], amount }
  return { amount }
}

// One exercise as a row (intro list, "Up next" on the rest screen): photo
// thumb (or an icon), name, and the same focus · target line as the header.
// With `onPress` it's the compact header on the Timer / Log steps: `name` is
// the level actually done, `load` the weight, and tapping goes to the brief.
// `side` "right" mirrors it (thumb and text on the right) to follow the side
// being worked.
function ExerciseRow({ exercise, name, load, onPress, side }: { exercise: Exercise; name?: string; load?: string; onPress?: () => void; side?: Side }) {
  const { label, color, amount } = targetLine(exercise)
  const icon = exercise.type === "7/3s" ? "hand-left-outline"
    : exercise.movementType === "mobility" ? "body-outline" : "barbell-outline"
  const mirror = side === "right"
  const align = mirror ? styles.alignRight : undefined
  return (
    <Pressable style={({ pressed }) => [styles.exRow, mirror && styles.rowReverse, pressed && { opacity: 0.8 }]} onPress={onPress} disabled={!onPress}>
      {exercise.photoUri ? (
        <Image source={{ uri: exercise.photoUri }} style={styles.exRowThumb} contentFit="cover" />
      ) : (
        <View style={[styles.exRowThumb, styles.exRowIcon]}>
          <Ionicons name={icon} size={20} color={C.green} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[styles.exRowName, align]} numberOfLines={2}>{name ?? exercise.name}</Text>
        <View style={[styles.exTargetRow, mirror && styles.rowReverse]}>
          {!!label && <View style={[styles.exFocusDot, { backgroundColor: color }]} />}
          <Text style={[styles.exRowDetail, align]} numberOfLines={1}>
            {!!label && <Text style={{ color }}>{label}</Text>}
            {!!label && !!amount ? " · " : ""}
            {amount}
          </Text>
        </View>
        {!!load && <Text style={[styles.exRowLoad, align]}>{load}</Text>}
      </View>
      {!!onPress && <Ionicons name={mirror ? "chevron-back" : "chevron-forward"} size={18} color={C.textSecondary} />}
    </Pressable>
  )
}

// 90 → "1:30", 60 → "1 min", 45 → "45 s".
function formatRest(secs: number): string {
  if (secs < 60) return `${secs} s`
  const m = Math.floor(secs / 60)
  const r = secs % 60
  return r ? `${m}:${String(r).padStart(2, "0")}` : `${m} min`
}

// Kicker + name + target line, sitting right under the photo (overlapping
// its fade) so photo and name read as one thing.
function ExerciseHeader({ name, exercise }: { name: string; exercise: Exercise }) {
  const { label, color, amount } = targetLine(exercise)
  return (
    <View style={[styles.exHeader, !exercise.photoUri && { marginTop: 16 }]}>
      <View style={styles.exNameRow}>
        <Text style={styles.exName}>
          {name}
        </Text>
        <ExerciseNotesIcon notes={exercise.notes} />
      </View>
      {(!!label || !!amount) && (
        <View style={styles.exTargetRow}>
          {!!label && <View style={[styles.exFocusDot, { backgroundColor: color }]} />}
          {!!label && <Text style={[styles.exFocusLabel, { color }]}>{label}</Text>}
          {!!label && !!amount && <Text style={styles.exTargetSep}>·</Text>}
          {!!amount && <Text style={styles.exTargetAmount}>{amount}</Text>}
        </View>
      )}
    </View>
  )
}

// ─── Reps / both-sides exercise: Brief → (Timer) → Log ───────────────────────
// docs/sc-block-ux.md Phase 7. The athlete reads the exercise, puts the
// phone down, trains, comes back and reports — so the screen is split by
// before vs after:
// - Brief: what to do (photo, focus cue) and everything that sets the load
//   (weight / level, suggestion, easier-round and swap banners).
// - Timer: timed exercises only; both-sides runs left → right here.
// - Log: what happened — reps (or seconds) per side, one effort, Done.

type Side = "left" | "right"
// Edge Lifts with a max, round 1: brief → warmup ⇄ warmupRest (× 4) → timer.
type Step = "brief" | "warmup" | "warmupRest" | "timer" | "log"

interface LoggedExerciseUIProps {
  exercise: RepExercise | BothSidesExercise
  levelChain?: ResolvedChain
  weightUnit: WeightUnit
  onWeightUnitChange: (u: WeightUnit) => void
  initialWeight?: string
  initialLevel?: LevelStep
  suggestionNote?: string
  suggestionDetail?: string   // what the note is based on
  roundDrop?: RoundDrop
  onPickEasier?: () => void
  onChangeExercise?: () => void // replace it with any library exercise (this session only)
  swapNote?: string        // set while swapped for another exercise
  onUndoSwap?: () => void
  setting?: ExerciseSetting  // adjustable setting: the coach's hints
  initialHardest?: boolean   // the "hardest setting" switch to start on
  startOnBrief: boolean    // false in round 2+ unless something changed
  warmup?: WarmupSet[]     // Edge Lifts, round 1: the warm-up holds before it
  noMax?: boolean          // Edge Lifts, round 1, and the athlete has no max yet
  showSwitchCard: boolean  // timed both-sides: first switch of the block only
  onSwitchCardShown: () => void
  onDone: (log: Omit<ExerciseLog, "round">) => void
}

function LoggedExerciseUI({
  exercise, levelChain, weightUnit, onWeightUnitChange, initialWeight, initialLevel, suggestionNote, suggestionDetail,
  roundDrop, onPickEasier, onChangeExercise, swapNote, onUndoSwap, setting, initialHardest, startOnBrief, warmup, noMax, showSwitchCard, onSwitchCardShown, onDone,
}: LoggedExerciseUIProps) {
  const sides = exercise.type === "both_sides"
  const isTimed = exercise.unit === "seconds"
  const isLevelMode = !!levelChain
  const target = targetFor(exercise.focus, exercise.reps, isTimed ? "seconds" : "reps")
  const timerTarget = targetNumber(exercise.reps)
  const startWeight = parseFloat(initialWeight ?? "") || 0
  // With no suggested level (no history yet), start on the prescribed step.
  const startLevel = initialLevel ?? (levelChain ? levelChain.chain[levelChain.prescribedIdx] : undefined)
  const weightStep = 0.5

  const [step, setStep] = useState<Step>(startOnBrief ? "brief" : isTimed ? "timer" : "log")
  // One load for the exercise (both sides included) — it's set before lifting.
  const [weight, setWeight] = useState<number>(startWeight)
  const [level, setLevel] = useState<LevelStep | undefined>(startLevel)
  const [effort, setEffort] = useState<Effort | null>(null)
  // Set on the brief, like the load: the app can't measure the setting, so
  // the athlete says when they're on the hardest one.
  const [hardest, setHardest] = useState(!!initialHardest)
  // Reps / seconds per side; one-sided exercises use `left` only. Nothing is
  // preselected — Done waits for a pick (see AmountInput).
  const [amounts, setAmounts] = useState<Record<Side, number | null>>({ left: null, right: null })
  const setAmount = (s: Side) => (v: number) => setAmounts((prev) => ({ ...prev, [s]: v }))
  // Timer step, both-sides: whose hold is up, and the switch card.
  const [timerSide, setTimerSide] = useState<Side>("left")
  const [switching, setSwitching] = useState(false)
  // Warm-up: which hold is up (or which one the rest leads to), and whether
  // it's all done (a note on the first set).
  const [warmIdx, setWarmIdx] = useState(0)
  const [warmSide, setWarmSide] = useState<Side>("left")   // both sides: left, then right
  const [warmedUp, setWarmedUp] = useState(false)
  const hasWarmup = !!warmup && warmup.length > 0
  const firstSetStep: Step = isTimed ? "timer" : "log"

  const [dropUndone, setDropUndone] = useState(false)
  const activeDrop = roundDrop && !dropUndone ? roundDrop : undefined
  function undoDrop() {
    if (roundDrop?.undo?.weight != null) setWeight(roundDrop.undo.weight)
    if (roundDrop?.undo?.level) setLevel(roundDrop.undo.level)
    setDropUndone(true)
  }
  // The suggestion note describes a specific proposed change — once the
  // athlete picks something else, showing it would misdescribe what's
  // actually selected, so it disappears (the suggested chip/value stays
  // marked separately so they can still see and return to it).
  const stillMatchesSuggestion = isLevelMode ? level?.exerciseId === startLevel?.exerciseId : weight === startWeight
  const activeSuggestionNote = stillMatchesSuggestion ? suggestionNote : undefined

  // The displayed/logged identity — once in level mode, this exercise IS
  // whichever level is selected, not the container it was authored under.
  const displayName = isLevelMode && level ? level.name : exercise.name
  const loadLabel = !isLevelMode && weight > 0 ? `${weight} ${weightUnit}` : undefined
  const logSides: Side[] = sides ? ["left", "right"] : ["left"]
  const complete = logSides.every((s) => amounts[s] != null)

  function handleSave() {
    if (!complete) return
    const rpe = effort ? String(effortToRpe(effort, exercise.focus)) : undefined
    const w = !isLevelMode && weight > 0 ? String(weight) : undefined
    const base = {
      exerciseIndex: 0,
      exerciseName: displayName,
      weightUnit,
      // "" = an id-less fallback step; log it as no id so name matching works.
      levelId: isLevelMode ? level?.exerciseId || undefined : undefined,
      effort: effort ?? undefined,
      adjustedFrom: adjustedFromFor(activeDrop, weight, level),
      ...(setting ? { atHardestSetting: hardest } : {}),
    }
    onDone(sides
      // Both sides share the load and the effort (readRound takes the weaker
      // side's reps and the harder side's RPE, so this judges the same).
      ? { ...base, repsLeft: String(amounts.left), repsRight: String(amounts.right), weightLeft: w, weightRight: w, rpeLeft: rpe, rpeRight: rpe }
      : { ...base, repsCompleted: String(amounts.left), weight: w, rpe })
  }

  // Timer + Log: the exercise as one tappable row (→ back to the brief).
  // Both-sides timer: it follows the side being worked.
  const header = (
    <View style={{ marginTop: 16 }}>
      <ExerciseRow
        exercise={exercise} name={displayName} load={loadLabel} onPress={() => setStep("brief")}
        side={sides && step === "timer" ? timerSide : undefined}
      />
    </View>
  )

  // ── Brief ──
  if (step === "brief") {
    return (
      <ExerciseScreen
        scrollKey="brief"
        footer={hasWarmup && !warmedUp
          ? <PillButton title="Start warm-up" icon="timer-outline" onPress={() => { setWarmIdx(0); setStep("warmup") }} />
          : <PillButton title={isTimed ? "Start timer" : "Log reps"} icon={isTimed ? "timer-outline" : "arrow-forward"} onPress={() => setStep(firstSetStep)} />}
      >
        <ExercisePhotoBanner photoUri={exercise.photoUri} notes={exercise.notes} />
        <ExerciseHeader name={displayName} exercise={exercise} />
        {hasWarmup && !warmedUp ? <WarmupList sets={warmup!} unit={weightUnit} /> : <FocusCue exercise={exercise} />}
        {!!noMax && (
          <View style={styles.noMaxCard}>
            <Text style={styles.noMaxTitle}>No max yet</Text>
            <Text style={styles.noMaxText}>Warm up by feel today. Your coach will set up a test.</Text>
          </View>
        )}
        {!!activeDrop && <RoundDropBanner drop={activeDrop} onUndo={undoDrop} onPickEasier={onPickEasier} />}
        {!!swapNote && !!onUndoSwap && <SwapBanner note={swapNote} onUndo={onUndoSwap} />}
        <LoadControl
          weight={weight} setWeight={setWeight} weightUnit={weightUnit} onWeightUnitChange={onWeightUnitChange} weightStep={weightStep}
          levelChain={levelChain} level={level} setLevel={setLevel}
          suggestedLevelId={initialLevel?.exerciseId}
          suggestionNote={activeSuggestionNote}
          suggestionDetail={activeSuggestionNote ? suggestionDetail : undefined}
          prefix={hasWarmup && !warmedUp ? "Then" : undefined}
        />
        {!!setting && <SettingCard setting={setting} hardest={hardest} onChange={setHardest} />}
        {!!onChangeExercise && <ChangeExerciseLink onPress={onChangeExercise} />}
      </ExerciseScreen>
    )
  }

  // ── Warm-up hold ──
  if (step === "warmup" && hasWarmup) {
    const set = warmup![warmIdx]
    // Both sides: the left hold, then the right one, then the rest.
    const holdDone = () => {
      if (sides && warmSide === "left") {
        setWarmSide("right")
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
      } else {
        setWarmSide("left")
        setStep("warmupRest")
      }
    }
    return (
      <ExerciseScreen
        background={sides ? <SideGlow side={warmSide} /> : undefined}
        scrollKey={`warmup-${warmIdx}-${warmSide}`}
        footer={<PillButton title="Finish the hold first" icon="arrow-forward" onPress={() => {}} disabled />}
      >
        {header}
        <View style={[{ gap: 4 }, sideAlign(sides ? warmSide : undefined)]}>
          <Text style={[styles.sectionLabel, { color: C.yellow }, sideAlign(sides ? warmSide : undefined)]}>Warm-up {warmIdx + 1} of {warmup!.length}</Text>
          <Text style={[styles.timedBig, { color: C.textPrimary }, sideAlign(sides ? warmSide : undefined)]}>
            {set.weight}<Text style={styles.timedBigUnit}> {weightUnit}</Text>
          </Text>
        </View>
        {sides && <Text style={[styles.timerSideTitle, sideAlign(warmSide)]}>{warmSide === "left" ? "Left side" : "Right side"}</Text>}
        <TimedAmountControl key={`${warmIdx}-${warmSide}`} target={set.secs} fixed onChange={holdDone} />
      </ExerciseScreen>
    )
  }

  // ── Rest after a warm-up hold ──
  if (step === "warmupRest" && hasWarmup) {
    const last = warmIdx === warmup!.length - 1
    const next = last ? undefined : warmup![warmIdx + 1]
    const done = () => {
      if (last) {
        setWarmedUp(true)
        setStep(firstSetStep)
      } else {
        setWarmIdx((i) => i + 1)
        setStep("warmup")
      }
    }
    return (
      <WarmupRest
        key={warmIdx}
        secs={last ? EDGE_WARMUP.lastRestSecs : EDGE_WARMUP.restSecs}
        title={last ? "Main set next" : `Warm-up ${warmIdx + 2} of ${warmup!.length} next`}
        upNext={<ExerciseRow
          exercise={exercise}
          name={last ? displayName : `${displayName} · warm-up ${warmIdx + 2}`}
          load={last ? loadLabel : `${next!.weight} ${weightUnit} · ${next!.secs} s`}
        />}
        onDone={done}
      />
    )
  }

  // ── Timer (timed only) ──
  if (step === "timer") {
    const side = timerSide
    const holdDone = amounts[side] != null
    const toRight = sides && side === "left"
    function switchToRight() {
      setTimerSide("right")
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
      if (showSwitchCard) {
        setSwitching(true)
        onSwitchCardShown()
      }
    }
    // Skip the timer: steppers on Log, starting at the target's low end.
    function enterManually() {
      const start = target?.low ?? timerTarget
      setAmounts((prev) => ({ left: prev.left ?? start, right: sides ? prev.right ?? start : null }))
      setStep("log")
    }
    return (
      <ExerciseScreen
        background={sides ? <SideGlow side={side} /> : undefined}
        overlay={switching ? <SwitchSidesCard side={side} onDone={() => setSwitching(false)} /> : undefined}
        scrollKey={`timer-${side}`}
        footer={<PillButton
          title={!holdDone ? "Finish the hold first" : toRight ? "Switch to right side" : "Log it"}
          icon="arrow-forward"
          onPress={toRight ? switchToRight : () => setStep("log")}
          disabled={!holdDone}
        />}
      >
        {header}
        {warmedUp && <WarmedUpNote />}
        <View style={styles.inputSection}>
          {sides
            ? <Text style={[styles.timerSideTitle, sideAlign(side)]}>{side === "left" ? "Left side" : "Right side"}</Text>
            : <Text style={styles.sectionLabel}>Hold timer</Text>}
          <TimedAmountControl key={side} target={timerTarget} onChange={setAmount(side)} />
          <Pressable onPress={enterManually} hitSlop={6}>
            <Text style={styles.linkText}>Enter seconds instead</Text>
          </Pressable>
        </View>
      </ExerciseScreen>
    )
  }

  // ── Log ──
  const lockedTitle = sides ? "Pick both sides first" : isTimed ? "Log the seconds first" : "Pick your reps first"
  return (
    <ExerciseScreen
      scrollKey="log"
      footer={<PillButton title={complete ? "Done" : lockedTitle} icon="checkmark" onPress={handleSave} disabled={!complete} />}
    >
      {header}
      {warmedUp && !isTimed && <WarmedUpNote />}
      {logSides.map((s) => (
        <View key={s} style={styles.inputSection}>
          <Text style={styles.sectionLabel}>
            {sides ? (s === "left" ? "Left side" : "Right side") : isTimed ? "Seconds held" : "How many reps?"}
          </Text>
          {isTimed
            ? <Stepper value={amounts[s] ?? target?.low ?? timerTarget} onChange={setAmount(s)} suffix=" s" />
            : <AmountInput target={target} value={amounts[s]} onChange={setAmount(s)} />}
        </View>
      ))}
      {!isLevelMode && (
        <View style={styles.inputSection}>
          <Text style={styles.sectionLabel}>How did it feel? (optional)</Text>
          <EffortChips value={effort} onChange={setEffort} />
        </View>
      )}
    </ExerciseScreen>
  )
}

// ─── Edge Lifts warm-up and max test (utils/edgeWarmup.ts) ────────────────────

// The athlete's max from their `users` row (kg; null = none yet), kept on
// the device too; when the row can't be read, the device's copy
// (undefined = no copy either).
async function readEdgeMax(userId: string): Promise<number | null | undefined> {
  const me = await withTimeout(getUsers(userId), PREFILL_TIMEOUT_MS).catch(() => null)
  if (!me) return loadCachedEdgeMax(userId)
  const max = currentMax(me as any)
  saveCachedEdgeMax(userId, max)
  return max
}

// The brief's warm-up: one line per hold, weight and seconds only.
function WarmupList({ sets, unit }: { sets: WarmupSet[]; unit: WeightUnit }) {
  return (
    <View style={styles.inputSection}>
      <Text style={styles.sectionLabel}>Warm-up first</Text>
      <View style={{ gap: 6 }}>
        {sets.map((s, i) => (
          <View key={i} style={styles.warmupRow}>
            <Text style={styles.warmupRowNum}>{i + 1}</Text>
            <Text style={styles.warmupRowWeight}>{s.weight} {unit}</Text>
            <Text style={styles.warmupRowSecs}>{s.secs} s</Text>
          </View>
        ))}
      </View>
      <Text style={styles.warmupRowNote}>{formatRest(EDGE_WARMUP.restSecs)} rest between sets</Text>
    </View>
  )
}

// Rest after a warm-up hold: the same ring as the rest between rounds. Goes
// on by itself when it runs out.
function WarmupRest({ secs, title, upNext, onDone }: { secs: number; title: string; upNext: React.ReactNode; onDone: () => void }) {
  const [remaining, setRemaining] = useState(secs)
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  useEffect(() => {
    const end = Date.now() + secs * 1000
    const id = setInterval(() => {
      const r = Math.max(0, Math.ceil((end - Date.now()) / 1000))
      setRemaining(r)
      if (r <= 0) {
        clearInterval(id)
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
        doneRef.current()
      }
    }, 200)
    return () => clearInterval(id)
  }, [secs])
  const urgent = remaining <= 10
  return (
    <ExerciseScreen
      scrollKey="warmup-rest"
      footer={<PillButton title="Skip rest" icon="play-skip-forward" variant="secondary" onPress={onDone} />}
    >
      <View style={{ gap: 4, marginTop: 16 }}>
        <Text style={styles.exKicker}>Rest</Text>
        <Text style={styles.introTitle}>{title}</Text>
      </View>
      <View style={styles.restCircle}>
        <AnimatedCircularProgress
          size={220} width={10} fill={(remaining / secs) * 100}
          tintColor={urgent ? C.red : C.green} backgroundColor={C.surface} rotation={0}
        >
          {() => <Text style={[styles.restTimerText, { fontSize: 56 }]}>{`${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`}</Text>}
        </AnimatedCircularProgress>
      </View>
      <Text style={styles.sectionLabel}>Up next</Text>
      {upNext}
    </ExerciseScreen>
  )
}

function WarmedUpNote() {
  return (
    <View style={styles.suggestionBanner}>
      <Text style={styles.suggestionBannerText}>Warm-up done</Text>
    </View>
  )
}

// The max test (homework the coach sends, done together): each try runs on
// the usual hold timer (fixed to the test's length; "Redo hold" for the
// next try), then the athlete logs the heaviest weight held and it becomes
// their max.
function MaxTestUI({ exercise, userId, currentMaxKg, weightUnit, onSaved, onDone }: {
  exercise: RepExercise | BothSidesExercise
  userId?: string
  currentMaxKg: number | null | undefined
  weightUnit: WeightUnit
  onSaved: (kg: number) => void
  onDone: (log: Omit<ExerciseLog, "round">) => void
}) {
  const start = currentMaxKg ? convertWeight(currentMaxKg, "kg", weightUnit) : 0
  const [weight, setWeight] = useState(start)
  const [saving, setSaving] = useState(false)
  const secs = EDGE_WARMUP.testHoldSecs
  function finish() {
    onDone({ exerciseIndex: 0, exerciseName: exercise.name, repsCompleted: String(secs), weight: String(weight), weightUnit })
  }
  async function save() {
    if (!(weight > 0) || !userId) return
    const kg = weightUnit === "kg" ? weight : convertWeight(weight, "lb", "kg")
    setSaving(true)
    try {
      await setEdgeLiftMax(userId, kg, "test")
      onSaved(kg)
      finish()
    } catch (e: any) {
      setSaving(false)
      Alert.alert("Max not saved", `${e?.message ?? "Couldn't reach the server."} Tell your coach: ${weight} ${weightUnit}.`, [
        { text: "Try again", onPress: () => { void save() } },
        { text: "Continue", style: "cancel", onPress: finish },
      ])
    }
  }
  return (
    <ExerciseScreen
      scrollKey="max-test"
      footer={<PillButton title={saving ? "Saving…" : weight > 0 ? "Save max" : "Enter the weight first"} icon="checkmark" onPress={save} disabled={saving || !(weight > 0)} />}
    >
      <View style={{ marginTop: 16 }}>
        <ExerciseRow exercise={exercise} name={`${exercise.name} · max test`} />
      </View>
      <View style={styles.inputSection}>
        <Text style={styles.sectionLabel}>Hold timer</Text>
        <TimedAmountControl target={secs} fixed onChange={() => {}} />
      </View>
      <View style={styles.inputSection}>
        <Text style={styles.sectionLabel}>Heaviest weight held {secs} s</Text>
        <Stepper value={weight} onChange={setWeight} step={DEFAULT_LOAD_STEP[weightUnit]} suffix={` ${weightUnit}`} />
        {!!currentMaxKg && <Text style={styles.warmupRowNote}>Last max: {start} {weightUnit}</Text>}
      </View>
    </ExerciseScreen>
  )
}

// The exercise's adjustable setting on the brief: the coach's hints and the
// athlete's own call on whether they're at the hardest one. Progression
// only moves past the setting once that switch is on (scNext.planNext).
function SettingCard({ setting, hardest, onChange }: { setting: ExerciseSetting; hardest: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.settingCard}>
      <Text style={styles.sectionLabel}>Exercise setup</Text>
      {!!setting.harder && (
        <Text style={styles.settingHint}><Text style={styles.settingHintLabel}>Harder  </Text>{setting.harder}</Text>
      )}
      {!!setting.easier && (
        <Text style={styles.settingHint}><Text style={styles.settingHintLabel}>Easier  </Text>{setting.easier}</Text>
      )}
      <Pressable style={styles.settingSwitchRow} onPress={() => onChange(!hardest)}>
        <Text style={styles.settingSwitchText}>{"I'm on the hardest setup"}</Text>
        <Switch
          value={hardest}
          onValueChange={onChange}
          trackColor={{ false: C.surfaceHigh, true: C.green }}
          thumbColor={C.textPrimary}
        />
      </Pressable>
    </View>
  )
}

// "Change exercise": opens the swap picker (any library exercise, this
// session only). Low-key — the default is doing what the coach set.
function ChangeExerciseLink({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={styles.changeExercise}>
      <Ionicons name="swap-horizontal" size={16} color={C.textSecondary} />
      <Text style={styles.changeExerciseText}>Change exercise</Text>
    </Pressable>
  )
}

// The brief's "what this focus means right now" line, under the target.
function FocusCue({ exercise }: { exercise: Exercise }) {
  if (exercise.type === "7/3s" || exercise.movementType === "mobility" || !exercise.focus) return null
  return (
    <Text style={[styles.focusCue, { borderLeftColor: FOCUS_COLOR[exercise.focus] }]}>
      {FOCUS_CUE[exercise.focus]}
    </Text>
  )
}

// ─── Mobility Exercise UI ─────────────────────────────────────────────────────

// Mobility doesn't progress: no weight, RPE, level or suggestions — the
// athlete does the target and taps Done. Timed ones (isTimedExercise) keep
// everything on one screen: photo, details and the hold timer under them
// (5 s get-ready, beeps on the last 3 s and at the end — the same
// TimedAmountControl as other timed exercises). Both-sides holds run left →
// right on the same screen. Done logs the seconds held, or the target when
// the timer wasn't used.
function MobilityExerciseUI({ exercise, showSwitchCard, onSwitchCardShown, onChangeExercise, swapNote, onUndoSwap, onDone }: {
  exercise: RepExercise | BothSidesExercise
  showSwitchCard: boolean
  onSwitchCardShown: () => void
  onChangeExercise?: () => void
  swapNote?: string
  onUndoSwap?: () => void
  onDone: (log: Omit<ExerciseLog, "round">) => void
}) {
  const isTimed = isTimedExercise(exercise)
  const sides = exercise.type === "both_sides"
  const target = targetNumber(exercise.reps)
  const [held, setHeld] = useState<Record<Side, number | null>>({ left: null, right: null })
  const [timerSide, setTimerSide] = useState<Side>("left")
  const [switching, setSwitching] = useState(false)

  function handleSave() {
    const base = { exerciseIndex: 0, exerciseName: exercise.name }
    if (!isTimed) return onDone({ ...base, repsCompleted: exercise.reps || undefined })
    const secs = (s: Side) => String(held[s] ?? target)
    onDone(sides ? { ...base, repsLeft: secs("left"), repsRight: secs("right") } : { ...base, repsCompleted: secs("left") })
  }

  const side = timerSide
  // Both sides: once the left hold is done, the button moves to the right side.
  const toRight = isTimed && sides && side === "left" && held.left != null
  function switchToRight() {
    setTimerSide("right")
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
    if (showSwitchCard) {
      setSwitching(true)
      onSwitchCardShown()
    }
  }
  return (
    <ExerciseScreen
      background={isTimed && sides && side === "right" ? <SideGlow side={side} /> : undefined}
      overlay={switching ? <SwitchSidesCard side={side} onDone={() => setSwitching(false)} /> : undefined}
      footer={toRight
        ? <PillButton title="Switch to right side" icon="arrow-forward" onPress={switchToRight} />
        : <PillButton title="Done" icon="checkmark" onPress={handleSave} />}
    >
      <ExercisePhotoBanner photoUri={exercise.photoUri} notes={exercise.notes} />
      <ExerciseHeader name={exercise.name} exercise={exercise} />
      {!!swapNote && !!onUndoSwap && <SwapBanner note={swapNote} onUndo={onUndoSwap} />}
      {isTimed && (
        <View style={styles.inputSection}>
          {sides
            ? <Text style={[styles.timerSideTitle, sideAlign(side)]}>{side === "left" ? "Left side" : "Right side"}</Text>
            : <Text style={styles.sectionLabel}>Hold timer</Text>}
          <TimedAmountControl key={side} target={target} onChange={(v) => setHeld((prev) => ({ ...prev, [side]: v }))} />
        </View>
      )}
      {!!onChangeExercise && <ChangeExerciseLink onPress={onChangeExercise} />}
    </ExerciseScreen>
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
  const [effort, setEffort] = useState<Effort | null>(null)
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

  // The running countdown: when it ends and what runs next. Kept in refs so
  // pause can stash the time left and resume can pick the same step back up.
  const endRef = useRef(0)
  const stepDoneRef = useRef<() => void>(() => {})
  const pausedMsRef = useRef(0)
  const [paused, setPaused] = useState(false)

  function tick() {
    if (timerRef.current !== null) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      const remaining = Math.ceil((endRef.current - Date.now()) / 1000)
      if (remaining <= 0) {
        clearInterval(timerRef.current!)
        timerRef.current = null
        setTimeRemaining(0)
        stepDoneRef.current()
      } else {
        setTimeRemaining(remaining)
      }
    }, 100)
  }

  function startTimer(duration: number, onDone: () => void) {
    endRef.current = Date.now() + duration * 1000
    stepDoneRef.current = onDone
    setTimeRemaining(duration)
    tick()
  }

  function pause() {
    if (timerRef.current !== null) clearInterval(timerRef.current)
    timerRef.current = null
    pausedMsRef.current = Math.max(0, endRef.current - Date.now())
    setPaused(true)
  }

  function resume() {
    endRef.current = Date.now() + pausedMsRef.current
    setPaused(false)
    tick()
  }

  const pauseButton = (
    <Pressable style={styles.pauseBtn} onPress={paused ? resume : pause} hitSlop={8}>
      <Ionicons name={paused ? "play" : "pause"} size={20} color={C.textPrimary} />
      <Text style={styles.pauseBtnText}>{paused ? "Resume" : "Pause"}</Text>
    </Pressable>
  )

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
      rpe: effort ? String(effortToRpe(effort)) : undefined,
      effort: effort ?? undefined,
    })
  }

  const fillPercent =
    innerPhase === "hanging"
      ? ((timeRemaining ?? 0) / 7) * 100
      : ((timeRemaining ?? 0) / 3) * 100

  if (innerPhase === "ready") {
    return (
      <ExerciseScreen footer={<PillButton title="Start" icon="play" onPress={handleStart} />}>
        <ExercisePhotoBanner photoUri={exercise.photoUri} notes={exercise.notes} />
        <ExerciseHeader name={exercise.name || "7/3s"} exercise={exercise} />
      </ExerciseScreen>
    )
  }

  if (innerPhase === "prepare") {
    return (
      <ExerciseScreen>
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
                <Text style={styles.hangRestLabel}>{paused ? "PAUSED" : "PREPARE"}</Text>
                <Text style={styles.timerText}>{timeRemaining}s</Text>
              </>
            )}
          </AnimatedCircularProgress>
          {pauseButton}
        </View>
      </ExerciseScreen>
    )
  }

  if (innerPhase === "hanging" || innerPhase === "resting") {
    return (
      <ExerciseScreen>
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
                  {paused ? "PAUSED" : innerPhase === "hanging" ? "HANG" : "REST"}
                </Text>
                <Text style={styles.timerText}>{timeRemaining}s</Text>
              </>
            )}
          </AnimatedCircularProgress>
          {pauseButton}
        </View>
      </ExerciseScreen>
    )
  }

  if (innerPhase === "done") {
    return (
      <ExerciseScreen footer={<PillButton title="Done" icon="checkmark" onPress={handleFinish} />}>
        <View style={[styles.introHead, { marginTop: 8 }]}>
          <Text style={styles.introTitle}>7/3s complete</Text>
          <Text style={styles.introMeta}>{seriesDone} of {exercise.series} series · {exercise.edge}</Text>
        </View>
        <View style={styles.inputSection}>
          <Text style={styles.sectionLabel}>How did it feel? (optional)</Text>
          <EffortChips value={effort} onChange={setEffort} />
        </View>
      </ExerciseScreen>
    )
  }

  return null
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  introContent: { flexGrow: 1, padding: 20, gap: 16 },
  // Full-bleed hero: negative margins cancel the introContent padding; capped
  // height + cover crops it so it doesn't dominate the screen.
  hero: { marginTop: -20, marginHorizontal: -20, marginBottom: -8, height: 240 },
  heroImg: { width: "100%", height: "100%" },
  heroFade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 110 },
  description: { fontSize: 15, color: C.textSecondary, lineHeight: 22 },

  // Shared type scale / layout with Home & Plan (LatestWorkoutCard)
  screenContent: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 24, gap: 16 },
  screenFooter: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20, backgroundColor: C.bg },
  pillBtn: {
    height: 52, borderRadius: 16, backgroundColor: C.green,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
  },
  pillBtnSecondary: { backgroundColor: C.surfaceHigh },
  switchCard: {
    ...StyleSheet.absoluteFillObject, backgroundColor: C.bg, zIndex: 10,
    justifyContent: "center", paddingHorizontal: 28,
  },
  sideGlow: { ...StyleSheet.absoluteFillObject },
  switchCardKicker: { fontSize: 13, fontWeight: "700", color: C.side, textTransform: "uppercase", letterSpacing: 0.8 },
  switchCardTitle: { fontSize: 44, fontWeight: "800", color: C.textPrimary, letterSpacing: -1 },
  pillBtnText: { fontSize: 16, fontWeight: "800" },
  progressTrack: { height: 3, backgroundColor: C.surface },
  progressFill: { height: 3, backgroundColor: C.green, borderTopRightRadius: 2, borderBottomRightRadius: 2 },

  introHead: { gap: 4 },
  introTitle: { fontSize: 28, fontWeight: "800", color: C.textPrimary, letterSpacing: -0.5 },
  introMeta: { fontSize: 13, color: C.textSecondary },
  exList: { gap: 10 },
  exRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: C.surfaceHigh, borderRadius: 14, padding: 10,
  },
  exRowThumb: { width: 52, height: 52, borderRadius: 10, backgroundColor: C.surface },
  exRowIcon: { alignItems: "center", justifyContent: "center", backgroundColor: "rgba(111,207,151,0.12)" },
  exRowName: { fontSize: 15, fontWeight: "600", color: C.textPrimary },
  exRowDetail: { flexShrink: 1, fontSize: 12.5, color: C.textSecondary },
  exRowLoad: { fontSize: 13, fontWeight: "700", color: C.textPrimary, marginTop: 2 },
  focusCue: { fontSize: 15, lineHeight: 21, color: C.textSecondary, borderLeftWidth: 3, paddingLeft: 12 },
  warmupRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.surface, borderRadius: 14, height: 44, paddingHorizontal: 14 },
  warmupRowNum: { width: 22, fontSize: 14, fontWeight: "700", color: C.textSecondary },
  warmupRowWeight: { flex: 1, fontSize: 17, fontWeight: "800", color: C.textPrimary },
  warmupRowSecs: { fontSize: 17, fontWeight: "700", color: C.textSecondary },
  warmupRowNote: { fontSize: 14, color: C.textSecondary },
  noMaxCard: { gap: 6, backgroundColor: "rgba(254,215,102,0.12)", borderRadius: 14, padding: 12 },
  noMaxTitle: { fontSize: 15, fontWeight: "700", color: C.textPrimary },
  noMaxText: { fontSize: 14, lineHeight: 20, color: C.textSecondary },
  timerSideTitle: { fontSize: 28, fontWeight: "800", color: C.side, letterSpacing: -0.5 },
  alignRight: { textAlign: "right", alignItems: "flex-end" },
  rowReverse: { flexDirection: "row-reverse" },

  exHeader: { gap: 4, marginTop: -36 },
  exKicker: { fontSize: 12, fontWeight: "700", color: C.green, textTransform: "uppercase", letterSpacing: 0.8 },
  exNameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  exName: { flexShrink: 1, fontSize: 28, fontWeight: "800", color: C.textPrimary, letterSpacing: -0.5 },
  exTargetRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  exFocusDot: { width: 8, height: 8, borderRadius: 4 },
  exFocusLabel: { fontSize: 15, fontWeight: "700" },
  exTargetSep: { fontSize: 15, color: C.textMuted },
  exTargetAmount: { fontSize: 15, fontWeight: "600", color: C.textPrimary },
  inputSection: { gap: 10 },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.6 },

  roundRaiseBanner: { backgroundColor: "rgba(111,207,151,0.12)" },
  roundDropBanner: { gap: 10, width: "100%", backgroundColor: "rgba(254,215,102,0.12)", borderRadius: 14, padding: 12 },
  roundDropTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  roundDropPick: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 44, borderRadius: 14, backgroundColor: C.yellow },
  roundDropPickText: { fontSize: 15, fontWeight: "800", color: C.bg },
  swapBanner: { backgroundColor: "rgba(111,207,151,0.10)", borderColor: C.green },
  pickerBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" },
  pickerSheet: { maxHeight: "85%", backgroundColor: C.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 16 },
  pickerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pickerTitle: { fontSize: 22, fontWeight: "800", color: C.textPrimary },
  pickerHint: { fontSize: 14, color: C.textSecondary, marginTop: 6, marginBottom: 8 },
  pickerSection: { fontSize: 12, fontWeight: "800", color: C.green, letterSpacing: 1, textTransform: "uppercase", marginTop: 14, marginBottom: 8 },
  pickerRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.surface, borderRadius: 16, padding: 10, marginBottom: 8 },
  pickerName: { fontSize: 15, fontWeight: "700", color: C.textPrimary },
  pickerMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  pickerSearch: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.surfaceHigh, borderRadius: 14, paddingHorizontal: 12, height: 44, marginTop: 4 },
  pickerSearchInput: { flex: 1, fontSize: 15, color: C.textPrimary, paddingVertical: 0 },
  pickerChips: { gap: 8, paddingVertical: 12 },
  pickerChip: { paddingHorizontal: 12, height: 34, justifyContent: "center", borderRadius: 999, backgroundColor: C.surfaceHigh },
  pickerChipSelected: { backgroundColor: C.green },
  pickerChipText: { fontSize: 13, fontWeight: "700", color: C.textSecondary },
  pickerChipTextSelected: { color: C.bg },
  pickerSheetTall: { height: "85%" },
  scopeRow: { flexDirection: "row", backgroundColor: C.surfaceHigh, borderRadius: 14, padding: 4, gap: 4, marginTop: 10 },
  scopeBtn: { flex: 1, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  scopeBtnSelected: { backgroundColor: C.green },
  scopeText: { fontSize: 14, fontWeight: "700", color: C.textSecondary },
  scopeTextSelected: { color: C.bg },
  changeExercise: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginTop: 18, paddingVertical: 6 },
  changeExerciseText: { fontSize: 14, fontWeight: "700", color: C.textSecondary },
  roundDropText: { flex: 1, fontSize: 14, fontWeight: "600", color: C.textPrimary, lineHeight: 19 },
  roundDropUndo: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: C.surfaceHigh },
  roundDropUndoText: { fontSize: 13, fontWeight: "700", color: C.textPrimary },
  restDrop: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(254,215,102,0.12)", borderRadius: 14, padding: 12 },
  restDropName: { fontSize: 13, fontWeight: "700", color: C.yellow },
  restDropText: { fontSize: 13, color: C.textSecondary },
  nextTimeCard: { width: "100%", backgroundColor: C.surface, borderRadius: 22, borderWidth: 1, borderColor: C.border, padding: 20, gap: 12 },
  nextTimeTitle: { fontSize: 12, fontWeight: "800", color: C.green, letterSpacing: 1, textTransform: "uppercase" },
  nextTimeRow: { gap: 2 },
  nextTimeName: { fontSize: 15, fontWeight: "700", color: C.textPrimary },
  nextTimeNote: { fontSize: 14, color: C.textSecondary },
  prefillLoading: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, height: 52 },
  prefillLoadingText: { fontSize: 14, color: C.textMuted },
  weightLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  unitToggle: { flexDirection: "row", gap: 6 },
  unitChip: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, backgroundColor: C.surfaceHigh },
  unitChipSelected: { backgroundColor: C.green, borderColor: C.green },
  unitChipText: { fontSize: 12, fontWeight: "600", color: C.textSecondary },
  unitChipTextSelected: { color: C.bg },

  exerciseCard: { flex: 1, width: "100%", justifyContent: "center", gap: 8, paddingVertical: 16 },
  // Full-bleed: the negative margin cancels screenContent's side padding.
  exercisePhotoBanner: { marginHorizontal: -20, aspectRatio: 4 / 3, overflow: "hidden", backgroundColor: C.surface },
  exercisePhotoFade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 90 },
  exercisePhotoBannerImage: { width: "100%", height: "100%" },
  exercisePhotoBannerLoading: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    alignItems: "center", justifyContent: "center",
  },
  exercisePhotoProgressText: { fontSize: 11, fontWeight: "700", color: C.textPrimary },
  exercisePhotoExpandBadge: {
    position: "absolute", bottom: 8, right: 8, width: 26, height: 26, borderRadius: 13,
    backgroundColor: C.green, alignItems: "center", justifyContent: "center",
  },
  exercisePhotoExpandBadgeHero: { top: 12, right: 12, bottom: undefined },
  exerciseInfoIconWrap: {
    width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center",
  },
  exercisePhotoModalBackdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.9)", alignItems: "center", justifyContent: "center",
  },
  exercisePhotoFullBackdrop: { flex: 1, backgroundColor: "#000" },
  exercisePhotoCloseBtn: {
    position: "absolute", top: 50, right: 20, width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center",
  },
  // maxHeight is set inline (a pixel value derived from the window height) —
  // the static value here is just a fallback.
  exerciseInfoSheet: {
    width: "88%", maxHeight: "75%", backgroundColor: C.surface, borderRadius: 16, overflow: "hidden",
  },
  exerciseInfoSheetImage: { width: "100%", height: 220, backgroundColor: C.surfaceHigh },
  exerciseInfoNotesContent: { padding: 20 },
  exerciseInfoNotesText: { fontSize: 15, color: C.textPrimary, lineHeight: 22 },
  exerciseName: { fontSize: 22, fontWeight: "800", textAlign: "center", color: C.textPrimary },
  exerciseTarget: { fontSize: 15, color: C.textSecondary, marginBottom: 8, textAlign: "center" },

  circularProgress: { alignSelf: "center" },
  pauseBtn: {
    alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 8, marginTop: 20,
    paddingHorizontal: 22, height: 48, borderRadius: 16, backgroundColor: C.surfaceHigh,
  },
  pauseBtnText: { fontSize: 15, fontWeight: "700", color: C.textPrimary },
  seriesCounter: { fontSize: 16, color: C.textSecondary, marginBottom: 12, textAlign: "center" },
  hangRestLabel: { fontSize: 13, fontWeight: "700", letterSpacing: 1, color: C.textSecondary, textAlign: "center" },
  timerText: { fontSize: 42, fontWeight: "700", textAlign: "center", color: C.textPrimary },

  input: { width: "100%", borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, fontSize: 15, color: C.textPrimary, backgroundColor: C.surfaceHigh },

  miniLabel: { fontSize: 12, fontWeight: "700", color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.6 },

  // − value + stepper
  stepperRow: {
    flexDirection: "row", alignItems: "center", width: "100%",
    backgroundColor: C.surfaceHigh, borderRadius: 14, overflow: "hidden",
  },
  stepperBtn: { width: 60, paddingVertical: 16, alignItems: "center", justifyContent: "center" },
  stepperBtnText: { fontSize: 28, fontWeight: "400", color: C.green },
  stepperValueTouch: {
    flex: 1, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: C.border, borderStyle: "dashed",
  },
  stepperValue: { textAlign: "center", fontSize: 24, fontWeight: "800", color: C.textPrimary },
  stepperInput: {
    flex: 1, textAlign: "center", fontSize: 24, fontWeight: "800", color: C.textPrimary,
    paddingVertical: 16, borderBottomWidth: 2, borderBottomColor: C.green,
  },
  stepperSuffix: { fontSize: 15, fontWeight: "600", color: C.textSecondary },

  // Rest between rounds
  restContainer: { flexGrow: 1, paddingTop: 20, paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
  restCircle: { alignItems: "center", justifyContent: "center", paddingVertical: 12 },
  restTimerText: { fontSize: 64, fontWeight: "800", color: C.textPrimary, textAlign: "center", fontVariant: ["tabular-nums"] },

  // Timed amount control — stepper box with the hold button on its right
  timerCard: { width: "100%", backgroundColor: C.surfaceHigh, borderRadius: 14, padding: 12, gap: 12 },
  timerLengthRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  timerAdjustBtn: { width: 64, height: 40, borderRadius: 12, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" },
  timerAdjustText: { fontSize: 14, fontWeight: "700", color: C.textSecondary },
  timerLengthValue: { fontSize: 32, fontWeight: "800", color: C.textPrimary, fontVariant: ["tabular-nums"] },
  timerLengthCaption: { fontSize: 11, fontWeight: "700", color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.6 },
  timerStartBtn: {
    height: 48, borderRadius: 14, backgroundColor: "rgba(111,207,151,0.12)",
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  timerStartText: { fontSize: 15, fontWeight: "800", color: C.green },
  timedAgainBtn: { height: 40 },
  timedActive: { width: "100%", alignItems: "center", gap: 8, paddingVertical: 8 },
  timedPhaseLabel: { fontSize: 12, fontWeight: "800", letterSpacing: 1.5, color: C.textSecondary },
  timedBig: { fontSize: 60, fontWeight: "800", fontVariant: ["tabular-nums"], lineHeight: 66 },
  timedBigUnit: { fontSize: 24, fontWeight: "700", color: C.textSecondary },
  timedStopBtn: { alignSelf: "stretch" },
  holdTimerBtn: {
    paddingHorizontal: 18, borderRadius: 14,
    backgroundColor: "rgba(111,207,151,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  holdTimerBtnStop: { backgroundColor: C.red },
  holdTimerBtnText: { fontSize: 14, fontWeight: "800", color: C.green, textAlign: "center" },

  // Collapsible weight/RPE toggle
  detailToggle: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6 },
  detailCaret: { fontSize: 12, color: C.textSecondary, width: 12, textAlign: "center" },
  detailToggleText: { fontSize: 12, fontWeight: "700", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.6 },

  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, width: "100%" },
  repChip: { minWidth: 52, height: 52, paddingHorizontal: 14, borderRadius: 16, backgroundColor: C.surfaceHigh, alignItems: "center", justifyContent: "center" },
  repChipWide: { minWidth: 76 },
  effortChip: { flex: 1 },
  repChipSelected: { backgroundColor: C.green },
  repChipText: { fontSize: 18, fontWeight: "700", color: C.textPrimary },
  repChipTextSelected: { color: C.bg },
  linkText: { fontSize: 14, fontWeight: "700", color: C.green },
  settingCard: { backgroundColor: C.surface, borderRadius: 16, padding: 14, gap: 8, width: "100%" },
  settingHint: { fontSize: 15, color: C.textPrimary, lineHeight: 20 },
  settingHintLabel: { fontWeight: "800", color: C.textMuted },
  settingSwitchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  settingSwitchText: { fontSize: 15, fontWeight: "700", color: C.textPrimary, flex: 1 },
  weightLine: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.surface, borderRadius: 16, paddingHorizontal: 14, height: 52 },
  weightLineValue: { flex: 1, fontSize: 16, fontWeight: "700", color: C.textPrimary },
  suggestionBanner: {
    backgroundColor: "rgba(111,207,151,0.12)", borderRadius: 14,
    paddingVertical: 10, paddingHorizontal: 12, width: "100%",
  },
  suggestionBannerText: { fontSize: 12.5, fontWeight: "600", color: C.green, lineHeight: 17 },
  suggestionBannerDetail: { fontSize: 12, color: C.textSecondary, lineHeight: 16, marginTop: 4 },
  levelPickerRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, width: "100%" },
  levelChip: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, backgroundColor: C.surfaceHigh, alignItems: "center" },
  levelChipSelected: { backgroundColor: C.green },
  levelChipText: { fontSize: 14, fontWeight: "500", color: C.textSecondary },
  levelChipTextSelected: { color: C.bg, fontWeight: "700" },
  levelChipSuggested: { fontSize: 9.5, fontWeight: "700", color: C.green, letterSpacing: 0.4, marginTop: 2, textTransform: "uppercase" },
  levelChipSuggestedSelected: { color: C.bg },
  levelEmptyHint: { fontSize: 12.5, color: C.textMuted, fontStyle: "italic" },

  reviewContainer: { padding: 20, gap: 16 },
  reviewRound: { backgroundColor: C.surface, borderRadius: 22, borderWidth: 1, borderColor: C.border, padding: 20, gap: 12 },
  reviewRoundTitle: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, color: C.textMuted },
  reviewRow: { gap: 2 },
  reviewExerciseName: { fontSize: 15, fontWeight: "600", color: C.textPrimary },
  reviewDetail: { fontSize: 14, color: C.textSecondary },
  reviewNotes: { fontSize: 13, color: C.textMuted, fontStyle: "italic", marginTop: 2 },
})
