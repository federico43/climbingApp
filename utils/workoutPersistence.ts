// Local snapshot of the in-progress workout, so it survives the app being
// closed by the user or killed by the OS. Written continuously while a workout
// runs; read once on launch to recover an interrupted session; cleared when a
// workout completes or is cancelled.

import type { SessionLink } from "@/services/BoulderGraphService"
import AsyncStorage from "@react-native-async-storage/async-storage"

const KEY = "active-workout-v1"

export interface PersistedWorkout {
  protocol: any[]
  protocolName: string
  link?: SessionLink | null   // which workout it came from (absent on older snapshots)
  attempts: any[]
  blockDurations: Record<number, number>
  skippedBlocks: number[]
  currentBlockIndex: number
  workoutStartTime: number | null
  savedAt: number
}

export async function savePersistedWorkout(w: PersistedWorkout): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(w))
  } catch {
    /* best effort — losing one snapshot write is fine */
  }
}

export async function loadPersistedWorkout(): Promise<PersistedWorkout | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as PersistedWorkout) : null
  } catch {
    return null
  }
}

export async function clearPersistedWorkout(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY)
  } catch {
    /* best effort */
  }
}
