// A short-lived memory of full-table reads (listAllRows), so screens that
// reload on every focus, and workout blocks that each load the same history,
// share one fetch. Appwrite's free plan bills every row a list returns as a
// database read (an empty list counts as one), and the same rows were being
// read again many times a minute.
//
// Past its TTL, or after a change, a list isn't read again in full:
//   1. check: one row says whether anything changed — how many rows match
//      now, and the newest $updatedAt among them. A new or edited row moves
//      the newest $updatedAt; a deleted one, or one that no longer matches,
//      changes the count. Unchanged → the rows already here.
//   2. delta: only the rows created or edited since, merged in (lists sorted
//      by $createdAt, like the session histories). Kept only when the
//      result matches the check exactly; else (a row deleted…) step 3.
//   3. the full list again.
// So a session history of 200 rows costs 1 read to confirm, or 2–3 after a
// workout, instead of 200.
//
// Kept honest by:
//   - any write through tablesDB (create/update/delete/upsert) marks that
//     table changed (components/AppWrite.js),
//   - any function call (classes, plans, homework…) marks every table
//     changed, since the function may have written any of them,
//   - pull-to-refresh, a tapped homework push and code that must see the
//     latest rows (the coach's Create) call freshReads() first.
// What's left is someone else's change showing up to TTL later.

// Rows that change all the time (sessions, plans, classes, users…).
export const READ_TTL_MS = 3 * 60_000
// The libraries: only the coach edits them, and those edits mark the table.
export const LIBRARY_TTL_MS = 30 * 60_000
const LIBRARY_TABLES = new Set(["blocks", "exercises", "spray_walls", "niveles_boulder"])
// A list nobody asked for in this long is dropped (a session history is big),
// and at most this many are kept.
export const IDLE_MS = 30 * 60_000
export const MAX_LISTS = 40

export const ttlFor = (table: string) => (LIBRARY_TABLES.has(table) ? LIBRARY_TTL_MS : READ_TTL_MS)

// What a list looked like: how many rows, and the newest $updatedAt.
export interface Signature { count: number; newest: string }

// Null when a row has no $updatedAt (a Query.select without it): such a list
// can't be checked, only read again.
export function signatureOf(rows: readonly unknown[]): Signature | null {
  let newest = ""
  for (const row of rows) {
    const at = (row as { $updatedAt?: unknown } | null)?.$updatedAt
    if (typeof at !== "string" || !at) return null
    if (at > newest) newest = at
  }
  return { count: rows.length, newest }
}

const parse = (q: unknown): { method?: string; attribute?: string } | null => {
  try { return JSON.parse(String(q)) } catch { return null }
}

// The queries that pick rows (not the order, page or columns), for the check.
const NOT_FILTERS = new Set(["orderAsc", "orderDesc", "orderRandom", "limit", "offset", "cursorAfter", "cursorBefore", "select"])
export function filtersOf<Q>(queries: readonly Q[]): Q[] {
  return queries.filter((q) => !NOT_FILTERS.has(parse(q)?.method ?? ""))
}

// The list's order when new rows can be merged into it: one order, by
// $createdAt. Null otherwise (by name, or Appwrite's own order): read again.
export function mergeOrderOf(queries: readonly unknown[]): { desc: boolean } | null {
  const orders = queries.map(parse).filter((q) => q?.method?.startsWith("order"))
  if (orders.length !== 1 || orders[0]?.attribute !== "$createdAt") return null
  return { desc: orders[0].method === "orderDesc" }
}

// `old` with `delta` (rows created or edited since) put in by $id, sorted.
export function mergeRows(old: readonly unknown[], delta: readonly unknown[], order: { desc: boolean }): unknown[] {
  const byId = new Map<unknown, unknown>()
  for (const r of old) byId.set((r as { $id?: unknown }).$id, r)
  for (const r of delta) byId.set((r as { $id?: unknown }).$id, r)
  const created = (r: unknown) => String((r as { $createdAt?: unknown }).$createdAt ?? "")
  return [...byId.values()].sort((a, b) => {
    const c = created(a) < created(b) ? -1 : created(a) > created(b) ? 1 : 0
    return order.desc ? -c : c
  })
}

interface Read { rows: unknown[]; sig: Signature | null }
interface Entry {
  table: string
  at: number      // when the rows were read or last checked
  usedAt: number
  stale: boolean  // check before using them again
  read: Promise<Read>
}
const entries = new Map<string, Entry>()

// Each caller gets its own array and its own row objects, so sorting a list
// or changing a row doesn't touch what anyone else (or the next read) gets.
function copyRow(row: unknown): unknown {
  if (!row || typeof row !== "object") return row
  const out: Record<string, unknown> = { ...(row as Record<string, unknown>) }
  for (const k in out) if (Array.isArray(out[k])) out[k] = (out[k] as unknown[]).slice()
  return out
}
const copyRows = <T>(read: Read) => read.rows.map(copyRow) as T[]

function sweep(now: number) {
  for (const [key, e] of entries) if (now - e.usedAt > IDLE_MS) entries.delete(key)
  if (entries.size <= MAX_LISTS) return
  const oldest = [...entries.entries()].sort((a, b) => a[1].usedAt - b[1].usedAt)
  for (const [key] of oldest.slice(0, entries.size - MAX_LISTS)) entries.delete(key)
}

export interface Fetchers<T> {
  // How many rows match now and the newest $updatedAt (one row).
  check?: () => Promise<Signature>
  // The rows created or edited after `since` (a $updatedAt), same filters.
  delta?: (since: string) => Promise<T[]>
}

// Rows for `table` + `queries`: from memory when read or checked less than
// the table's TTL ago (or still in flight); else checked, then brought up to
// date (see the top of this file); else from `load`.
export function cachedRows<T>(
  table: string,
  queries: unknown[],
  load: () => Promise<T[]>,
  { check, delta, now = Date.now() }: Fetchers<T> & { now?: number } = {},
): Promise<T[]> {
  sweep(now)
  const key = `${table}|${JSON.stringify(queries)}`
  const prev = entries.get(key)
  if (prev && !prev.stale && now - prev.at < ttlFor(table)) {
    prev.usedAt = now
    return prev.read.then((r) => copyRows<T>(r))
  }
  const read = (async (): Promise<Read> => {
    const old = prev && check ? await prev.read.catch(() => null) : null
    if (old?.sig && check) {
      // A check or delta that fails (an unexpected query error) just means a full read.
      const current = await check().catch(() => null)
      const same = (sig: Signature | null) => !!sig && !!current && sig.count === current.count && sig.newest === current.newest
      if (same(old.sig)) return old
      const order = mergeOrderOf(queries)
      if (current && order && delta) {
        const changed = await delta(old.sig.newest).catch(() => null)
        const rows = changed && mergeRows(old.rows, changed, order)
        const sig = rows && signatureOf(rows)
        if (rows && same(sig)) return { rows, sig }
      }
    }
    const rows = await load()
    return { rows, sig: signatureOf(rows) }
  })()
  const entry: Entry = { table, at: now, usedAt: now, stale: false, read }
  entries.set(key, entry)
  read.catch(() => {
    if (entries.get(key) !== entry) return
    // A failed read (offline) isn't remembered: the next caller tries again,
    // checking against the rows from before when there were any.
    if (prev) { prev.stale = true; entries.set(key, prev) } else entries.delete(key)
  })
  return read.then((r) => copyRows<T>(r))
}

// A write to `table` from this phone: its lists check before they're used again.
export function tableChanged(table: string) {
  for (const e of entries.values()) if (e.table === table) e.stale = true
}

// Every list checks with Appwrite before it's used again (one row each, more
// only where something changed).
export function freshReads() {
  for (const e of entries.values()) e.stale = true
}
