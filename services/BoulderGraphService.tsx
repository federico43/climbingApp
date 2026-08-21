import { account, tablesDB, storage, functions } from "@/components/AppWrite"
import { ExecutionMethod, ID, Query } from "appwrite"
import * as FileSystem from "expo-file-system/legacy"

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
// Table must exist in Appwrite with columns: userId (string), date (string,
// "YYYY-MM-DD"), restRating (integer, 1-5), ate (boolean)
export const CHECKIN_TABLE = "checkins"

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
// Photos (spray wall / project / exercise images) upload straight to Cloudflare
// R2 via a presigned URL — same pipeline and the same Appwrite Function as
// video (see services/videoStorage.ts), just with kind: "image". The bytes
// never pass through Appwrite, so they don't count against its bandwidth quota.

// Same Appwrite Function as VIDEO_PRESIGN_FUNCTION_ID in services/videoStorage.ts
// (kept as its own constant here to avoid a circular import — videoStorage.ts
// already imports DATABASE_ID from this file).
const PHOTO_PRESIGN_FUNCTION_ID = "6a3ed6810015d04807b4"

// Project cover photos and exercise demo photos uploaded before the R2 switch
// are still sitting in Appwrite Storage (spray wall photos are already fully
// migrated — see scripts/migrate-photos-to-r2). Rather than keep paying
// Appwrite bandwidth to serve those until they're migrated too, blank them
// out here so every screen's existing `photoUri ? <Image/> : <fallback>`
// check just renders the fallback instead.
function isAppwriteStorageUrl(url?: string): boolean {
  return typeof url === "string" && url.includes("/storage/buckets/")
}
function hideAppwriteHostedPhoto<T>(row: T, field: keyof T): T {
  const url = row[field] as unknown as string | undefined
  return isAppwriteStorageUrl(url) ? { ...row, [field]: undefined } : row
}

interface PhotoPresignResult { uploadUrl: string; publicUrl: string; contentType: string }

async function requestPhotoUploadUrl(ext: string): Promise<PhotoPresignResult> {
  const execution = await functions.createExecution({
    functionId: PHOTO_PRESIGN_FUNCTION_ID,
    body: JSON.stringify({ ext, kind: "image" }),
    async: false,
    method: ExecutionMethod.POST,
  })
  if (execution.responseStatusCode < 200 || execution.responseStatusCode >= 300) {
    const payload = execution.responseBody ? JSON.parse(execution.responseBody) : {}
    throw new Error(payload?.error ?? `Presign failed (status ${execution.responseStatusCode})`)
  }
  return JSON.parse(execution.responseBody) as PhotoPresignResult
}

/**
 * Upload a local image URI straight to R2 (presigned PUT) and return the
 * public playback URL. Replaces the old Appwrite Storage upload — same
 * signature, so every call site (sprayWall, projects, exercises) is unchanged.
 */
export async function uploadPhoto(localUri: string): Promise<string> {
  const m   = /\.([a-zA-Z0-9]+)(?:\?|$)/.exec(localUri)
  const ext = (m?.[1] ?? "jpg").toLowerCase()
  const { uploadUrl, publicUrl, contentType } = await requestPhotoUploadUrl(ext)

  const result = await FileSystem.uploadAsync(uploadUrl, localUri, {
    httpMethod: "PUT",
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { "Content-Type": contentType },
  })
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`R2 upload failed (${result.status})`)
  }
  return publicUrl
}

/**
 * Delete an R2-hosted photo by its public URL. Photo tables only store the
 * URL (no separate key column like `videos` has), so the function derives
 * the R2 object key server-side from R2_PUBLIC_BASE. Best-effort — callers
 * already treat this as fire-and-forget cleanup.
 */
export async function deleteStorageFile(fileUrl: string): Promise<void> {
  if (!fileUrl) return
  const execution = await functions.createExecution({
    functionId: PHOTO_PRESIGN_FUNCTION_ID,
    body: JSON.stringify({ action: "delete", kind: "image", url: fileUrl }),
    async: false,
    method: ExecutionMethod.POST,
  })
  if (execution.responseStatusCode < 200 || execution.responseStatusCode >= 300) {
    const payload = execution.responseBody ? JSON.parse(execution.responseBody) : {}
    throw new Error(payload?.error ?? `Delete failed (status ${execution.responseStatusCode})`)
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
  assignedAt?: string | null   // YYYY-MM-DD the coach assigned the protocol
  [key: string]: any
}

export interface ProtocolRow {
  $id: string
  $createdAt: string
  name: string
  blocks: string
  athleteId?: string | null   // owner athlete — a "template" belongs to one athlete
  // Missing/undefined athleteId → a global library workout, browsable by any athlete.
  // On an athlete-owned row: "library" means the athlete saved it themselves from
  // the library (shown separately on Home, freely editable/deletable by them);
  // anything else (incl. missing, for pre-existing rows) means the coach assigned it.
  source?: "coach" | "library" | null
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

// `forUserId` lets a coach log a session on behalf of an athlete — omit it
// to save under the logged-in user (the normal self-logging path).
export async function saveSession(data: any, forUserId?: string) {
  try {
    const userId = forUserId ?? (await account.get()).$id
    const payload = { ...data, userId }
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

// ─── Daily check-in ───────────────────────────────────────────────────────────

export interface CheckinRow {
  $id: string
  $createdAt: string
  userId: string
  date: string        // "YYYY-MM-DD", local calendar day the check-in is for
  restRating: number  // 1 (exhausted) – 5 (fully rested)
  ate: boolean
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

// Null when the athlete hasn't checked in yet today (or the lookup fails —
// treated as "not checked in" so the prompt can still surface).
export async function getCheckinForToday(userId: string): Promise<CheckinRow | null> {
  try {
    const result = await tablesDB.listRows({
      databaseId: DATABASE_ID,
      tableId: CHECKIN_TABLE,
      queries: [Query.equal("userId", userId), Query.equal("date", todayStr()), Query.limit(1)],
    })
    const row = result.rows[0] as any
    if (!row) return null
    // restRating/ate are stored as strings in Appwrite (schema constraint) —
    // convert back to number/boolean at this boundary so callers get the
    // proper types.
    return { ...row, restRating: Number(row.restRating), ate: row.ate === "true" } as CheckinRow
  } catch (error) {
    console.error("Failed to load today's check-in", error)
    return null
  }
}

// Creates today's check-in, or updates it if the athlete already submitted
// one (e.g. filling it in later from Settings, then reopening to correct it).
export async function saveCheckin(restRating: number, ate: boolean): Promise<CheckinRow | undefined> {
  try {
    const user = await account.get()
    const existing = await getCheckinForToday(user.$id)
    const data = { userId: user.$id, date: todayStr(), restRating: String(restRating), ate: String(ate) }
    const row = existing
      ? await tablesDB.updateRow({ databaseId: DATABASE_ID, tableId: CHECKIN_TABLE, rowId: existing.$id, data })
      : await tablesDB.createRow({ databaseId: DATABASE_ID, tableId: CHECKIN_TABLE, rowId: ID.unique(), data })
    return { ...(row as any), restRating, ate } as CheckinRow
  } catch (error) {
    console.error("Failed to save check-in", error)
  }
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
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  try {
    await tablesDB.updateRow({
      databaseId: DATABASE_ID,
      tableId: USERS_TABLE,
      rowId: userId,
      data: { assignedProtocolId: protocolId, assignedAt: today },
    })
  } catch (e) {
    // `assignedAt` column may not exist yet — fall back to just the protocol id.
    await tablesDB.updateRow({
      databaseId: DATABASE_ID,
      tableId: USERS_TABLE,
      rowId: userId,
      data: { assignedProtocolId: protocolId },
    })
  }
}

export async function unassignProtocol(userId: string): Promise<void> {
  await tablesDB.updateRow({
    databaseId: DATABASE_ID,
    tableId: USERS_TABLE,
    rowId: userId,
    data: { assignedProtocolId: null },
  })
}

export async function getAssignedProtocol(userId: string): Promise<(ProtocolRow & { assignedAt?: string | null }) | null> {
  const user = await getUsers(userId) as unknown as AppUser
  if (!user?.assignedProtocolId) return null
  const protocol = await tablesDB.getRow({
    databaseId: DATABASE_ID,
    tableId: PROTOCOLS_TABLE,
    rowId: user.assignedProtocolId,
  })
  // Surface when the coach assigned it so the athlete sees that day.
  return { ...(protocol as unknown as ProtocolRow), assignedAt: user.assignedAt ?? null }
}

// ─── Protocols ────────────────────────────────────────────────────────────────

export async function listProtocols(): Promise<ProtocolRow[]> {
  return listAllRows<ProtocolRow>(PROTOCOLS_TABLE, [Query.orderDesc("$createdAt")])
}

// Global workout library: protocols a coach explicitly published (no owning
// athlete AND tagged source: "library"). Requiring the explicit tag — not
// just a missing athleteId — keeps any orphaned/untagged row (legacy data,
// a failed save, anything that isn't a deliberate publish) out of the
// athlete-facing library.
export async function listLibraryWorkouts(): Promise<ProtocolRow[]> {
  try {
    return await listAllRows<ProtocolRow>(PROTOCOLS_TABLE, [
      Query.equal("source", "library"),
      Query.isNull("athleteId"),
      Query.orderDesc("$createdAt"),
    ])
  } catch {
    // Query.isNull may be unsupported for this attribute — filter client-side.
    const all = await listProtocols()
    return all.filter((p) => p.source === "library" && !p.athleteId)
  }
}

export async function createProtocol(
  input: { name: string; blocks: any[]; athleteId?: string; source?: "coach" | "library" },
): Promise<ProtocolRow> {
  const data: Record<string, any> = { name: input.name, blocks: JSON.stringify(input.blocks) }
  if (input.athleteId) data.athleteId = input.athleteId
  if (input.source) data.source = input.source
  const response = await tablesDB.createRow({
    databaseId: DATABASE_ID, tableId: PROTOCOLS_TABLE, rowId: ID.unique(), data,
  })
  return response as unknown as ProtocolRow
}

// An athlete's templates: protocols tagged with their id. Lazily migrates the
// athlete's currently-assigned (legacy, untagged) protocol into the set, so
// existing assignments carry over the first time the coach opens the athlete.
export async function listAthleteTemplates(
  athleteId: string,
  opts?: { migrate?: boolean },
): Promise<ProtocolRow[]> {
  // The coach may tag a legacy assigned protocol on read (migrate); the athlete
  // app is read-only (it may lack write permission on protocols).
  const migrate = opts?.migrate ?? true
  let tagged: ProtocolRow[] = []
  try {
    tagged = await listAllRows<ProtocolRow>(PROTOCOLS_TABLE, [
      Query.equal("athleteId", athleteId),
      Query.orderAsc("$createdAt"),
    ])
  } catch {
    tagged = [] // athleteId column not present yet
  }

  try {
    const user = (await getUsers(athleteId)) as unknown as AppUser
    const assignedId = user?.assignedProtocolId
    if (assignedId && !tagged.some((p) => p.$id === assignedId)) {
      const proto = await tablesDB
        .getRow({ databaseId: DATABASE_ID, tableId: PROTOCOLS_TABLE, rowId: assignedId })
        .catch(() => null)
      if (proto) {
        if (migrate) {
          try {
            await tablesDB.updateRow({
              databaseId: DATABASE_ID, tableId: PROTOCOLS_TABLE, rowId: assignedId, data: { athleteId },
            })
          } catch { /* column missing / no write — show it anyway */ }
        }
        tagged = [{ ...(proto as unknown as ProtocolRow), athleteId }, ...tagged]
      }
    }
  } catch { /* ignore */ }

  return tagged
}

// Duplicate a protocol as a new template owned by another athlete.
export async function copyProtocolToAthlete(
  source: { name: string; blocks: string },
  targetAthleteId: string,
): Promise<ProtocolRow> {
  let blocks: any[] = []
  try { blocks = JSON.parse(source.blocks ?? "[]") } catch { blocks = [] }
  return createProtocol({ name: source.name, blocks, athleteId: targetAthleteId })
}

export async function updateProtocol(
  id: string,
  input: { name: string; blocks: any[]; source?: "coach" | "library" },
): Promise<ProtocolRow> {
  const data: Record<string, any> = { name: input.name, blocks: JSON.stringify(input.blocks) }
  if (input.source) data.source = input.source
  const response = await tablesDB.updateRow({
    databaseId: DATABASE_ID, tableId: PROTOCOLS_TABLE, rowId: id, data,
  })
  return response as unknown as ProtocolRow
}

export async function deleteProtocol(id: string): Promise<void> {
  await tablesDB.deleteRow({ databaseId: DATABASE_ID, tableId: PROTOCOLS_TABLE, rowId: id })
}

// ─── Block library ────────────────────────────────────────────────────────────

export async function listBlocks(): Promise<BlockRow[]> {
  return listAllRows<BlockRow>(BLOCKS_TABLE, [Query.orderAsc("name")])
}

export async function listBlocksByType(type: string): Promise<BlockRow[]> {
  return listAllRows<BlockRow>(BLOCKS_TABLE, [Query.equal("type", type), Query.orderAsc("name")])
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
  photoUri?: string  // cloud URL (from uploadPhoto) showing how to perform the exercise
  notes?: string     // coach's notes on correct form / cues
}

export async function listExercises(): Promise<ExerciseRow[]> {
  const rows = await listAllRows<ExerciseRow>(EXERCISES_TABLE, [Query.orderAsc("name")])
  return rows.map((row) => hideAppwriteHostedPhoto(row, "photoUri"))
}

type ExerciseInput = {
  name: string
  type: "reps" | "both_sides" | "7/3s"
  unit?: "reps" | "seconds"
  defaultReps?: string
  defaultEdge?: string
  defaultSeries?: number
  photoUri?: string
  notes?: string
}

export async function createExercise(input: ExerciseInput): Promise<ExerciseRow> {
  try {
    const response = await tablesDB.createRow({
      databaseId: DATABASE_ID,
      tableId: EXERCISES_TABLE,
      rowId: ID.unique(),
      data: input,
    })
    return response as unknown as ExerciseRow
  } catch (e) {
    // The `unit` / `photoUri` / `notes` columns may not exist yet — retry
    // without them so the app keeps working until the columns are added in
    // Appwrite. We still merge them back into the returned object so the
    // caller (and the block it's added to, which stores exercises as JSON)
    // remembers them even though the library row didn't persist them.
    if (input.unit === undefined && input.photoUri === undefined && input.notes === undefined) throw e
    const { unit, photoUri, notes, ...rest } = input
    const response = await tablesDB.createRow({
      databaseId: DATABASE_ID,
      tableId: EXERCISES_TABLE,
      rowId: ID.unique(),
      data: rest,
    })
    return { ...(response as unknown as ExerciseRow), unit, photoUri, notes }
  }
}

export async function updateExercise(id: string, input: ExerciseInput): Promise<ExerciseRow> {
  try {
    const response = await tablesDB.updateRow({
      databaseId: DATABASE_ID, tableId: EXERCISES_TABLE, rowId: id, data: input,
    })
    return response as unknown as ExerciseRow
  } catch (e) {
    if (input.unit === undefined && input.photoUri === undefined && input.notes === undefined) throw e
    const { unit, photoUri, notes, ...rest } = input
    const response = await tablesDB.updateRow({
      databaseId: DATABASE_ID, tableId: EXERCISES_TABLE, rowId: id, data: rest,
    })
    return { ...(response as unknown as ExerciseRow), unit, photoUri, notes }
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
  athleteId?: string // owner athlete — a self-built sequence belongs to one athlete.
                      // Missing/undefined → a coach/shared route (visible in Spray Wall).
}

export interface SprayRouteExtras {
  level?: number
  type?: string
  variations?: { easy?: any[]; original: any[]; hard?: any[] }
  athleteId?: string
}

function buildRouteData(name: string, holds: any[], wallId?: string, extras?: SprayRouteExtras) {
  const data: any = { name, holds: JSON.stringify(holds) }
  if (wallId) data.wallId = wallId
  if (extras?.level != null) data.level = extras.level
  if (extras?.type) data.type = extras.type
  if (extras?.variations) data.variations = JSON.stringify(extras.variations)
  if (extras?.athleteId) data.athleteId = extras.athleteId
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
// Only ever mattered for legacy Appwrite-hosted photo URLs anyway — new
// uploads go straight to R2 (uploadPhoto, above), which has no equivalent
// transform endpoint, so this is a no-op for those regardless of the flag.
const IMAGE_TRANSFORMS_ENABLED = false
const LEGACY_APPWRITE_ENDPOINT = "https://nyc.cloud.appwrite.io/v1"
const LEGACY_APPWRITE_PROJECT  = "689e515d000c2e1af428"
export function wallPreviewUrl(uri: string | undefined, width: number): string | undefined {
  if (!IMAGE_TRANSFORMS_ENABLED || !uri || typeof uri !== "string") return uri
  const m = uri.match(/\/files\/([^/?]+)\//)
  if (!m) return uri
  const fileId = m[1]
  return `${LEGACY_APPWRITE_ENDPOINT}/storage/buckets/${MEDIA_BUCKET_ID}/files/${fileId}/preview?project=${LEGACY_APPWRITE_PROJECT}&width=${Math.round(width)}&quality=70&output=webp`
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

// Sequences an athlete built themselves (tagged with their id), newest first.
export async function getMySprayRoutes(athleteId: string): Promise<SprayRouteRow[]> {
  try {
    return await listAllRows<SprayRouteRow>(SPRAY_ROUTES_TABLE, [
      Query.equal("athleteId", athleteId),
      Query.orderDesc("$createdAt"),
    ])
  } catch {
    // athleteId column not present yet — filter client-side.
    const all = await getSprayRoutes()
    return all.filter((r) => r.athleteId === athleteId)
  }
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
  const rows = await listAllRows<ProjectRow>(PROJECTS_TABLE, [Query.equal("userId", user.$id), Query.orderDesc("$createdAt")])
  return rows.map((row) => hideAppwriteHostedPhoto(row, "imageUri"))
}

export async function getProjectById(id: string): Promise<ProjectRow | null> {
  try {
    const row = await tablesDB.getRow({
      databaseId: DATABASE_ID,
      tableId: PROJECTS_TABLE,
      rowId: id,
    })
    return hideAppwriteHostedPhoto(row as unknown as ProjectRow, "imageUri")
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
