import { useAuth } from "@/components/auth-context"
import { useHoldUpdates } from "@/utils/updateHold"
import { useWorkout } from "@/hooks/WorkoutHook"
import { listBlocks, SessionLink } from "@/services/BoulderGraphService"
import { applyMainSwap, mainSwapFor } from "@/utils/mainSwap"
import { cloneLibraryBlock, findLibraryBlock } from "@/utils/planWorkout"
import { enqueueSession, onSessionsSynced } from "@/services/sessionSyncQueue"
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
  // The coach / plan workout it was started from (null for ad-hoc ones).
  link: SessionLink | null
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
  // The athlete's ⇄ switch of a plan workout's main block to the other one
  // of its type (utils/mainSwap.ts) — this session only. Throws when the
  // library block can't be fetched (e.g. no connection).
  swapMainBlock: (index: number) => Promise<void>
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
  const userId = useAuth().User?.$id ?? null

  // Workouts finished offline reach the server later — reload screens then.
  useEffect(() => onSessionsSynced(() => setRefreshKey((k) => k + 1)), [])

  // No OTA-update reloads mid-workout (see utils/updateHold.ts).
  useHoldUpdates(workoutActive)

  // Hook lives here so state survives modal close/reopen during minimize.
  const workout = useWorkout(protocol)

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
  //   • too old → save the logged work as a session so it isn't lost
  //     (through the sync queue, so it also survives having no signal),
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
          await enqueueSession(
            {
              ...serializeSession(
                saved.protocol ?? [],
                saved.attempts,
                saved.blockDurations ?? {},
                new Set(saved.skippedBlocks ?? []),
              ),
              ...saved.link,
            },
            { userId: saved.userId ?? null },
          )
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
      userId,
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
    userId,
  ])

  // A completed workout goes into the sync queue (stored on the phone first,
  // then written to Appwrite and the coach pinged — now, or once there's a
  // connection again). Only once it's in the queue is the snapshot dropped,
  // so there's never a moment where the workout exists nowhere.
  useEffect(() => {
    if (workout.status !== "completed") return
    enqueueSession(
      {
        // Skipped blocks are dropped and indices remapped (see serializeSession).
        ...serializeSession(protocol, workout.attempts, workout.blockDurations, workout.skippedBlocks),
        ...link,
      },
      { userId, notifyProtocolName: protocolName },
    ).then(() => clearPersistedWorkout())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per completion, with that moment's data
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

  const swapMainBlock = useCallback(async (index: number) => {
    const swap = mainSwapFor(protocol, index)
    if (!swap) return
    const row = findLibraryBlock(swap.to, await listBlocks())
    if (!row) throw new Error(`No "${swap.to.name}" block in the library.`)
    const logged = new Set(workout.attempts.map((a) => a.blockIndex))
    setProtocol((p) => applyMainSwap(p, index, cloneLibraryBlock(row), logged))
  }, [protocol, workout.attempts])

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
    link,
    workoutActive,
    workoutMinimized,
    modalVisible,
    openWorkout,
    setBlockCoached,
    swapMainBlock,
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

// The running workout's link, or null outside a workout (a block rendered
// on its own, e.g. a preview).
export function useWorkoutLink(): SessionLink | null {
  return useContext(WorkoutContext)?.link ?? null
}

export function useWorkoutContext(): WorkoutContextValue {
  const ctx = useContext(WorkoutContext)
  if (!ctx) throw new Error("useWorkoutContext must be used inside <WorkoutProvider>")
  return ctx
}
