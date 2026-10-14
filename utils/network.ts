// Telling "no connection" apart from a real answer from the server, without
// a native network-info module (no new build needed). The Appwrite SDK lets
// fetch's own rejection through untouched when the request never reaches
// the server ("Network request failed" on React Native, "Failed to fetch" /
// "Load failed" on the web); anything the server answered comes back as an
// AppwriteException with an HTTP code.

export type AuthErrorKind = "network" | "credentials" | "other"

const NETWORK_MESSAGE = /network request failed|failed to fetch|load failed|network ?error|internet connection appears to be offline|timed? ?out|abort/i

export function isNetworkError(e: unknown): boolean {
  const err = e as { name?: string; message?: string; code?: number } | null
  if (!err) return false
  // The server answered (any HTTP status) → not a connection problem.
  if (err.name === "AppwriteException" && typeof err.code === "number" && err.code > 0) return false
  return err.name === "AbortError" || NETWORK_MESSAGE.test(err.message ?? "")
}

// Sign-in failures: no connection, wrong email / password (Appwrite 401
// user_invalid_credentials, or a 400 on a malformed email / short password),
// or anything else.
export function authErrorKind(e: unknown): AuthErrorKind {
  if (isNetworkError(e)) return "network"
  const err = e as { code?: number; type?: string } | null
  if (err?.type === "user_invalid_credentials" || err?.code === 401) return "credentials"
  if (err?.code === 400 && /email|password/i.test(String((e as any)?.message ?? ""))) return "credentials"
  return "other"
}

export const OFFLINE_MESSAGE = "No internet connection — you can't sign in right now."
export const CREDENTIALS_MESSAGE = "Wrong email or password."

// A light reachability check: any HTTP answer from the server (even an
// error status) means we're online; a rejected or timed-out fetch means
// we're not.
export async function canReachServer(url: string, timeoutMs = 5000): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    await fetch(url, { method: "GET", signal: controller.signal, cache: "no-store" })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
