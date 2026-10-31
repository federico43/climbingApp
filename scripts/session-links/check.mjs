// One-off check: do finished workouts carry their plan link? A session row
// names the workout it came from (protocolId, planId, planIndex — see
// sessionLinkFor), which is how the Plan page marks a workout done. Without
// those columns sessions still save, just unlinked.
//
// Prints which link columns workoutsession has (and their type), and how
// many of the latest sessions are linked. With --apply, creates the missing
// columns. Also checks each session's data (JSON valid, size vs column
// limit, what was logged). No dependencies — Appwrite's REST API directly.
//
//   node --env-file=.env.local scripts/session-links/check.mjs [--apply]
// (.env.local: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID)

const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID } = process.env
const APPLY = process.argv.includes("--apply")

for (const [name, value] of Object.entries({
  APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID,
})) {
  if (!value) { console.error(`Missing env var: ${name}`); process.exit(1) }
}

const TABLE = "workoutsession"
const LINK_COLUMNS = [
  { type: "string", key: "protocolId", size: 36, required: false },
  { type: "string", key: "planId", size: 36, required: false },
  { type: "integer", key: "planIndex", required: false },
]

async function api(method, path, body) {
  const res = await fetch(`${APPWRITE_ENDPOINT}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Appwrite-Project": APPWRITE_PROJECT_ID,
      "X-Appwrite-Key": APPWRITE_API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json.message ?? ""}`)
  return json
}

const table = `/tablesdb/${APPWRITE_DATABASE_ID}/tables/${TABLE}`

console.log(`${TABLE} link columns`)
const { columns: have = [] } = await api("GET", `${table}/columns`)
let missing = 0
for (const { type, ...c } of LINK_COLUMNS) {
  const col = have.find((h) => h.key === c.key)
  if (col) {
    const ok = col.type === type
    console.log(`  ${c.key}: ${col.type}, ${col.status}${ok ? "" : `  ← should be ${type}: sessions save without their link`}`)
    continue
  }
  missing++
  if (!APPLY) { console.log(`  ${c.key}: MISSING — would create (${type})`); continue }
  await api("POST", `${table}/columns/${type}`, c)
  console.log(`  ${c.key}: created`)
}

const q = encodeURIComponent(JSON.stringify({ method: "orderDesc", attribute: "$createdAt" }))
const lim = encodeURIComponent(JSON.stringify({ method: "limit", values: [30] }))
const { rows = [] } = await api("GET", `${table}/rows?queries[]=${q}&queries[]=${lim}`)
const linked = rows.filter((r) => r.protocolId).length
console.log(`\nLatest ${rows.length} sessions: ${linked} linked to their workout, ${rows.length - linked} not`)
for (const r of rows.slice(0, 10)) {
  const who = r.userId?.$id ?? r.userId
  console.log(`  ${r.$createdAt.slice(0, 16)}  user ${who}  ${r.protocolId ? `workout ${r.protocolId} · plan slot ${r.planIndex ?? "–"}` : "no link"}`)
}

// ── Content: is each session's data complete? ────────────────────────────────
// protocol / attempts / blockDurations are JSON strings. A string longer than
// its column is rejected by Appwrite (400) and the workout stays stuck on the
// phone, so show how close the biggest sessions get to each column's size.
console.log(`\n${TABLE} data columns`)
const DATA_COLUMNS = ["protocol", "attempts", "blockDurations"]
const sizes = {}
for (const key of DATA_COLUMNS) {
  const col = have.find((h) => h.key === key)
  if (!col) { console.log(`  ${key}: MISSING${key === "blockDurations" ? " (optional: block times aren't saved)" : "  ← sessions can't save"}`); continue }
  sizes[key] = col.size
  const biggest = Math.max(0, ...rows.map((r) => (typeof r[key] === "string" ? r[key].length : 0)))
  const pct = col.size ? Math.round((biggest / col.size) * 100) : 0
  console.log(`  ${key}: ${col.type} size ${col.size ?? "–"}, ${col.status} · biggest of the latest ${rows.length}: ${biggest} chars (${pct}%)${pct >= 80 ? "  ← close to the limit" : ""}`)
}

const parse = (s) => { try { return JSON.parse(s) } catch { return undefined } }
let broken = 0, empty = 0
console.log(`\nLatest sessions' content`)
for (const r of rows) {
  const protocol = parse(r.protocol)
  const attempts = parse(r.attempts)
  const bad = !Array.isArray(protocol) || !Array.isArray(attempts)
  if (bad) broken++
  else if (attempts.length === 0) empty++
  if (rows.indexOf(r) >= 10) continue
  if (bad) { console.log(`  ${r.$createdAt.slice(0, 16)}  ${r.$id}  ← protocol/attempts not valid JSON`); continue }
  const withNotes = attempts.filter((a) => a.notes).length
  const withRpe = attempts.filter((a) => a.rpe != null).length
  const withSc = attempts.filter((a) => a.scData && Object.keys(a.scData).length).length
  console.log(`  ${r.$createdAt.slice(0, 16)}  ${protocol.length} blocks, ${attempts.length} attempts (notes ${withNotes}, RPE ${withRpe}, sets/weights ${withSc})${r.blockDurations ? "" : ", no block times"}`)
}
console.log(`\n${broken} with broken data, ${empty} with no attempts logged (of ${rows.length}).`)
if (missing && !APPLY) console.log("\nDry run — pass --apply to create the missing columns.")
