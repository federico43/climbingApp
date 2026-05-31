import { useWorkout } from "@/hooks/WorkoutHook"
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
  openWorkout: (protocol: any[], name: string) => void
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
  const [workoutActive, setWorkoutActive] = useState(false)
  const [workoutMinimized, setWorkoutMinimized] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

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

  const openWorkout = useCallback((p: any[], name: string) => {
    setProtocol(p)
    setProtocolName(name)
    setModalVisible(true)
    setWorkoutMinimized(false)
  }, [])

  const closeModal = useCallback(() => {
    if (!workoutActive) setModalVisible(false)
  }, [workoutActive])

  const endWorkout = useCallback(() => {
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
