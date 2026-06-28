import { account, functions, tablesDB } from "@/components/AppWrite"
import { DATABASE_ID } from "@/services/BoulderGraphService"
import { ExecutionMethod, ID, Query } from "appwrite"
import * as FileSystem from "expo-file-system/legacy"

// Deployed Appwrite Function ID for the R2 presign function (fill after deploy).
export const VIDEO_PRESIGN_FUNCTION_ID = "6a3ed6810015d04807b4"

// Appwrite table holding only metadata — the video bytes live in Cloudflare R2.
export const VIDEOS_TABLE = "videos"

export interface VideoRow {
  $id: string
  $createdAt: string
  userId: string
  url: string          // public R2 playback URL
  key: string          // R2 object key (for later deletion / pruning)
  blockType?: string
  projectId?: string
  projectName?: string
  grade?: string
  durationSec?: number
}

export interface VideoMeta {
  blockType?: string
  projectId?: string
  projectName?: string
  grade?: string
  durationSec?: number
}

interface PresignResult { uploadUrl: string; publicUrl: string; key: string; contentType: string }

function extOf(uri: string): string {
  const m = /\.([a-zA-Z0-9]+)(?:\?|$)/.exec(uri)
  const ext = (m?.[1] ?? "mp4").toLowerCase()
  return ext === "mov" || ext === "m4v" ? ext : "mp4"
}

// Ask the function for a short-lived presigned PUT URL + the final public URL.
async function requestUploadUrl(ext: string): Promise<PresignResult> {
  if (!VIDEO_PRESIGN_FUNCTION_ID) throw new Error("Video upload is not configured yet.")
  const execution = await functions.createExecution({
    functionId: VIDEO_PRESIGN_FUNCTION_ID,
    body: JSON.stringify({ ext }),
    async: false,
    method: ExecutionMethod.POST,
  })
  if (execution.responseStatusCode < 200 || execution.responseStatusCode >= 300) {
    const payload = execution.responseBody ? JSON.parse(execution.responseBody) : {}
    throw new Error(payload?.error ?? `Presign failed (status ${execution.responseStatusCode})`)
  }
  return JSON.parse(execution.responseBody) as PresignResult
}

// Save the metadata row (the bytes are already in R2). userId is stamped server-side.
async function createVideoRow(url: string, key: string, meta: VideoMeta): Promise<VideoRow> {
  const user = await account.get()
  const data: any = { userId: user.$id, url, key }
  if (meta.blockType) data.blockType = meta.blockType
  if (meta.projectId) data.projectId = meta.projectId
  if (meta.projectName) data.projectName = meta.projectName
  if (meta.grade) data.grade = meta.grade
  if (meta.durationSec != null) data.durationSec = Math.round(meta.durationSec)
  const row = await tablesDB.createRow({
    databaseId: DATABASE_ID, tableId: VIDEOS_TABLE, rowId: ID.unique(), data,
  })
  return row as unknown as VideoRow
}

// Full pipeline: presign → PUT the file straight to R2 → record metadata.
// Throws on failure so callers can surface an "upload failed" state.
export async function uploadVideo(localUri: string, meta: VideoMeta): Promise<VideoRow> {
  const ext = extOf(localUri)
  const { uploadUrl, publicUrl, key, contentType } = await requestUploadUrl(ext)

  const result = await FileSystem.uploadAsync(uploadUrl, localUri, {
    httpMethod: "PUT",
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { "Content-Type": contentType },
  })
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`R2 upload failed (${result.status})`)
  }
  return createVideoRow(publicUrl, key, meta)
}

// Fire-and-forget upload used right after a clip is saved locally. Never throws
// and never blocks the workout — a failed or not-yet-configured upload is just
// logged. Returns immediately; the PUT happens in the background.
export function uploadVideoInBackground(localUri: string, meta: VideoMeta): void {
  if (!VIDEO_PRESIGN_FUNCTION_ID) return  // backend not wired up yet — skip silently
  uploadVideo(localUri, meta).catch((e) =>
    console.warn("[video] background upload to coach failed:", e?.message ?? e)
  )
}

// Coach: list a given athlete's clips, newest first.
export async function getVideosByUserId(userId: string): Promise<VideoRow[]> {
  const response = await tablesDB.listRows({
    databaseId: DATABASE_ID,
    tableId: VIDEOS_TABLE,
    queries: [Query.equal("userId", userId), Query.orderDesc("$createdAt"), Query.limit(100)],
  })
  return response.rows as unknown as VideoRow[]
}

// Athlete's own clips.
export async function getMyVideos(): Promise<VideoRow[]> {
  const user = await account.get()
  return getVideosByUserId(user.$id)
}

export async function deleteVideoRow(id: string): Promise<void> {
  await tablesDB.deleteRow({ databaseId: DATABASE_ID, tableId: VIDEOS_TABLE, rowId: id })
}

// Ask the function to delete the actual file from R2 (the device has no R2 keys).
async function deleteVideoObject(key: string): Promise<void> {
  if (!VIDEO_PRESIGN_FUNCTION_ID || !key) return
  const execution = await functions.createExecution({
    functionId: VIDEO_PRESIGN_FUNCTION_ID,
    body: JSON.stringify({ action: "delete", key }),
    async: false,
    method: ExecutionMethod.POST,
  })
  if (execution.responseStatusCode < 200 || execution.responseStatusCode >= 300) {
    const payload = execution.responseBody ? JSON.parse(execution.responseBody) : {}
    throw new Error(payload?.error ?? `R2 delete failed (status ${execution.responseStatusCode})`)
  }
}

// Coach: fully remove a clip — the metadata row and the R2 object. The row goes
// first (the user-visible part); R2 cleanup is best-effort so a transient R2
// failure can't block the delete or strand the row.
export async function deleteVideo(row: Pick<VideoRow, "$id" | "key">): Promise<void> {
  await deleteVideoRow(row.$id)
  deleteVideoObject(row.key).catch((e) => console.warn("[video] R2 object delete failed:", e?.message ?? e))
}
