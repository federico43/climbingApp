// The athlete's Edge Lifts max (utils/edgeWarmup.ts), remembered on the
// device so the warm-up still shows when the `users` row can't be read
// (offline, slow network). Best effort: storage errors read as no copy.

import AsyncStorage from "@react-native-async-storage/async-storage"

const key = (userId: string) => `sc.edgeLiftMax.${userId}`

// The last max seen for this athlete (kg; null = none), or undefined when
// the device has no copy.
export async function loadCachedEdgeMax(userId: string): Promise<number | null | undefined> {
  try {
    const raw = await AsyncStorage.getItem(key(userId))
    if (raw == null) return undefined
    const v = Number(raw)
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return undefined
  }
}

export async function saveCachedEdgeMax(userId: string, kg: number | null): Promise<void> {
  try {
    await AsyncStorage.setItem(key(userId), kg == null ? "" : String(kg))
  } catch { /* best effort */ }
}
