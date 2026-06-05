import { account, functions, tablesDB } from "@/components/AppWrite"
import { DATABASE_ID } from "@/services/BoulderGraphService"
import { ExecutionMethod, ID, Query } from "appwrite"
import * as FileSystem from "expo-file-system/legacy"

// Deployed Appwrite Function ID for the R2 presign function (fill after deploy).
export const VIDEO_PRESIGN_FUNCTION_ID = ""

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
    throw new Error(payload?.error ?? "Could not prepare the upload.")
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
