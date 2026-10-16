import AsyncStorage from "@react-native-async-storage/async-storage"
import * as FileSystem from "expo-file-system/legacy"
import { useEffect, useState } from "react"
import { createVideoRow, putVideoObject, VIDEO_PRESIGN_FUNCTION_ID, VideoMeta } from "@/services/videoStorage"

// Clips waiting to reach the coach, persisted so a failed or interrupted
// upload (no signal at the gym, app backgrounded or killed mid-upload) is
// retried later instead of silently lost. Entries are keyed by the local
// filename in the video library folder — the absolute path isn't stored
// because iOS can move the app container between launches/updates.
//
// An upload is two steps: PUT the bytes to R2, then create the `videos` row
// the coach actually sees. The R2 object is recorded as soon as the PUT
// succeeds, so a failed row creation retries just that step instead of
// uploading the whole clip again (which would also orphan the first copy).

export type UploadStatus = "pending" | "uploading" | "uploaded" | "failed"

export interface QueuedUpload {
  filename: string
  meta: VideoMeta
  status: UploadStatus
  attempts: number
  createdAt: number
  nextAttemptAt?: number
  lastError?: string
  object?: { url: string; key: string }
  remoteId?: string
}

const STORAGE_KEY = "videoUploadQueue.v1"
// Uploaded entries are only kept so the Library can show "sent"; drop them
// after this long.
const KEEP_UPLOADED_MS = 30 * 24 * 60 * 60 * 1000
const MAX_BACKOFF_MS = 30 * 60 * 1000

export function videoDir(): string {
  return FileSystem.documentDirectory + "bouldervideos/"
}

let queue: QueuedUpload[] | null = null
const listeners = new Set<(q: QueuedUpload[]) => void>()
let processing: Promise<void> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null

async function load(): Promise<QueuedUpload[]> {
  if (queue) return queue
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    queue = raw ? JSON.parse(raw) : []
  } catch (e: any) {
    console.warn("[uploadQueue] could not read queue:", e?.message ?? e)
    queue = []
  }
  return queue!
}

async function save(next: QueuedUpload[]): Promise<void> {
  queue = next
  for (const l of listeners) l(next)
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch (e: any) {
    console.warn("[uploadQueue] could not persist queue:", e?.message ?? e)
  }
}

async function update(filename: string, patch: Partial<QueuedUpload>): Promise<void> {
  const q = await load()
  await save(q.map((e) => (e.filename === filename ? { ...e, ...patch } : e)))
}

function backoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS)
}

export async function enqueueVideoUpload(filename: string, meta: VideoMeta): Promise<void> {
  if (!VIDEO_PRESIGN_FUNCTION_ID) return
  const q = await load()
  if (q.some((e) => e.filename === filename)) return
  await save([...q, { filename, meta, status: "pending", attempts: 0, createdAt: Date.now() }])
  processUploadQueue()
}

// The athlete deleted the local clip — stop trying to send it.
export async function removeFromUploadQueue(filename: string): Promise<void> {
  const q = await load()
  if (!q.some((e) => e.filename === filename)) return
  await save(q.filter((e) => e.filename !== filename))
}

// Manual "retry now" from the Library: skip the backoff wait.
export async function retryUpload(filename: string): Promise<void> {
  await update(filename, { status: "pending", nextAttemptAt: undefined })
  processUploadQueue()
}

// Safe to call any time (app start, foreground, after enqueue): runs at most
// one pass at once, and a call during a pass just joins it. `ignoreBackoff`
// retries failed uploads right away — used when the app comes back to the
// foreground, the likeliest moment the connection is back.
export function processUploadQueue(options?: { ignoreBackoff?: boolean }): Promise<void> {
  if (!processing) {
    processing = runQueue(options?.ignoreBackoff ?? false).finally(() => {
      processing = null
      scheduleNextRetry()
    })
  }
  return processing
}

async function runQueue(ignoreBackoff: boolean): Promise<void> {
  const now = Date.now()
  const initial = await load()
  // Anything still "uploading" here was cut off by the app being killed
  // during a previous pass — it's pending again.
  await save(
    initial
      .filter((e) => e.status !== "uploaded" || now - e.createdAt < KEEP_UPLOADED_MS)
      .map((e) => (e.status === "uploading" ? { ...e, status: "pending" as const } : e)),
  )

  for (const entry of [...(queue ?? [])]) {
    if (entry.status === "uploaded") continue
    if (!ignoreBackoff && entry.nextAttemptAt && entry.nextAttemptAt > Date.now()) continue
    // Removed (deleted by the athlete) while an earlier entry was uploading.
    if (!queue?.some((e) => e.filename === entry.filename)) continue

    const localUri = videoDir() + entry.filename
    const info = await FileSystem.getInfoAsync(localUri).catch(() => null)
    if (!info?.exists) {
      console.warn("[uploadQueue] local file is gone, dropping:", entry.filename)
      await removeFromUploadQueue(entry.filename)
      continue
    }

    await update(entry.filename, { status: "uploading" })
    try {
      let object = entry.object
      if (!object) {
        object = await putVideoObject(localUri)
        await update(entry.filename, { object })
      }
      let remoteId: string
      try {
        remoteId = (await createVideoRow(object.url, object.key, entry.meta)).$id
      } catch (e: any) {
        // A caller-chosen rowId (project attempts link to it) already exists:
        // an earlier attempt created the row but its response never arrived.
        if (entry.meta.rowId && e?.code === 409) remoteId = entry.meta.rowId
        else throw e
      }
      await update(entry.filename, { status: "uploaded", remoteId, lastError: undefined, nextAttemptAt: undefined })
      console.log("[uploadQueue] sent to coach:", entry.filename)
    } catch (e: any) {
      const attempts = entry.attempts + 1
      console.warn("[uploadQueue] upload failed (attempt", attempts, "):", entry.filename, e?.message ?? e)
      await update(entry.filename, {
        status: "failed",
        attempts,
        lastError: String(e?.message ?? e),
        nextAttemptAt: Date.now() + backoffMs(attempts),
      })
    }
  }
}

function scheduleNextRetry() {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  // Retried or enqueued while a pass was already past it.
  if ((queue ?? []).some((e) => e.status === "pending")) {
    retryTimer = setTimeout(() => { processUploadQueue() }, 1000)
    return
  }
  const next = (queue ?? [])
    .filter((e) => e.status === "failed" && e.nextAttemptAt)
    .reduce<number | null>((min, e) => (min == null || e.nextAttemptAt! < min ? e.nextAttemptAt! : min), null)
  if (next == null) return
  retryTimer = setTimeout(() => { processUploadQueue() }, Math.max(1000, next - Date.now()))
}

// Live view of the queue for UI (Library status badges).
export function useUploadQueue(): QueuedUpload[] {
  const [state, setState] = useState<QueuedUpload[]>(queue ?? [])
  useEffect(() => {
    listeners.add(setState)
    load().then(setState)
    return () => { listeners.delete(setState) }
  }, [])
  return state
}
