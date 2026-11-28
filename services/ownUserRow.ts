// The signed-in athlete's own `users` row, read once and shared: next-session
// tasks (services/sessionTasks.ts) and technique progress
// (services/techniqueProgress.ts) both load from it at sign-in, so they cost
// one row read between them, not one each. A read is reused for
// REUSE_MS; after that (or after a failed read) the next call reads again.

import { tablesDB } from "@/components/AppWrite"
import { DATABASE_ID, USERS_TABLE } from "@/services/BoulderGraphService"

export const REUSE_MS = 60_000

let last: { userId: string; at: number; row: Promise<any> } | null = null

export function getOwnUserRow(userId: string): Promise<any> {
  const now = Date.now()
  if (last && last.userId === userId && now - last.at < REUSE_MS) return last.row
  const row = tablesDB.getRow({ databaseId: DATABASE_ID, tableId: USERS_TABLE, rowId: userId })
  const entry = { userId, at: now, row }
  last = entry
  row.catch(() => { if (last === entry) last = null })
  return row
}
