// The push log: one row per person a push was meant for, so the coach can
// see in the app (Settings › Notifications sent) who got what, when, and
// whether Expo took it. Pure, so it can be tested without Appwrite
// (scripts/progression-tests/pushLog.test.ts).

export const PUSH_LOG_TABLE = process.env.PUSH_LOG_TABLE || "push_log"
// Rows older than this are deleted by the hourly cron.
export const PUSH_LOG_KEEP_DAYS = 60

const cut = (v, n) => (typeof v === "string" ? v.slice(0, n) : null)

/**
 * Rows for the push_log table.
 *   users     the user rows the push was meant for (with or without a token)
 *   build     user → Expo message minus `to` (title, body, data.type)
 *   outcomes  Map token → { ok, error } from sendExpoPush (empty if nothing
 *             was sent)
 *   source    what sent it: the action ("notifyCoach", "classPublish") or
 *             "classCron"
 * status: "sent" (Expo accepted it), "failed" (Expo or Apple/Google said
 * no — see `error`), "no_token" (the person has no device registered, so
 * nothing went out).
 */
export function pushLogRows(users, build, outcomes, source) {
  const rows = []
  for (const u of users) {
    if (!u?.$id) continue
    let msg = {}
    try { msg = build(u) ?? {} } catch { msg = {} }
    const token = typeof u.pushToken === "string" && u.pushToken ? u.pushToken : null
    const outcome = token ? outcomes?.get(token) : null
    const status = !token ? "no_token" : outcome?.ok ? "sent" : "failed"
    rows.push({
      userId: u.$id,
      userName: cut(u.username, 64),
      type: cut(msg.data?.type, 40),
      title: cut(msg.title, 120),
      body: cut(msg.body, 500),
      status,
      error: status === "failed" ? cut(outcome?.error ?? "Not sent", 200) : null,
      source: cut(source, 40),
    })
  }
  return rows
}

// What the app gets back from the pushLog action.
export function toPushLogEntry(r) {
  return {
    id: r.$id,
    at: r.$createdAt,
    userId: r.userId,
    userName: r.userName ?? null,
    type: r.type ?? null,
    title: r.title ?? null,
    body: r.body ?? null,
    status: r.status,
    error: r.error ?? null,
    source: r.source ?? null,
  }
}
