// "For next time" tasks (utils/nextTasks.ts) on the phone and on the
// athlete's `users` row (column `nextTasks`, scripts/next-tasks/create-column.mjs).
// The phone copy is written first, so it works offline and before the column
// exists; the newer copy wins on load, and a newer phone copy is pushed up
// then. Best effort: never throws.

import { tablesDB } from "@/components/AppWrite"
import { DATABASE_ID, USERS_TABLE } from "@/services/BoulderGraphService"
import { EMPTY_TASKS, newerList, parseNextTasks, serializeNextTasks, type NextTaskList } from "@/utils/nextTasks"
import AsyncStorage from "@react-native-async-storage/async-storage"

const key = (userId: string) => `nextTasks.${userId}`

async function loadLocal(userId: string): Promise<NextTaskList> {
  try {
    return parseNextTasks(await AsyncStorage.getItem(key(userId)))
  } catch {
    return EMPTY_TASKS
  }
}

async function saveLocal(userId: string, list: NextTaskList): Promise<void> {
  try {
    await AsyncStorage.setItem(key(userId), serializeNextTasks(list))
  } catch { /* best effort */ }
}

async function saveServer(userId: string, list: NextTaskList): Promise<void> {
  try {
    await tablesDB.updateRow({
      databaseId: DATABASE_ID, tableId: USERS_TABLE, rowId: userId,
      data: { nextTasks: serializeNextTasks(list) },
    })
  } catch (e) {
    // No connection, or the column isn't there yet — the phone copy stays.
    console.log("nextTasks: server save failed", e)
  }
}

// The phone copy right away (for a first render), without the server.
export const loadLocalNextTasks = loadLocal

export async function loadNextTasks(userId: string): Promise<NextTaskList> {
  const local = await loadLocal(userId)
  let server: NextTaskList = EMPTY_TASKS
  try {
    const row: any = await tablesDB.getRow({ databaseId: DATABASE_ID, tableId: USERS_TABLE, rowId: userId })
    server = parseNextTasks(row?.nextTasks)
  } catch {
    return local
  }
  const best = newerList(local, server)
  if (best === local && local.updatedAt > server.updatedAt) saveServer(userId, local)
  else if (best === server && server.updatedAt > local.updatedAt) saveLocal(userId, server)
  return best
}

export async function saveNextTasks(userId: string, list: NextTaskList): Promise<void> {
  await saveLocal(userId, list)
  await saveServer(userId, list)
}
