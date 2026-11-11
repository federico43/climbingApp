// The athlete's band combos (utils/bands.ts), remembered on the device so
// the brief still knows them when the `users` row can't be read (offline,
// slow network), and so a combo found offline isn't lost. Best effort:
// storage errors read as no copy.

import AsyncStorage from "@react-native-async-storage/async-storage"
import { parseSavedBands, type SavedBands } from "@/utils/bands"

const key = (userId: string) => `sc.bandCombos.${userId}`

// undefined when the device has no copy.
export async function loadCachedBands(userId: string): Promise<SavedBands | undefined> {
  try {
    const raw = await AsyncStorage.getItem(key(userId))
    return raw == null ? undefined : parseSavedBands(raw)
  } catch {
    return undefined
  }
}

export async function saveCachedBands(userId: string, saved: SavedBands): Promise<void> {
  try {
    await AsyncStorage.setItem(key(userId), JSON.stringify(saved))
  } catch { /* best effort */ }
}
