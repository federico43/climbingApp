// Technique module progress (utils/techniqueProgress.ts, docs/technique-modules.md)
// on the phone and on the athlete's `users` row (column `techniqueProgress`,
// scripts/technique-modules/create-progress-column.mjs). Same pattern as
// next-session tasks (services/sessionTasks.ts): the phone copy is written
// first, so it works offline and before the column exists; the newer copy
// wins on load, and a newer phone copy is pushed up then. Saves run one
// after another so an older copy never lands last. Best effort: never throws.

import { tablesDB } from "@/components/AppWrite"
import { DATABASE_ID, USERS_TABLE } from "@/services/BoulderGraphService"
import { getOwnUserRow } from "@/services/ownUserRow"
import {
  EMPTY_PROGRESS, newerProgress, parseTechniqueProgress, serializeTechniqueProgress, type TechniqueProgress,
} from "@/utils/techniqueProgress"
import AsyncStorage from "@react-native-async-storage/async-storage"

const key = (userId: string) => `techniqueProgress.${userId}`

export async function loadLocalTechniqueProgress(userId: string): Promise<TechniqueProgress> {
  try {
    return parseTechniqueProgress(await AsyncStorage.getItem(key(userId)))
  } catch {
    return EMPTY_PROGRESS
  }
}

async function saveLocal(userId: string, p: TechniqueProgress): Promise<void> {
  try {
    await AsyncStorage.setItem(key(userId), serializeTechniqueProgress(p))
  } catch { /* best effort */ }
}

async function saveServer(userId: string, p: TechniqueProgress): Promise<void> {
  try {
    await tablesDB.updateRow({
      databaseId: DATABASE_ID, tableId: USERS_TABLE, rowId: userId,
      data: { techniqueProgress: serializeTechniqueProgress(p) },
    })
  } catch (e) {
    // No connection, or the column isn't there yet — the phone copy stays,
    // and the next load pushes it up.
    console.log("techniqueProgress: server save failed", e)
  }
}

// One save at a time, in the order they were asked for.
let chain: Promise<void> = Promise.resolve()
function queue(job: () => Promise<void>): Promise<void> {
  chain = chain.then(job, job)
  return chain
}

// The phone copy and the server's (the shared user-row read), the newer winning.
export async function loadTechniqueProgress(userId: string): Promise<TechniqueProgress> {
  const local = await loadLocalTechniqueProgress(userId)
  let server: TechniqueProgress = EMPTY_PROGRESS
  try {
    const row: any = await getOwnUserRow(userId)
    server = parseTechniqueProgress(row?.techniqueProgress)
  } catch {
    return local
  }
  const best = newerProgress(local, server)
  if (best === local && local.updatedAt > server.updatedAt) queue(() => saveServer(userId, local))
  else if (best === server && server.updatedAt > local.updatedAt) queue(() => saveLocal(userId, server))
  return best
}

export function saveTechniqueProgress(userId: string, p: TechniqueProgress): Promise<void> {
  return queue(async () => {
    await saveLocal(userId, p)
    await saveServer(userId, p)
  })
}
