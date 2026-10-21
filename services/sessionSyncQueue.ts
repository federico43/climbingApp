import { account } from "@/components/AppWrite"
import { saveSession } from "@/services/BoulderGraphService"
import { sendWorkoutCompletedNotification } from "@/services/notifications"
import { isNetworkError } from "@/utils/network"
import { flushPendingSessions, type PendingSession } from "@/utils/sessionQueue"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { ID } from "appwrite"
import { useEffect, useState } from "react"

// Finished workouts are written here first and only leave once Appwrite has
// the `sessions` row (and the coach has been pinged), so finishing a workout
// with no signal at the gym never loses it: the queue is retried on launch,
// whenever the app comes back to the foreground, and every RETRY_MS while
// something is still waiting (see components/SessionSyncRunner.tsx). The
// rules for one pass live in utils/sessionQueue.ts.

const STORAGE_KEY = "pendingSessions.v1"
const RETRY_MS = 60_000

let queue: PendingSession[] | null = null
// Whether the last try couldn't reach the server.
let offline = false
const listeners = new Set<() => void>()
const syncedListeners = new Set<() => void>()
let processing: Promise<void> | null = null
let rerun = false
let retryTimer: ReturnType<typeof setTimeout> | null = null

async function load(): Promise<PendingSession[]> {
  if (queue) return queue
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    queue = raw ? JSON.parse(raw) : []
  } catch (e: any) {
    console.warn("[sessionQueue] could not read queue:", e?.message ?? e)
    queue = []
  }
  return queue!
}

async function save(next: PendingSession[]): Promise<void> {
  queue = next
  for (const l of listeners) l()
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch (e: any) {
    console.warn("[sessionQueue] could not persist queue:", e?.message ?? e)
  }
}

// Keeps a finished workout on the phone and tries to send it right away.
// Resolves once it's stored locally — not when it reaches the server — so
// the caller can safely drop its own copy (the in-progress snapshot) after.
export async function enqueueSession(
  data: Record<string, any>,
  opts: { userId?: string | null; notifyProtocolName?: string } = {},
): Promise<void> {
  const q = await load()
  const entry: PendingSession = {
    id: ID.unique(),
    userId: opts.userId ?? null,
    data,
    ...(opts.notifyProtocolName !== undefined ? { notify: { protocolName: opts.notifyProtocolName } } : {}),
    createdAt: Date.now(),
    tries: 0,
  }
  await save([...q, entry])
  syncPendingSessions()
}

// Runs one pass over the queue (one at a time). Safe to call any time.
export function syncPendingSessions(): Promise<void> {
  if (processing) {
    // Something was queued mid-pass — go again right after.
    rerun = true
    return processing
  }
  processing = run().finally(() => {
    processing = null
    if (rerun) { rerun = false; syncPendingSessions() }
  })
  return processing
}

async function run(): Promise<void> {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
  const q = await load()
  if (q.length === 0) return

  let currentUserId: string
  try {
    currentUserId = (await account.get()).$id
  } catch (e) {
    // Offline → try again soon. Signed out → wait for the next sign-in.
    if (isNetworkError(e)) { setOffline(true); scheduleRetry() }
    return
  }

  const result = await flushPendingSessions(q, {
    currentUserId,
    save: (entry) => saveSession(entry.data, entry.userId ?? currentUserId, entry.id),
    notify: (entry) => sendWorkoutCompletedNotification(entry.notify?.protocolName ?? ""),
    update: async (entry) => save((await load()).map((e) => (e.id === entry.id ? entry : e))),
    remove: async (id) => save((await load()).filter((e) => e.id !== id)),
  })

  setOffline(result.offline)
  if (result.synced > 0) for (const l of syncedListeners) l()
  if ((await load()).some((e) => !e.userId || e.userId === currentUserId)) scheduleRetry()
}

function setOffline(next: boolean) {
  if (offline === next) return
  offline = next
  for (const l of listeners) l()
}

function scheduleRetry() {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = setTimeout(() => { retryTimer = null; syncPendingSessions() }, RETRY_MS)
}

// Called after queued workouts reach the server, so screens can reload.
export function onSessionsSynced(fn: () => void): () => void {
  syncedListeners.add(fn)
  return () => { syncedListeners.delete(fn) }
}

export interface SessionSyncState {
  pending: number  // finished workouts still only on this phone
  offline: boolean // the last try couldn't reach the server
}

export function useSessionSyncState(): SessionSyncState {
  const read = (): SessionSyncState => ({ pending: queue?.length ?? 0, offline })
  const [state, setState] = useState(read)
  useEffect(() => {
    const l = () => setState(read())
    listeners.add(l)
    load().then(l)
    return () => { listeners.delete(l) }
  }, [])
  return state
}
