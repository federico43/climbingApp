// Read-only sweep over every session: data the app saved but may ignore.
//   node --env-file=.env.local scripts/session-links/sweep.mjs
const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID } = process.env
async function api(path) {
  const res = await fetch(`${APPWRITE_ENDPOINT}${path}`, { headers: { "X-Appwrite-Project": APPWRITE_PROJECT_ID, "X-Appwrite-Key": APPWRITE_API_KEY } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${json.message ?? ""}`)
  return json
}
const db = `/tablesdb/${APPWRITE_DATABASE_ID}/tables`
const q = (o) => `queries[]=${encodeURIComponent(JSON.stringify(o))}`
async function all(table, queries = []) {
  const out = []; let cursor = null
  for (;;) {
    const qs = [...queries, q({ method: "limit", values: [100] })]
    if (cursor) qs.push(q({ method: "cursorAfter", values: [cursor] }))
    const { rows } = await api(`${db}/${table}/rows?${qs.join("&")}`)
    out.push(...rows)
    if (rows.length < 100) return out
    cursor = rows[rows.length - 1].$id
  }
}
const parse = (s) => { try { return JSON.parse(s || "[]") } catch { return null } }
const day = (ms) => new Date(ms - 5 * 3600e3).toISOString().slice(0, 10) // Bogotá

const users = new Map((await all("users", [q({ method: "select", values: ["$id", "username"] })])).map((u) => [u.$id, u.username]))
const library = await all("exercises")
const lib = new Map(library.map((e) => [e.$id, e]))
const libByName = new Map(library.filter((e) => e.name).map((e) => [e.name.trim().toLowerCase(), e]))
const sessions = await all("workoutsession")
console.log(`${sessions.length} sessions, ${users.size} users, ${library.length} library exercises\n`)

const tally = new Map()
const hit = (kind, example) => {
  const t = tally.get(kind) ?? { n: 0, ex: [] }
  t.n++; if (t.ex.length < 4) t.ex.push(example); tally.set(kind, t)
}
const byUserDay = new Map()

for (const s of sessions) {
  const uid = s.userId?.$id ?? s.userId
  const who = `${users.get(uid) ?? uid ?? "?"} ${s.$createdAt.slice(0, 10)} ${s.$id}`
  if (!uid) hit("session without user", who)
  const protocol = parse(s.protocol), attempts = parse(s.attempts)
  if (!Array.isArray(protocol) || !Array.isArray(attempts)) { hit("broken JSON", who); continue }
  if (protocol.length === 0) hit("no blocks", who)
  const realAttempts = attempts.filter((a) => a?.blockIndex >= 0)
  if (realAttempts.length === 0) hit("no attempts", who)
  for (const a of attempts) {
    if (a?.blockIndex >= protocol.length) hit("attempt on a missing block", `${who} block ${a.blockIndex}/${protocol.length}`)
    if (a?.blockIndex >= 0 && protocol[a.blockIndex] && a.type && protocol[a.blockIndex].type && a.type !== protocol[a.blockIndex].type)
      hit("attempt type ≠ block type", `${who} ${a.type} on ${protocol[a.blockIndex].type}`)
  }
  const ts = realAttempts.map((a) => a.timestamp).filter(Number.isFinite)
  if (ts.length && Math.abs(Date.parse(s.$createdAt) - Math.max(...ts)) > 36 * 3600e3)
    hit("saved >36h after last attempt", `${who} last attempt ${day(Math.max(...ts))}`)
  // duplicates: same user, same blocks, same first-attempt time
  const key = `${uid}|${ts[0] ?? ""}|${s.protocol?.length}`
  if (ts.length) { if (byUserDay.has(key)) hit("duplicate session", `${who} = ${byUserDay.get(key)}`); else byUserDay.set(key, s.$id) }

  protocol.forEach((block, i) => {
    if (block?.type !== "strength_conditioning") return
    const exs = Array.isArray(block.exercises) ? block.exercises : []
    for (const ex of exs) {
      const libEx = (ex.exerciseId && lib.get(ex.exerciseId)) || libByName.get(String(ex.name ?? "").trim().toLowerCase())
      if (!ex.movementType && !libEx?.movementType) hit("S&C exercise without movement type (no chart)", `${who} "${ex.name}"`)
      if (ex.exerciseId && !lib.has(ex.exerciseId)) hit("S&C exercise id not in library", `${who} "${ex.name}" ${ex.exerciseId}`)
    }
    for (const a of attempts.filter((a) => a?.blockIndex === i && a?.type === "strength_conditioning")) {
      const d = a.scData
      if (!d) { hit("S&C attempt without data", who); continue }
      const id = d.exerciseId
      const direct = exs.find((e) => (id && e.exerciseId === id) || e.name === d.exerciseName)
      const viaLevels = exs.find((e) => (e.levels ?? []).some((l) => l?.exerciseId === id))
      if (!direct && !viaLevels) hit(d.swappedFrom ? "swapped S&C set (dropped from charts)" : "S&C set matching no exercise", `${who} "${d.exerciseName}"`)
      if (d.repsCompleted == null && d.repsLeft == null && d.seriesDone == null && d.weight == null) hit("S&C set with no reps/weight", `${who} "${d.exerciseName}"`)
    }
  })
}
for (const [kind, { n, ex }] of [...tally].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`${n}× ${kind}`)
  for (const e of ex) console.log(`     ${e}`)
}
