import { saveSession } from "@/services/BoulderGraphService"
import { serializeSession } from "@/utils/workoutSession"
import { useCallback, useEffect, useRef, useState } from "react"

// ─── Types ────────────────────────────────────────────────────────────────────

export type WorkoutStatus = "idle" | "running" | "completed"

export interface Block {
  type: string
  timer?: number
  restTime?: number
  targetAttempts?: number
  description?: string
  // Target training adaptation — drives pie chart slice color, day timeline,
  // and future adaptation-based analytics. See utils/adaptations.ts for the
  // taxonomy and per-type defaults when unset.
  adaptation?: string
}

export interface Attempt {
  success: boolean
  video?: string
  notes?: string
  level?: string
  scData?: Record<string, any>
  blockIndex: number
  type: string
  timestamp: number
  projectId?: string
  rpe?: number
  highPoint?: number
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useWorkout(protocolInput: Block[]) {
  // Use the protocol reactively: the provider holds it as state and sets it via
  // openWorkout/resume, so derived values (currentBlock, totalBlocks) always
  // reflect the active protocol — and a restored protocol reaches the hook.
  const protocol = protocolInput

  const [currentBlockIndex, setCurrentBlockIndex] = useState(0)
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [status, setStatus] = useState<WorkoutStatus>("idle")
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null)
  const [restTimeRemaining, setRestTimeRemaining] = useState<number | null>(null)
  const [blockDurations, setBlockDurations] = useState<Record<number, number>>({})
  const [blockStartTime, setBlockStartTime] = useState<number | null>(null)
  // When the whole workout started — drives the summary's total time. Persisted
  // and restored so a resumed workout reports its real total duration.
  const [workoutStartTime, setWorkoutStartTime] = useState<number | null>(null)
  // Indices the user chose to skip. Skipped blocks are omitted from the
  // summary and never persisted (see the save effect below).
  const [skippedBlocks, setSkippedBlocks] = useState<Set<number>>(new Set())

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const restTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const restEndTimeRef = useRef<number | null>(null)

  const currentBlock = protocol[currentBlockIndex] ?? null
  const totalBlocks = protocol.length
  const isLastBlock = currentBlockIndex === totalBlocks - 1

  // Derive attemptsDone from attempts array — avoids stale state reads
  const attemptsDone = attempts.filter(
    (a) => a.blockIndex === currentBlockIndex
  ).length

  // ── Cleanup on unmount ──────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearInterval(timerRef.current)
      if (restTimerRef.current !== null) clearInterval(restTimerRef.current)
    }
  }, [])

  // ── Persist completed session ───────────────────────────────────────────────

  useEffect(() => {
    if (status === "completed") {
      // Skipped blocks are dropped and indices remapped (see serializeSession).
      saveSession(serializeSession(protocol, attempts, blockDurations, skippedBlocks))
    }
    // deps include the data so the persisted closure is never stale
  }, [status, attempts, protocol, blockDurations, skippedBlocks])

  // ── Actions ─────────────────────────────────────────────────────────────────

  // Accumulate (not overwrite) the time spent on the block we're leaving, so
  // revisiting a block via Back/Continue doesn't discard or double-count time.
  const recordElapsed = useCallback((index: number) => {
    if (blockStartTime === null) return
    const elapsed = Math.floor((Date.now() - blockStartTime) / 1000)
    setBlockDurations((prev) => ({ ...prev, [index]: (prev[index] ?? 0) + elapsed }))
  }, [blockStartTime])

  // Landing on a block (via Back or Continue) means the user intends to do it,
  // so clear any prior "skipped" mark on the destination.
  const unskip = useCallback((index: number) => {
    setSkippedBlocks((prev) => {
      if (!prev.has(index)) return prev
      const next = new Set(prev)
      next.delete(index)
      return next
    })
  }, [])

  const goToNextBlock = useCallback(() => {
    recordElapsed(currentBlockIndex)
    const nextIndex = currentBlockIndex + 1
    if (nextIndex >= protocol.length) {
      setBlockStartTime(null)
      setStatus("completed")
    } else {
      unskip(nextIndex)
      setBlockStartTime(Date.now())
      setCurrentBlockIndex(nextIndex)
    }
  }, [currentBlockIndex, protocol.length, recordElapsed, unskip])

  const goToPreviousBlock = useCallback(() => {
    if (currentBlockIndex > 0) {
      recordElapsed(currentBlockIndex)
      const prevIndex = currentBlockIndex - 1
      unskip(prevIndex)
      setBlockStartTime(Date.now())
      setCurrentBlockIndex(prevIndex)
    }
  }, [currentBlockIndex, recordElapsed, unskip])

  // Skip the current block: mark it skipped (no time recorded) and advance.
  const skipBlock = useCallback(() => {
    setSkippedBlocks((prev) => new Set(prev).add(currentBlockIndex))
    const nextIndex = currentBlockIndex + 1
    if (nextIndex >= protocol.length) {
      setBlockStartTime(null)
      setStatus("completed")
    } else {
      setBlockStartTime(Date.now())
      setCurrentBlockIndex(nextIndex)
    }
  }, [currentBlockIndex, protocol.length])

  const startWorkout = useCallback(() => {
    // Don't reset a workout that's already running — this guards against the
    // host's auto-start firing over a freshly restored (resumed) session.
    if (status === "running") return
    setCurrentBlockIndex(0)
    setAttempts([])
    setBlockDurations({})
    setBlockStartTime(Date.now())
    setWorkoutStartTime(Date.now())
    setSkippedBlocks(new Set())
    setStatus("running")
  }, [status])

  // Re-enter a workout that was interrupted (app closed/killed), restoring the
  // logged progress. The current block's elapsed clock restarts from now so the
  // time spent while the app was gone isn't counted.
  const restoreWorkout = useCallback((saved: {
    currentBlockIndex: number
    attempts: Attempt[]
    blockDurations: Record<number, number>
    skippedBlocks: number[]
    workoutStartTime?: number | null
  }) => {
    if (timerRef.current !== null) clearInterval(timerRef.current)
    if (restTimerRef.current !== null) clearInterval(restTimerRef.current)
    setCurrentBlockIndex(saved.currentBlockIndex ?? 0)
    setAttempts(saved.attempts ?? [])
    setBlockDurations(saved.blockDurations ?? {})
    setSkippedBlocks(new Set(saved.skippedBlocks ?? []))
    setBlockStartTime(Date.now())
    // Keep the ORIGINAL start so total time spans the real duration.
    setWorkoutStartTime(saved.workoutStartTime ?? Date.now())
    setTimeRemaining(null)
    setRestTimeRemaining(null)
    setStatus("running")
  }, [])

  const resetWorkout = useCallback(() => {
    if (timerRef.current !== null) clearInterval(timerRef.current)
    if (restTimerRef.current !== null) clearInterval(restTimerRef.current)
    setStatus("idle")
    setCurrentBlockIndex(0)
    setAttempts([])
    setTimeRemaining(null)
    setRestTimeRemaining(null)
    setBlockDurations({})
    setBlockStartTime(null)
    setWorkoutStartTime(null)
    setSkippedBlocks(new Set())
  }, [])

  const undoLastAttempt = useCallback(() => {
    setAttempts((prev) => {
      // Pop the most-recent attempt for the current block, if any
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].blockIndex === currentBlockIndex) {
          return [...prev.slice(0, i), ...prev.slice(i + 1)]
        }
      }
      return prev
    })
  }, [currentBlockIndex])

  const logAttempt = useCallback(
    ({ success, video, notes, level, scData, highPoint, projectId, rpe }: Omit<Attempt, "blockIndex" | "type" | "timestamp">) => {
      if (status !== "running" || !currentBlock) return

      const newAttempt: Attempt = {
        success,
        video,
        notes,
        level,
        scData,
        highPoint,
        projectId,
        rpe,
        blockIndex: currentBlockIndex,
        type: currentBlock.type,
        timestamp: Date.now(),
      }

      setAttempts((prev) => [...prev, newAttempt])
    },
    [status, currentBlock, currentBlockIndex]
  )

  const startRestTimer = useCallback((duration: number) => {
  if (restTimerRef.current !== null) {
    clearInterval(restTimerRef.current)
    restTimerRef.current = null
  }

  const endTime = Date.now() + duration * 1000
  restEndTimeRef.current = endTime
  setRestTimeRemaining(duration)

  restTimerRef.current = setInterval(() => {
    const remaining = Math.ceil((restEndTimeRef.current! - Date.now()) / 1000)
    if (remaining <= 0) {
      clearInterval(restTimerRef.current!)
      restTimerRef.current = null
      setRestTimeRemaining(0)
    } else {
      setRestTimeRemaining(remaining)
    }
  }, 200) // poll every 200ms so it catches up quickly when returning
}, [])

  return {
    currentBlock,
    currentBlockIndex,
    totalBlocks,
    isLastBlock,
    attemptsDone,
    status,
    timeRemaining,
    restTimeRemaining,
    attempts,
    goToNextBlock,
    goToPreviousBlock,
    skipBlock,
    logAttempt,
    undoLastAttempt,
    startWorkout,
    restoreWorkout,
    startRestTimer,
    resetWorkout,
    blockDurations,
    blockStartTime,
    workoutStartTime,
    skippedBlocks,
  }
}