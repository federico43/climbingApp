// Finished workouts waiting to reach Appwrite. The rules for one pass over
// the queue live here, free of AsyncStorage / Appwrite, so they can be tested
// in plain Node; services/sessionSyncQueue.ts persists the queue and runs it.
//
// Each entry goes through two steps: write the `sessions` row, then (if the
// workout should ping the coach) ask the backend to send the push. The row is
// marked `saved` as soon as it exists, so a failed push retries just the push.

import { isNetworkError } from "@/utils/network"

export interface PendingSession {
  // Also the `sessions` row id: a retry after a write that did reach the
  // server gets a 409 instead of a duplicate session.
  id: string
  // Who did the workout. A queued workout only ever syncs for that user, so
  // signing in as someone else on the phone can't save it under their name.
  // null = not known when it was queued (offline launch) → whoever is signed in.
  userId: string | null
  data: Record<string, any>
  // Set when finishing it should notify the coach (services/notifications.ts).
  notify?: { protocolName: string }
  // Blocks the athlete left as homework (utils/homework.ts leftHomework) —
  // made right after the session row, with the entry's id as the row id.
  homework?: { name: string; blocks: any[]; dueBy: string; planId?: string; planIndex?: number }
  homeworkMade?: boolean
  saved?: boolean
  createdAt: number
  tries: number
  lastError?: string
}

export interface FlushDeps {
  currentUserId: string
  save: (entry: PendingSession) => Promise<unknown>
  notify: (entry: PendingSession) => Promise<unknown>
  // Makes the entry's homework; a row that's already there must resolve.
  homework?: (entry: PendingSession) => Promise<unknown>
  // Called after every step so progress survives the app dying mid-pass.
  update: (entry: PendingSession) => Promise<void>
  remove: (id: string) => Promise<void>
}

export interface FlushResult {
  synced: number   // entries fully done (row written, coach notified) this pass
  offline: boolean // stopped early: no connection
}

// Server errors making the homework before it's given up on.
export const HOMEWORK_TRIES = 5

export function isAlreadySaved(e: unknown): boolean {
  return (e as { code?: number } | null)?.code === 409
}

function message(e: unknown): string {
  return String((e as { message?: string } | null)?.message ?? e).slice(0, 200)
}

// One pass, oldest first. A connection error stops the pass (everything
// after it would fail the same way); any other error only skips that entry,
// which stays queued — a workout is never dropped because of a server error.
export async function flushPendingSessions(entries: PendingSession[], deps: FlushDeps): Promise<FlushResult> {
  let synced = 0
  for (const original of [...entries].sort((a, b) => a.createdAt - b.createdAt)) {
    let entry = original
    if (entry.userId && entry.userId !== deps.currentUserId) continue

    if (!entry.saved) {
      try {
        await deps.save(entry)
        entry = { ...entry, userId: deps.currentUserId, saved: true, lastError: undefined }
      } catch (e) {
        if (isAlreadySaved(e)) {
          entry = { ...entry, userId: deps.currentUserId, saved: true, lastError: undefined }
        } else if (isNetworkError(e)) {
          return { synced, offline: true }
        } else {
          await deps.update({ ...entry, tries: entry.tries + 1, lastError: message(e) })
          continue
        }
      }
      if (entry.notify || entry.homework) await deps.update(entry)
    }

    if (entry.homework && !entry.homeworkMade && deps.homework) {
      try {
        await deps.homework(entry)
        entry = { ...entry, homeworkMade: true, lastError: undefined }
        await deps.update(entry)
      } catch (e) {
        if (isNetworkError(e)) return { synced, offline: true }
        // Keep trying on later passes, but never hold the queue forever.
        const tries = entry.tries + 1
        if (tries < HOMEWORK_TRIES) {
          await deps.update({ ...entry, tries, lastError: message(e) })
          continue
        }
        entry = { ...entry, homeworkMade: true, lastError: message(e) }
      }
    }

    if (entry.notify) {
      try {
        await deps.notify(entry)
      } catch (e) {
        if (isNetworkError(e)) return { synced, offline: true }
        // The backend answered with an error: retrying won't help and could
        // ping the coach twice. The workout itself is saved — let it go.
      }
    }

    await deps.remove(entry.id)
    synced++
  }
  return { synced, offline: false }
}
