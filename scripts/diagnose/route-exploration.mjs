// Read-only: every "exploration" block the app can hand out, so we can see
// why a new one differs from the one we built (2026-11-22).
//   1. Library rows (table `blocks`) of type route_exploration and
//      exploration_session (Boulder Logger): what "Add block → Library" and
//      the plan generator copy.
//   2. Workouts (table `protocol`) holding one of those blocks, newest first,
//      with their minutes (warm-up, breathing, part 1, part 2) and notes.
// Writes NOTHING to Appwrite.
//
//   node --env-file=.env.local scripts/diagnose/route-exploration.mjs [--last=15]

const ENV = {
  APPWRITE_ENDPOINT: process.env.APPWRITE_ENDPOINT,
  APPWRITE_PROJECT_ID: process.env.APPWRITE_PROJECT_ID,
  APPWRITE_API_KEY: process.env.APPWRITE_API_KEY,
  APPWRITE_DATABASE_ID: process.env.APPWRITE_DATABASE_ID,
}
for (const [name, value] of Object.entries(ENV)) {
  if (!value) { console.error(`Missing env var: ${name}`); process.exit(1) }
}
const arg = (key, fallback) => {
  const a = process.argv.find((x) => x.startsWith(`--${key}=`))
  return a ? a.slice(key.length + 3) : fallback
}
const LAST = Number(arg("last", "15")) || 15
const TYPES = ["route_exploration", "exploration_session"]

async function api(path) {
  const res = await fetch(`${ENV.APPWRITE_ENDPOINT}${path}`, { headers: { "X-Appwrite-Project": ENV.APPWRITE_PROJECT_ID, "X-Appwrite-Key": ENV.APPWRITE_API_KEY } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`GET ${path.split("?")[0]} → ${res.status} ${json.message ?? ""}`)
  return json
}
const db = `/tablesdb/${ENV.APPWRITE_DATABASE_ID}/tables`
const q = (o) => `queries[]=${encodeURIComponent(JSON.stringify(o))}`
async function all(table, queries = []) {
  const out = []; let cursor = null
  for (;;) {
    const qs = [...queries, q({ method: "limit", values: [100] })]
    if (cursor) qs.push(q({ method: "cursorAfter", values: [cursor] }))
    const rows = (await api(`${db}/${table}/rows?${qs.join("&")}`)).rows ?? []
    out.push(...rows)
    if (rows.length < 100) return out
    cursor = rows[rows.length - 1].$id
  }
}
const parse = (s, fallback) => { if (typeof s !== "string") return s ?? fallback; try { return JSON.parse(s || "null") ?? fallback } catch { return fallback } }
const bogota = (iso) => (iso ? new Date(new Date(iso).getTime() - 5 * 3600e3).toISOString().replace("T", " ").slice(0, 16) : "")
const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim()

const minutes = (b) => b.type === "route_exploration"
  ? `warm-up ${b.warmupTime ?? "–"} · breathing ${b.breathingTime ?? "–"} · part 1 ${b.timeLimit ?? "–"} · part 2 ${b.projectTime ?? "–"} min`
  : `time ${b.timeLimit ?? "–"} min`
const fields = (b) => Object.keys(b).filter((k) => !["id", "description", "blockName"].includes(k)).join(", ")

// ── 1. Library ──
const library = (await all("blocks", [q({ method: "equal", attribute: "type", values: TYPES })]))
console.log(`Library blocks of type ${TYPES.join(" / ")}: ${library.length}`)
for (const row of library) {
  const d = parse(row.data, {})
  console.log(`\n  "${row.name}"  [${row.type}]  (${row.$id})  updated ${bogota(row.$updatedAt)}`)
  console.log(`    ${minutes({ ...d, type: row.type })}`)
  console.log(`    fields: ${fields(d) || "(none)"}`)
  console.log(`    notes: "${oneLine(d.description) || "(empty → app default)"}"`)
}

// ── 2. Workouts ──
const protocols = await all("protocol", [q({ method: "orderDesc", attribute: "$createdAt", values: [] }), q({ method: "select", values: ["$id", "$createdAt", "name", "athleteId", "blocks"] })]).catch(() => all("protocol"))
const users = await all("users", [q({ method: "select", values: ["$id", "username"] })]).catch(() => [])
const userById = new Map(users.map((u) => [u.$id, u.username]))
const who = (id) => (id ? userById.get(id?.$id ?? id) ?? "(unknown user)" : "(no athlete)")
const hits = protocols
  .map((p) => ({ p, blocks: (parse(p.blocks, []) || []).filter((b) => TYPES.includes(b?.type)) }))
  .filter((x) => x.blocks.length)
  .sort((a, b) => (a.p.$createdAt < b.p.$createdAt ? 1 : -1))
console.log(`\nWorkouts with one of those blocks: ${hits.length} (of ${protocols.length}); newest ${LAST}:`)
for (const { p, blocks } of hits.slice(0, LAST)) {
  console.log(`\n  ${bogota(p.$createdAt)}  "${p.name}" → ${who(p.athleteId)}  (${p.$id})`)
  for (const b of blocks) {
    console.log(`    "${b.blockName ?? ""}" [${b.type}]${b.libraryBlockId ? ` library ${b.libraryBlockId}` : ""}`)
    console.log(`      ${minutes(b)}`)
    console.log(`      notes: "${oneLine(b.description) || "(empty → app default)"}"`)
  }
}
