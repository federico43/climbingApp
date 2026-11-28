// Next-session tasks (utils/sessionTasks.ts) on the phone and on the
// athlete's `users` row (column `nextTasks`, scripts/next-tasks/create-column.mjs).
// The phone copy is written first, so it works offline and before the column
// exists; the newer copy wins on load, and a newer phone copy is pushed up
// then. Saves run one after another so an older list never lands last.
// Best effort: never throws.

import { tablesDB } from "@/components/AppWrite"
import { DATABASE_ID, USERS_TABLE } from "@/services/BoulderGraphService"
import { getOwnUserRow } from "@/services/ownUserRow"
import { EMPTY_TASKS, newerList, parseSessionTasks, serializeSessionTasks, type SessionTaskList } from "@/utils/sessionTasks"
import AsyncStorage from "@react-native-async-storage/async-storage"

const key = (userId: string) => `nextTasks.${userId}`

export async function loadLocalSessionTasks(userId: string): Promise<SessionTaskList> {
  try {
    return parseSessionTasks(await AsyncStorage.getItem(key(userId)))
  } catch {
    return EMPTY_TASKS
  }
}

async function saveLocal(userId: string, list: SessionTaskList): Promise<void> {
  try {
    await AsyncStorage.setItem(key(userId), serializeSessionTasks(list))
  } catch { /* best effort */ }
}

async function saveServer(userId: string, list: SessionTaskList): Promise<void> {
  try {
    await tablesDB.updateRow({
      databaseId: DATABASE_ID, tableId: USERS_TABLE, rowId: userId,
      data: { nextTasks: serializeSessionTasks(list) },
    })
  } catch (e) {
    // No connection, or the column isn't there yet — the phone copy stays,
    // and the next load pushes it up.
    console.log("sessionTasks: server save failed", e)
  }
}

// One save at a time, in the order they were asked for.
let chain: Promise<void> = Promise.resolve()
function queue(job: () => Promise<void>): Promise<void> {
  chain = chain.then(job, job)
  return chain
}

// The phone copy and the server's (one row read, shared with technique
// progress — services/ownUserRow.ts), the newer one winning.
export async function loadSessionTasks(userId: string): Promise<SessionTaskList> {
  const local = await loadLocalSessionTasks(userId)
  let server: SessionTaskList = EMPTY_TASKS
  try {
    const row: any = await getOwnUserRow(userId)
    server = parseSessionTasks(row?.nextTasks)
  } catch {
    return local
  }
  const best = newerList(local, server)
  if (best === local && local.updatedAt > server.updatedAt) queue(() => saveServer(userId, local))
  else if (best === server && server.updatedAt > local.updatedAt) queue(() => saveLocal(userId, server))
  return best
}

export function saveSessionTasks(userId: string, list: SessionTaskList): Promise<void> {
  return queue(async () => {
    await saveLocal(userId, list)
    await saveServer(userId, list)
  })
}
