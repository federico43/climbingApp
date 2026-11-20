// A short-lived memory of full-table reads (listAllRows), so screens that
// reload on every focus, and workout blocks that each load the same history,
// share one fetch. Appwrite's free plan bills every row a list returns as a
// database read, and the same rows were being read again many times a minute.
//
// Kept honest by:
//   - any write through tablesDB (create/update/delete/upsert) forgets that
//     table (components/AppWrite.js),
//   - any function call (classes, plans, homework…) forgets everything, since
//     the function may have written any table,
//   - pull-to-refresh forgets everything (freshReads()),
//   - code that must see the latest rows (the coach's Create) calls
//     freshReads() first.
// What's left is someone else's change showing up to TTL later.

// Rows that change all the time (sessions, plans, classes, users…).
export const READ_TTL_MS = 3 * 60_000
// The libraries: only the coach edits them, and his edits forget the table.
export const LIBRARY_TTL_MS = 30 * 60_000
const LIBRARY_TABLES = new Set(["blocks", "exercises", "spray_walls", "niveles_boulder"])

export const ttlFor = (table: string) => (LIBRARY_TABLES.has(table) ? LIBRARY_TTL_MS : READ_TTL_MS)

interface Entry { at: number; table: string; promise: Promise<unknown[]> }
const entries = new Map<string, Entry>()

// Rows for `table` + `queries`, from memory when read less than the table's
// TTL ago (or still in flight), else from `load`. Each caller gets its own
// array, so sorting or splicing it doesn't touch anyone else's.
export function cachedRows<T>(table: string, queries: unknown[], load: () => Promise<T[]>, now = Date.now()): Promise<T[]> {
  const key = `${table}|${JSON.stringify(queries)}`
  const hit = entries.get(key)
  if (hit && now - hit.at < ttlFor(table)) return hit.promise.then((rows) => rows.slice() as T[])
  const promise = load()
  const entry: Entry = { at: now, table, promise }
  entries.set(key, entry)
  // A failed read (offline) isn't remembered: the next caller tries again.
  promise.catch(() => { if (entries.get(key) === entry) entries.delete(key) })
  return promise.then((rows) => rows.slice())
}

export function forgetTable(table: string) {
  for (const [key, e] of entries) if (e.table === table) entries.delete(key)
}

// Forget everything: the next read of any table goes to Appwrite.
export function freshReads() {
  entries.clear()
}
