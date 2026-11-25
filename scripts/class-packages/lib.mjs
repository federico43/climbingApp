// Shared by scripts/diagnose/packages.mjs and scripts/class-packages/*.mjs.
// Reads Appwrite's REST API directly (no dependencies) and counts a package's
// sessions exactly like the climbingApp function (athletePackage in
// functions/aiProtocol/src/classes.js), using the same pure rules.
import {
  CLASS_HOURS, addDays, classMs, currentPackage, gymNow, mondayOfYmd, packageLocked, sessionsLeft,
} from "../../functions/aiProtocol/src/classRules.js"

export const TZ = "America/Bogota"
const { APPWRITE_ENDPOINT: E, APPWRITE_PROJECT_ID: P, APPWRITE_API_KEY: K, APPWRITE_DATABASE_ID: DB } = process.env
for (const [n, v] of Object.entries({ APPWRITE_ENDPOINT: E, APPWRITE_PROJECT_ID: P, APPWRITE_API_KEY: K, APPWRITE_DATABASE_ID: DB })) {
  if (!v) { console.error("Missing env var", n); process.exit(1) }
}
const q = (o) => "queries[]=" + encodeURIComponent(JSON.stringify(o))

export async function api(method, path, body) {
  const r = await fetch(E + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Appwrite-Project": P, "X-Appwrite-Key": K },
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${j.message ?? ""}`)
  return j
}

export async function rows(table, queries = []) {
  const out = []
  for (let cursor; ;) {
    const qs = [...queries, { method: "limit", values: [100] }, ...(cursor ? [{ method: "cursorAfter", values: [cursor] }] : [])]
    const page = (await api("GET", `/tablesdb/${DB}/tables/${table}/rows?${qs.map(q).join("&")}`)).rows
    out.push(...page)
    if (page.length < 100) return out
    cursor = page.at(-1).$id
  }
}

export const createRow = (table, data) => api("POST", `/tablesdb/${DB}/tables/${table}/rows`, { rowId: "unique()", data })

export const now = () => gymNow(new Date(), TZ)
export const plusDays = addDays

// Everything the function knows about an athlete's classes, read once.
export async function loadAll() {
  const [users, packages, classes, requests] = await Promise.all([
    rows("users", [{ method: "select", values: ["$id", "username", "role"] }]),
    rows("packages"),
    rows("classes"),
    rows("class_requests", [{ method: "equal", attribute: "kind", values: ["skip"] }]),
  ])
  return { users, packages, classes, requests }
}

// In-app classes an athlete was in that ended in [fromYmd, now] and after
// `sinceIso` (a package's $createdAt), sorted by date.
export function classesDone(all, athleteId, fromYmd, sinceIso, at) {
  const since = sinceIso ? gymNow(new Date(sinceIso), TZ).ms : 0
  return all.classes
    .filter((c) => (c.roster ?? []).includes(athleteId) && c.weekStart >= mondayOfYmd(fromYmd))
    .filter((c) => {
      const end = classMs(c, CLASS_HOURS)
      return addDays(c.weekStart, c.day) >= fromYmd && end > since && end <= at.ms
    })
    .map((c) => `${addDays(c.weekStart, c.day)} ${String(Math.floor(c.start)).padStart(2, "0")}:${c.start % 1 ? "30" : "00"}`)
    .sort()
}

// The athlete's package right now, as the app sees it.
export function packageNow(all, athleteId, at = now()) {
  const mine = all.packages.filter((p) => p.athleteId === athleteId)
  const pkg = currentPackage(mine, at.ymd)
  if (!pkg) return { pkg: null, rows: mine, done: [], skips: 0, left: null, locked: false }
  const done = classesDone(all, athleteId, pkg.startsOn, pkg.$createdAt, at)
  const skips = all.requests.filter((r) => r.athleteId === athleteId && r.status === "accepted"
    && r.weekStart >= mondayOfYmd(pkg.startsOn) && (!pkg.$createdAt || (r.$createdAt ?? "") >= pkg.$createdAt)).length
  const left = sessionsLeft(pkg.total, done.length, skips)
  return { pkg, rows: mine, done, skips, left, locked: packageLocked(pkg, left, at.ymd) }
}

export const describe = (s) => !s.pkg ? "no package"
  : `${s.left} of ${s.pkg.total} left · started ${s.pkg.startsOn} · use by ${s.pkg.useBy}${s.locked ? " · LOCKED" : ""}`
