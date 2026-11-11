// The athlete's Max Hangs log (utils/maxHangs.ts), remembered on the device
// so the warm-up still shows when the `users` row can't be read (offline,
// slow network). Best effort: storage errors read as no copy.

import AsyncStorage from "@react-native-async-storage/async-storage"
import { parseHangLog, type HangMaxEntry } from "@/utils/maxHangs"

const key = (userId: string) => `sc.hangMaxLog.${userId}`

// The last log seen for this athlete, or undefined when the device has no copy.
export async function loadCachedHangLog(userId: string): Promise<HangMaxEntry[] | undefined> {
  try {
    const raw = await AsyncStorage.getItem(key(userId))
    return raw == null ? undefined : parseHangLog(raw)
  } catch {
    return undefined
  }
}

export async function saveCachedHangLog(userId: string, log: HangMaxEntry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(key(userId), JSON.stringify(log))
  } catch { /* best effort */ }
}
