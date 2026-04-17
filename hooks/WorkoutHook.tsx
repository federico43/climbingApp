import { useState, useEffect } from "react"
import { useRef } from "react"
import { saveSession } from "@/services/BoulderGraphService"
export function useWorkout(getProtocol: any) {
  //Get's the list of protocols. 
  const protocol = getProtocol()
  //what block are we currently on
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0)
  
  const [attemptsDone, setAttemptsDone] = useState(0)
  const [attempts, setAttempts] = useState<any[]>([])
  const [status, setStatus] = useState<"idle" | "running" | "completed">("idle")
  console.log(attempts)
  const currentBlock = protocol[currentBlockIndex]
  const isTimerBlock = currentBlock?.timer != null
  const totalBlocks = protocol.length
  const isLastBlock = currentBlockIndex === totalBlocks - 1
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null)
  
  const [restTimeRemaining, setRestTimeRemaining] = useState<number | null>(null)
  const restTimerRef = useRef<number | null>(null)
    
  useEffect(() => {
  return () => {
    if (restTimerRef.current !== null) {
      clearInterval(restTimerRef.current)
    }
  }
}, [])

useEffect(() => {
  if (status === "completed") {
    const session = {
      protocol: JSON.stringify(protocol),
      attempts: JSON.stringify(attempts),
    }

    saveSession(session)
  }
}, [status])


  function goToNextBlock() {
  const nextIndex = currentBlockIndex + 1

  if (nextIndex >= protocol.length) {
    setStatus("completed")
  } else {
    setCurrentBlockIndex(nextIndex)
    setAttemptsDone(0)
  }
}
    /*
  useEffect(() => {
  // clear any previous timer
  if (timerRef.current) {
    clearInterval(timerRef.current)
    timerRef.current = null
  }

  if (!currentBlock) return

  if (currentBlock.timer) {
    setTimeRemaining(currentBlock.timer)

    timerRef.current = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev === null) return null

        if (prev <= 1) {
          // TIME IS UP
          clearInterval(timerRef.current!)
          timerRef.current = null

          // move block
          setCurrentBlockIndex((prevIndex) => prevIndex + 1)

          return 0
        }

        return prev - 1
      })
    }, 1000)
  }

  return () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }
}, [currentBlockIndex])*/

  function startWorkout() {
    setCurrentBlockIndex(0)
    setAttemptsDone(0)
    setAttempts([])
    setStatus("running")
  }
  function resetWorkout() {
  setStatus("idle")
  setCurrentBlockIndex(0)
  setAttemptsDone(0)
  setAttempts([])
  // reset any timers too if needed
}

  function logAttempt({ success, video, notes, level }: any) {
  if (status !== "running") return

  const block = protocol[currentBlockIndex]
  if (!block) return

  const newAttempt = {
    success,
    video,
    notes,
    level,
    blockIndex: currentBlockIndex,
    type: block.type,
    constraint: block.constraint,
    timestamp: Date.now(),
  }

  setAttempts((prev) => [...prev, newAttempt])

  const targetAttempts = block.targetAttempts ?? 1
  const newCount = attemptsDone + 1

  setAttemptsDone(newCount)
}

  function startRestTimer(duration: number) {
  // prevent stacking timers
  if (restTimerRef.current !== null) {
    clearInterval(restTimerRef.current)
    restTimerRef.current = null
  }

  // set initial time
  setRestTimeRemaining(duration)

  // start countdown
  restTimerRef.current = setInterval(() => {
    setRestTimeRemaining((prev) => {
      if (prev === null) return null

      if (prev <= 1) {
        // stop timer at 0
        if (restTimerRef.current !== null) {
          clearInterval(restTimerRef.current)
          restTimerRef.current = null
        }
        return 0
      }

      return prev - 1
    })
  }, 1000)
}


  return {
    currentBlock,
    currentBlockIndex,
    totalBlocks,
    goToNextBlock,

    attemptsDone,

    isLastBlock,
    status,

    timeRemaining,
    restTimeRemaining,
    attempts,

    logAttempt,
    startWorkout,
    startRestTimer,
    resetWorkout
  }
}

