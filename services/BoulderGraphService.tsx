import { account, tablesDB, storage } from "@/components/AppWrite"
import { ID, Query } from "appwrite"

export const DATABASE_ID   = "68bd9dd7003c15f7147e"
export const MEDIA_BUCKET_ID = "6a19e3a8002f3a83e640"
export const BOULDER_TABLE = "boulders_realizados"
export const LEVEL_TABLE = "niveles_boulder"
export const USERS_TABLE = "users"
export const SESSION_TABLE = "workoutsession"
export const PROTOCOLS_TABLE = "protocol"
export const BLOCKS_TABLE = "blocks"
// Table must exist in Appwrite with columns: name (string), holds (string)
export const SPRAY_ROUTES_TABLE = "spray_routes"
// Table must exist in Appwrite with columns: name (string), imageUri (string)
export const SPRAY_WALLS_TABLE = "spray_walls"

// Cursor-paginate a table to fetch EVERY row. Appwrite caps a single request
// (default 25, max 100), so callers that expect the full collection must page
// through it — otherwise large libraries/histories get silently truncated.
// `baseQueries` must include the sort order (needed for stable cursoring) and
// any filters, but NOT a limit.
async function listAllRows<T>(tableId: string, baseQueries: any[] = []): Promise<T[]> {
  const all: T[] = []
  let cursor: string | undefined
  for (;;) {
    const queries = [...baseQueries, Query.limit(100)]
    if (cursor) queries.push(Query.cursorAfter(cursor))
    const response = await tablesDB.listRows({ databaseId: DATABASE_ID, tableId, queries })
    const rows = response.rows as unknown as T[]
    all.push(...rows)
    if (rows.length < 100) break
    cursor = (rows[rows.length - 1] as any).$id
  }
  return all
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

const APPWRITE_ENDPOINT  = "https://nyc.cloud.appwrite.io/v1"
const APPWRITE_PROJECT   = "689e515d000c2e1af428"

/**
 * Upload a local image URI to Appwrite Storage and return the public view URL.
 * Uses fetch + FormData directly because the Appwrite web SDK does not handle
 * React Native's { uri, name, type } file format in its createFile method.
 * The bucket must have "Read" for "Any" role so the URL works in <Image />.
 */
export async function uploadPhoto(localUri: string): Promise<string> {
  const fileId = ID.unique()
  const ext    = localUri.split(".").pop()?.split("?")[0]?.toLowerCase() ?? "jpg"
  const mime   = ext === "png" ? "image/png" : "image/jpeg"

  const body = new FormData()
  body.append("fileId", fileId)
  body.append("file", { uri: localUri, name: `${fileId}.${ext}`, type: mime } as any)

  // No JWT — the session cookie is sent automatically by React Native's
  // HTTP stack and is enough for authentication. Adding JWT on top of it
  // causes Appwrite to reject the request (403 user_jwt_and_cookie_set).
  const res = await fetch(
    `${APPWRITE_ENDPOINT}/storage/buckets/${MEDIA_BUCKET_ID}/files`,
    {
      method: "POST",
      headers: {
        "X-Appwrite-Project": APPWRITE_PROJECT,
      },
      body,
    }
  )

  if (!res.ok) {
    const msg = await res.text().catch(() => res.status.toString())
    throw new Error(`Upload failed: ${msg}`)
  }

  const data = await res.json()
  return `${APPWRITE_ENDPOINT}/storage/buckets/${MEDIA_BUCKET_ID}/files/${data.$id}/view?project=${APPWRITE_PROJECT}`
}

/**
 * Delete a file from Appwrite Storage by its view URL.
 * Silently ignores errors (best-effort cleanup).
 */
export async function deleteStorageFile(fileUrl: string): Promise<void> {
  const match = fileUrl.match(/\/files\/([^/?]+)/)
  if (!match) return
  const fileId = match[1]
  const res = await fetch(
    `${APPWRITE_ENDPOINT}/storage/buckets/${MEDIA_BUCKET_ID}/files/${fileId}`,
    { method: "DELETE", headers: { "X-Appwrite-Project": APPWRITE_PROJECT } }
  )
  if (!res.ok) {
    const msg = await res.text().catch(() => res.status.toString())
    throw new Error(`Delete failed (${res.status}): ${msg}`)
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type UserRole = "coach" | "athlete"

export interface AppUser {
  $id: string
  $createdAt: string
  role: UserRole
  username: string
  assignedProtocolId: string | null
  [key: string]: any
}

export interface ProtocolRow {
  $id: string
  $createdAt: string
  name: string
  blocks: string
}

export interface BlockRow {
  $id: string
  $createdAt: string
  type: string
  name: string
  data: string // JSON stringified block config
}

// ─── Boulder ──────────────────────────────────────────────────────────────────

export async function getBoulderLogs() {
  const userID = await account.get()
  let allRows: any[] = []
  let offset = 0
  const limit = 100
  while (true) {
    const result = await tablesDB.listRows({
      databaseId: DATABASE_ID,
      tableId: BOULDER_TABLE,
      queries: [Query.equal("userID", userID.$id), Query.limit(limit), Query.offset(offset)],
    })
    allRows = [...allRows, ...result.rows]
    if (result.rows.length < limit) break
    offset += limit
  }
  return allRows
}

export async function getBoulderLevels() {
  const result = await tablesDB.listRows({ databaseId: DATABASE_ID, tableId: LEVEL_TABLE })
  return result.rows
}

export async function logRecord(table_id: string, data: any, rowID?: string) {
  if (!rowID) rowID = ID.unique()
  try {
    return await tablesDB.createRow({ databaseId: DATABASE_ID, tableId: table_id, rowId: rowID, data })
  } catch (error) { console.log(error); throw error }
}

export async function useDeleteRow(table_id: string, rowID?: string) {
  if (!rowID) rowID = ID.unique()
  try {
    return await tablesDB.deleteRow({ databaseId: DATABASE_ID, tableId: table_id, rowId: rowID })
  } catch (error) { console.log(error); throw error }
}

export async function getUsers(id: string) {
  try {
    const result = await tablesDB.listRows({
      databaseId: DATABASE_ID,
      tableId: USERS_TABLE,
      queries: [Query.equal("$id", id)],
    })
    return result.rows[0]
  } catch (error) { console.log(error) }
}

export interface SessionRow {
  $id: string
  $createdAt: string
  userId: string
  protocol: string   // JSON stringified blocks array
  attempts: string   // JSON stringified attempts array
  // JSON stringified Record<blockIndex, seconds>. Optional in the schema —
  // older sessions may not have it.
  blockDurations?: string
}

export async function saveSession(data: any) {
  try {
    const user = await account.get()
    const payload = { ...data, userId: user.$id }
    try {
      return await tablesDB.createRow({
        databaseId: DATABASE_ID,
        tableId: SESSION_TABLE,
        rowId: ID.unique(),
        data: payload,
      })
    } catch (e: any) {
      // If the schema doesn't include `blockDurations` yet, retry without it
      // so the session still saves. The user can add the column in Appwrite
      // whenever and future sessions will include durations.
      if (payload.blockDurations !== undefined) {
        const { blockDurations: _bd, ...rest } = payload
        return await tablesDB.createRow({
          databaseId: DATABASE_ID,
          tableId: SESSION_TABLE,
          rowId: ID.unique(),
          data: rest,
        })
      }
      throw e
    }
  } catch (error) { console.error("Failed to save session", error) }
}

export async function getSessionsByUserId(userId: string): Promise<SessionRow[]> {
  return listAllRows<SessionRow>(SESSION_TABLE, [Query.equal("userId", userId), Query.orderDesc("$createdAt")])
}

export async function getSessions(): Promise<SessionRow[]> {
  const user = await account.get()
  return listAllRows<SessionRow>(SESSION_TABLE, [Query.equal("userId", user.$id), Query.orderDesc("$createdAt")])
}

export interface ProjectSessionSummary {
  date: string         // most recent session $createdAt for this project
  durationSec: number  // how long that session spent on this project (0 if unknown)
  totalSessions: number// how many past sessions worked this project
  attempts: number     // attempts on this project in that last session
  sends: number        // how many of them were successful
  sent: boolean        // sent at least once that session
  notes: string[]      // all notes across sessions (oldest first) for the AI recap
}

// Recap of the project's history: the most recent session (when, how long,
// attempts/sends), how many sessions total, and every note ever left on it.
// Returns null if the project has never been worked.
export async function getLastProjectSession(projectId: string): Promise<ProjectSessionSummary | null> {
  const sessions = await getSessions() // already ordered newest first
  let totalSessions = 0
  let last: ProjectSessionSummary | null = null
  const notesNewestFirst: string[] = []

  for (const s of sessions) {
    let arr: any[] = []
    try { arr = JSON.parse(s.attempts || "[]") } catch { continue }
    const proj = arr.filter((a) => a?.projectId === projectId)
    if (proj.length === 0) continue
    totalSessions++
    for (const a of proj) {
      if (a?.notes && String(a.notes).trim()) notesNewestFirst.push(String(a.notes).trim())
    }

    if (!last) {
      // First match while iterating newest→oldest = the most recent session.
      const sends = proj.filter((a) => a?.success).length
      let durationSec = 0
      try {
        const bd = s.blockDurations ? JSON.parse(s.blockDurations) : null
        if (bd) {
          const idxs = new Set(proj.map((a) => a?.blockIndex).filter((i) => i != null))
          for (const i of idxs) durationSec += Number(bd[String(i)]) || 0
        }
      } catch { /* ignore */ }
      if (!durationSec) {
        const ts = proj.map((a) => a?.timestamp).filter((t) => typeof t === "number")
        if (ts.length >= 2) durationSec = Math.max(0, Math.round((Math.max(...ts) - Math.min(...ts)) / 1000))
      }
      last = { date: s.$createdAt, durationSec, totalSessions: 0, attempts: proj.length, sends, sent: sends > 0, notes: [] }
    }
  }

  if (!last) return null
  last.totalSessions = totalSessions
  last.notes = notesNewestFirst.reverse() // oldest first for the AI
  return last
}

export async function deleteSession(id: string): Promise<void> {
  await tablesDB.deleteRow({ databaseId: DATABASE_ID, tableId: SESSION_TABLE, rowId: id })
}

export async function updateSession(id: string, data: { attempts?: string; protocol?: string; blockDurations?: string }): Promise<SessionRow> {
  const response = await tablesDB.updateRow({
    databaseId: DATABASE_ID,
    tableId: SESSION_TABLE,
    rowId: id,
    data,
  })
  return response as unknown as SessionRow
}

// ─── Users / roles ────────────────────────────────────────────────────────────

export async function setUserRole(userId: string, role: UserRole) {
  return tablesDB.updateRow({ databaseId: DATABASE_ID, tableId: USERS_TABLE, rowId: userId, data: { role } })
}

export async function deleteAthlete(userId: string): Promise<void> {
  // Removes the athlete's profile row. The Appwrite auth account itself
  // can only be deleted by an admin SDK / server function — handled
  // separately if/when needed.
  await tablesDB.deleteRow({
    databaseId: DATABASE_ID,
    tableId: USERS_TABLE,
    rowId: userId,
  })
}

export async function getAthletes(): Promise<AppUser[]> {
  const result = await tablesDB.listRows({
    databaseId: DATABASE_ID,
    tableId: USERS_TABLE,
    //queries: [Query.equal("role", "athlete")],
  })
  return result.rows as unknown as AppUser[]
}

export async function assignProtocol(userId: string, protocolId: string): Promise<void> {
  await tablesDB.updateRow({
    databaseId: DATABASE_ID,
    tableId: USERS_TABLE,
    rowId: userId,
    data: { assignedProtocolId: protocolId },
  })
}

export async function getAssignedProtocol(userId: string): Promise<ProtocolRow | null> {
  const user = await getUsers(userId) as unknown as AppUser
  if (!user?.assignedProtocolId) return null
  const protocol = await tablesDB.getRow({
    databaseId: DATABASE_ID,
    tableId: PROTOCOLS_TABLE,
    rowId: user.assignedProtocolId,
  })
  return protocol as unknown as ProtocolRow
}

// ─── Protocols ────────────────────────────────────────────────────────────────

export async function listProtocols(): Promise<ProtocolRow[]> {
  return listAllRows<ProtocolRow>(PROTOCOLS_TABLE, [Query.orderDesc("$createdAt")])
}

export async function createProtocol(input: { name: string; blocks: any[] }): Promise<ProtocolRow> {
  const response = await tablesDB.createRow({
    databaseId: DATABASE_ID,
    tableId: PROTOCOLS_TABLE,
    rowId: ID.unique(),
    data: { name: input.name, blocks: JSON.stringify(input.blocks) },
  })
  return response as unknown as ProtocolRow
}

export async function updateProtocol(id: string, input: { name: string; blocks: any[] }): Promise<ProtocolRow> {
  const response = await tablesDB.updateRow({
    databaseId: DATABASE_ID,
    tableId: PROTOCOLS_TABLE,
    rowId: id,
    data: { name: input.name, blocks: JSON.stringify(input.blocks) },
  })
  return response as unknown as ProtocolRow
}

export async function deleteProtocol(id: string): Promise<void> {
  await tablesDB.deleteRow({ databaseId: DATABASE_ID, tableId: PROTOCOLS_TABLE, rowId: id })
}

// ─── Block library ────────────────────────────────────────────────────────────

export async function listBlocks(): Promise<BlockRow[]> {
  return listAllRows<BlockRow>(BLOCKS_TABLE, [Query.orderDesc("$createdAt")])
}

export async function listBlocksByType(type: string): Promise<BlockRow[]> {
  return listAllRows<BlockRow>(BLOCKS_TABLE, [Query.equal("type", type), Query.orderDesc("$createdAt")])
}

export async function saveBlockToLibrary(input: {
  name: string
  type: string
  data: any
}): Promise<BlockRow> {
  const response = await tablesDB.createRow({
    databaseId: DATABASE_ID,
    tableId: BLOCKS_TABLE,
    rowId: ID.unique(),
    data: { name: input.name, type: input.type, data: JSON.stringify(input.data) },
  })
  return response as unknown as BlockRow
}

export async function updateBlock(id: string, input: { name: string; type: string; data: any }): Promise<BlockRow> {
  const response = await tablesDB.updateRow({
    databaseId: DATABASE_ID,
    tableId: BLOCKS_TABLE,
    rowId: id,
    data: { name: input.name, type: input.type, data: JSON.stringify(input.data) },
  })
  return response as unknown as BlockRow
}

/**
 * Create the template, or overwrite an existing template that has the
 * same name AND type. Returns the resulting row.
 */
export async function upsertBlockTemplate(input: {
  name: string
  type: string
  data: any
}): Promise<{ row: BlockRow; replaced: boolean }> {
  const existing = await listBlocks()
  const match = existing.find((b) => b.name === input.name && b.type === input.type)
  if (match) {
    const row = await updateBlock(match.$id, input)
    return { row, replaced: true }
  }
  const row = await saveBlockToLibrary(input)
  return { row, replaced: false }
}

export async function deleteBlock(id: string): Promise<void> {
  await tablesDB.deleteRow({ databaseId: DATABASE_ID, tableId: BLOCKS_TABLE, rowId: id })
}

// ─── Exercise library ─────────────────────────────────────────────────────────

export const EXERCISES_TABLE = "exercises"

export interface ExerciseRow {
  $id: string
  $createdAt: string
  name: string
  type: "reps" | "both_sides" | "7/3s"
  unit?: "reps" | "seconds"  // how the amount is measured; defaults to reps
  defaultReps?: string
  defaultEdge?: string
  defaultSeries?: number
}

export async function listExercises(): Promise<ExerciseRow[]> {
  return listAllRows<ExerciseRow>(EXERCISES_TABLE, [Query.orderAsc("name")])
}

export async function createExercise(input: {
  name: string
  type: "reps" | "both_sides" | "7/3s"
  unit?: "reps" | "seconds"
  defaultReps?: string
  defaultEdge?: string
  defaultSeries?: number
}): Promise<ExerciseRow> {
  try {
    const response = await tablesDB.createRow({
      databaseId: DATABASE_ID,
      tableId: EXERCISES_TABLE,
      rowId: ID.unique(),
      data: input,
    })
    return response as unknown as ExerciseRow
  } catch (e) {
    // The `unit` column may not exist yet — retry without it so the app keeps
    // working until the column is added in Appwrite. We still merge the unit
    // back into the returned object so the caller (and the block it's added to,
    // which stores exercises as JSON) remembers it even though the library row
    // didn't persist it.
    if (input.unit === undefined) throw e
    const { unit, ...rest } = input
    const response = await tablesDB.createRow({
      databaseId: DATABASE_ID,
      tableId: EXERCISES_TABLE,
      rowId: ID.unique(),
      data: rest,
    })
    return { ...(response as unknown as ExerciseRow), unit }
  }
}

export async function deleteExercise(id: string): Promise<void> {
  await tablesDB.deleteRow({ databaseId: DATABASE_ID, tableId: EXERCISES_TABLE, rowId: id })
}
// ─── Spray routes ─────────────────────────────────────────────────────────────

// ─── Spray walls ──────────────────────────────────────────────────────────────

export interface SprayWallRow {
  $id: string
  $createdAt: string
  name: string
  imageUri: string   // local file:// path to the wall photo
  width?: number     // natural photo dimensions, so the viewer knows the aspect
  height?: number    // ratio from the first frame (no measuring needed)
}

export async function getSprayWall(id: string): Promise<SprayWallRow | null> {
  try {
    const response = await tablesDB.getRow({
      databaseId: DATABASE_ID,
      tableId: SPRAY_WALLS_TABLE,
      rowId: id,
    })
    return response as unknown as SprayWallRow
  } catch {
    return null
  }
}

export async function getSprayWalls(): Promise<SprayWallRow[]> {
  return listAllRows<SprayWallRow>(SPRAY_WALLS_TABLE, [Query.orderAsc("$createdAt")])
}

export async function createSprayWall(name: string, imageUri: string, width?: number, height?: number): Promise<SprayWallRow> {
  const data: any = { name, imageUri }
  if (width) data.width = width
  if (height) data.height = height
  try {
    const response = await tablesDB.createRow({
      databaseId: DATABASE_ID, tableId: SPRAY_WALLS_TABLE, rowId: ID.unique(), data,
    })
    return response as unknown as SprayWallRow
  } catch (e) {
    // Table may not have width/height columns yet — retry with the core fields.
    const response = await tablesDB.createRow({
      databaseId: DATABASE_ID, tableId: SPRAY_WALLS_TABLE, rowId: ID.unique(), data: { name, imageUri },
    })
    return response as unknown as SprayWallRow
  }
}

export async function deleteSprayWall(id: string): Promise<void> {
  await tablesDB.deleteRow({ databaseId: DATABASE_ID, tableId: SPRAY_WALLS_TABLE, rowId: id })
}

export interface SprayRouteRow {
  $id: string
  $createdAt: string
  name: string
  holds: string      // JSON stringified PlacedHold[] — mirrors the original variation
  wallId?: string    // optional — routes without wallId show under "All"
  level?: number     // absolute difficulty 1–8
  type?: string      // route type: "base" | "max_bouldering" | …
  variations?: string // JSON { easy?, original, hard? } of PlacedHold[]
}

export interface SprayRouteExtras {
  level?: number
  type?: string
  variations?: { easy?: any[]; original: any[]; hard?: any[] }
}

function buildRouteData(name: string, holds: any[], wallId?: string, extras?: SprayRouteExtras) {
  const data: any = { name, holds: JSON.stringify(holds) }
  if (wallId) data.wallId = wallId
  if (extras?.level != null) data.level = extras.level
  if (extras?.type) data.type = extras.type
  if (extras?.variations) data.variations = JSON.stringify(extras.variations)
  return data
}

// The route table may not have the level/type/variations columns yet — retry
// with just the core fields so the route still saves while the schema catches up.
function coreRouteData(data: any) {
  const core: any = { name: data.name, holds: data.holds }
  if (data.wallId) core.wallId = data.wallId
  return core
}

// Resize a wall photo to a small server-side preview. Appwrite's /preview
// transformations are a paid feature and return blank on the current plan, so
// this is disabled (returns the original URL). expo-image caching still applies.
// To actually shrink images, resize them on upload (expo-image-manipulator).
const IMAGE_TRANSFORMS_ENABLED = false
export function wallPreviewUrl(uri: string | undefined, width: number): string | undefined {
  if (!IMAGE_TRANSFORMS_ENABLED || !uri || typeof uri !== "string") return uri
  const m = uri.match(/\/files\/([^/?]+)\//)
  if (!m) return uri
  const fileId = m[1]
  return `${APPWRITE_ENDPOINT}/storage/buckets/${MEDIA_BUCKET_ID}/files/${fileId}/preview?project=${APPWRITE_PROJECT}&width=${Math.round(width)}&quality=70&output=webp`
}

export async function getSprayRoute(id: string): Promise<SprayRouteRow> {
  const response = await tablesDB.getRow({
    databaseId: DATABASE_ID,
    tableId: SPRAY_ROUTES_TABLE,
    rowId: id,
  })
  return response as unknown as SprayRouteRow
}

export async function getSprayRoutes(wallId?: string): Promise<SprayRouteRow[]> {
  const base = [Query.orderDesc("$createdAt")]
  if (wallId) base.push(Query.equal("wallId", wallId))
  return listAllRows<SprayRouteRow>(SPRAY_ROUTES_TABLE, base)
}

export async function saveSprayRoute(name: string, holds: any[], wallId?: string, extras?: SprayRouteExtras): Promise<SprayRouteRow> {
  const data = buildRouteData(name, holds, wallId, extras)
  try {
    const response = await tablesDB.createRow({
      databaseId: DATABASE_ID, tableId: SPRAY_ROUTES_TABLE, rowId: ID.unique(), data,
    })
    return response as unknown as SprayRouteRow
  } catch (e) {
    const response = await tablesDB.createRow({
      databaseId: DATABASE_ID, tableId: SPRAY_ROUTES_TABLE, rowId: ID.unique(), data: coreRouteData(data),
    })
    return response as unknown as SprayRouteRow
  }
}

export async function updateSprayRoute(id: string, name: string, holds: any[], extras?: SprayRouteExtras): Promise<SprayRouteRow> {
  const data = buildRouteData(name, holds, undefined, extras)
  try {
    const response = await tablesDB.updateRow({
      databaseId: DATABASE_ID, tableId: SPRAY_ROUTES_TABLE, rowId: id, data,
    })
    return response as unknown as SprayRouteRow
  } catch (e) {
    const response = await tablesDB.updateRow({
      databaseId: DATABASE_ID, tableId: SPRAY_ROUTES_TABLE, rowId: id, data: coreRouteData(data),
    })
    return response as unknown as SprayRouteRow
  }
}

export async function deleteSprayRoute(id: string): Promise<void> {
  await tablesDB.deleteRow({ databaseId: DATABASE_ID, tableId: SPRAY_ROUTES_TABLE, rowId: id })
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export const PROJECTS_TABLE = "projects"

export type ProjectStatus = "active" | "sent" | "failed"
export type ProjectLocation = "slab" | "vertical_wall_1" | "vertical_wall_2" | "overhang"

export interface ProjectRow {
  $id: string
  $createdAt: string
  userId: string
  name: string
  grade: string
  imageUri?: string
  dueDate: string        // "YYYY-MM-DD"
  location: ProjectLocation
  status: ProjectStatus
}

export async function listProjects(): Promise<ProjectRow[]> {
  const user = await account.get()
  return listAllRows<ProjectRow>(PROJECTS_TABLE, [Query.equal("userId", user.$id), Query.orderDesc("$createdAt")])
}

export async function getProjectById(id: string): Promise<ProjectRow | null> {
  try {
    const row = await tablesDB.getRow({
      databaseId: DATABASE_ID,
      tableId: PROJECTS_TABLE,
      rowId: id,
    })
    return row as unknown as ProjectRow
  } catch {
    return null
  }
}

export async function createProject(input: {
  name: string
  grade: string
  imageUri?: string
  dueDate: string
  location: ProjectLocation
}): Promise<ProjectRow> {
  const user = await account.get()
  const response = await tablesDB.createRow({
    databaseId: DATABASE_ID,
    tableId: PROJECTS_TABLE,
    rowId: ID.unique(),
    data: { ...input, userId: user.$id, status: "active" },
  })
  return response as unknown as ProjectRow
}

export async function updateProject(id: string, data: Partial<Pick<ProjectRow, "imageUri" | "name" | "grade" | "dueDate" | "location" | "status">>): Promise<void> {
  await tablesDB.updateRow({ databaseId: DATABASE_ID, tableId: PROJECTS_TABLE, rowId: id, data })
}

export async function markProjectSent(id: string): Promise<void> {
  await tablesDB.updateRow({
    databaseId: DATABASE_ID,
    tableId: PROJECTS_TABLE,
    rowId: id,
    data: { status: "sent" },
  })
}

export async function markProjectFailed(id: string): Promise<void> {
  await tablesDB.updateRow({
    databaseId: DATABASE_ID,
    tableId: PROJECTS_TABLE,
    rowId: id,
    data: { status: "failed" },
  })
}

export async function deleteProject(id: string): Promise<void> {
  await tablesDB.deleteRow({
    databaseId: DATABASE_ID,
    tableId: PROJECTS_TABLE,
    rowId: id,
  })
}
