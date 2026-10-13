import { useHoldUpdates } from "@/utils/updateHold"
import { useWorkout } from "@/hooks/WorkoutHook"
import { saveSession, SessionLink } from "@/services/BoulderGraphService"
import { notifyCoachOfWorkoutCompletion } from "@/services/notifications"
import { serializeSession } from "@/utils/workoutSession"
import {
  clearPersistedWorkout,
  loadPersistedWorkout,
  savePersistedWorkout,
} from "@/utils/workoutPersistence"
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake"
import React, { createContext, useCallback, useContext, useEffect, useState } from "react"

const KEEP_AWAKE_TAG = "workout-active"

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkoutContextValue {
  // Workout hook (state + actions)
  workout: ReturnType<typeof useWorkout>
  // Active workout metadata
  protocol: any[]
  protocolName: string
  // UI state
  workoutActive: boolean
  workoutMinimized: boolean
  modalVisible: boolean
  // Actions
  // `link` = the coach / library workout it was started from, saved on the
  // session (plan progress). Omit for sequences, single blocks, coach tests.
  openWorkout: (protocol: any[], name: string, link?: SessionLink) => void
  // "Coach is here" / "On my own" mid-workout — this session's copy of the
  // block only, never the saved workout (docs/training-plan-implementation.md §12a).
  setBlockCoached: (index: number, coached: boolean) => void
  closeModal: () => void
  endWorkout: () => void
  minimize: () => void
  expand: () => void
  setWorkoutActive: (a: boolean) => void
  // Refresh signal — bumps when a workout ends so screens can reload data
  refreshKey: number
}

const WorkoutContext = createContext<WorkoutContextValue | undefined>(undefined)

// ─── Provider ─────────────────────────────────────────────────────────────────

export function WorkoutProvider({ children }: { children: React.ReactNode }) {
  const [protocol, setProtocol] = useState<any[]>([])
  const [protocolName, setProtocolName] = useState("")
  const [link, setLink] = useState<SessionLink | null>(null)
  const [workoutActive, setWorkoutActive] = useState(false)
  const [workoutMinimized, setWorkoutMinimized] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  // No OTA-update reloads mid-workout (see utils/updateHold.ts).
  useHoldUpdates(workoutActive)

  // Hook lives here so state survives modal close/reopen during minimize.
  const workout = useWorkout(protocol, link)

  // Keep the screen awake for the entire duration of an active workout —
  // including when it's minimized (rest timers, etc. keep running).
  useEffect(() => {
    if (workoutActive) {
      activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {/* best effort */})
      return () => { deactivateKeepAwake(KEEP_AWAKE_TAG) }
    }
  }, [workoutActive])

  // ── Crash/close recovery ────────────────────────────────────────────────────

  // On launch, recover an interrupted workout (app closed by the user or killed
  // by the OS mid-session):
  //   • recent → RESUME it (restored, minimized — the mini-bar reappears),
  //   • too old → save the logged work as a session so it isn't lost,
  //   • empty  → just drop it.
  useEffect(() => {
    (async () => {
      const saved = await loadPersistedWorkout()
      if (!saved) return
      const ageMs = Date.now() - (saved.savedAt ?? 0)
      const STALE_MS = 12 * 60 * 60 * 1000 // 12h: don't resume an ancient session

      // A snapshot only ever gets written while a workout is genuinely
      // running (see the save effect below), so its mere existence here
      // means the app closed mid-session — even if the athlete hadn't
      // logged their first attempt yet. Requiring attempts.length > 0
      // used to silently drop that progress (block index, elapsed time)
      // on every relaunch until the first attempt was logged.
      if (ageMs > STALE_MS) {
        if ((saved.attempts?.length ?? 0) > 0) {
          await saveSession({
            ...serializeSession(
              saved.protocol ?? [],
              saved.attempts,
              saved.blockDurations ?? {},
              new Set(saved.skippedBlocks ?? []),
            ),
            ...saved.link,
          })
        }
        await clearPersistedWorkout()
        return
      }

      // Resume: restore the live state and reopen minimized so it's unobtrusive.
      setProtocol(saved.protocol ?? [])
      setProtocolName(saved.protocolName ?? "")
      setLink(saved.link ?? null)
      workout.restoreWorkout({
        currentBlockIndex: saved.currentBlockIndex ?? 0,
        attempts: saved.attempts,
        blockDurations: saved.blockDurations ?? {},
        skippedBlocks: saved.skippedBlocks ?? [],
        workoutStartTime: saved.workoutStartTime ?? null,
      })
      setWorkoutActive(true)
      setModalVisible(true)
      setWorkoutMinimized(true)
    })()
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Continuously snapshot the live workout while it runs, so it survives a
  // close/kill at any point.
  useEffect(() => {
    if (workout.status !== "running") return
    savePersistedWorkout({
      protocol,
      protocolName,
      link,
      attempts: workout.attempts,
      blockDurations: workout.blockDurations,
      skippedBlocks: Array.from(workout.skippedBlocks),
      currentBlockIndex: workout.currentBlockIndex,
      workoutStartTime: workout.workoutStartTime,
      savedAt: Date.now(),
    })
  }, [
    workout.status,
    workout.attempts,
    workout.blockDurations,
    workout.skippedBlocks,
    workout.currentBlockIndex,
    protocol,
    protocolName,
    link,
  ])

  // A completed workout already saved itself (in the hook) — drop the snapshot
  // and let the coach know (fire-and-forget, best-effort).
  useEffect(() => {
    if (workout.status === "completed") {
      clearPersistedWorkout()
      notifyCoachOfWorkoutCompletion(protocolName)
    }
  }, [workout.status])

  const openWorkout = useCallback((p: any[], name: string, l?: SessionLink) => {
    setProtocol(p)
    setProtocolName(name)
    setLink(l ?? null)
    setModalVisible(true)
    setWorkoutMinimized(false)
  }, [])

  const setBlockCoached = useCallback((index: number, coached: boolean) => {
    setProtocol((p) => p.map((b, i) => (i === index ? { ...b, coached: coached || undefined } : b)))
  }, [])

  const closeModal = useCallback(() => {
    if (!workoutActive) setModalVisible(false)
  }, [workoutActive])

  const endWorkout = useCallback(() => {
    // Cancel = discard: drop the snapshot so it isn't recovered on next launch.
    clearPersistedWorkout()
    workout.resetWorkout()
    setWorkoutActive(false)
    setWorkoutMinimized(false)
    setModalVisible(false)
    setRefreshKey((k) => k + 1)
  }, [workout])

  const minimize = useCallback(() => setWorkoutMinimized(true), [])
  const expand   = useCallback(() => setWorkoutMinimized(false), [])

  const value: WorkoutContextValue = {
    workout,
    protocol,
    protocolName,
    workoutActive,
    workoutMinimized,
    modalVisible,
    openWorkout,
    setBlockCoached,
    closeModal,
    endWorkout,
    minimize,
    expand,
    setWorkoutActive,
    refreshKey,
  }

  return <WorkoutContext.Provider value={value}>{children}</WorkoutContext.Provider>
}

// ─── Consumer hook ────────────────────────────────────────────────────────────

export function useWorkoutContext(): WorkoutContextValue {
  const ctx = useContext(WorkoutContext)
  if (!ctx) throw new Error("useWorkoutContext must be used inside <WorkoutProvider>")
  return ctx
}
