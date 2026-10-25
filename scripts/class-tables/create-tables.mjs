// One-off script: the tables behind the weekly classes (Plan › This week,
// the coach's Classes tab). Everyone signed in can read them; only the
// climbingApp function (server key) writes. Skips tables, columns and
// indexes that already exist. No dependencies — Appwrite's REST API directly.
//
// Usage (dry run by default — prints what it would create):
//   node --env-file=.env.local scripts/class-tables/create-tables.mjs [--apply]
// (.env.local: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID)

const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID } = process.env
const APPLY = process.argv.includes("--apply")

for (const [name, value] of Object.entries({
  APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID,
})) {
  if (!value) { console.error(`Missing env var: ${name}`); process.exit(1) }
}

const str = (key, size, extra = {}) => ({ type: "string", key, size, required: false, ...extra })
const int = (key, extra = {}) => ({ type: "integer", key, required: false, ...extra })
const float = (key, extra = {}) => ({ type: "float", key, required: false, ...extra })
const bool = (key, extra = {}) => ({ type: "boolean", key, required: false, ...extra })
const req = { required: true }

const TABLES = [
  {
    id: "classes", name: "Classes",
    columns: [str("weekStart", 10, req), int("day", { ...req, min: 0, max: 6 }), float("start", req), str("roster", 36, { array: true })],
    indexes: [{ key: "idx_weekStart", columns: ["weekStart"] }],
  },
  {
    // Row id = the week's Monday ("2026-10-26").
    id: "class_weeks", name: "Class weeks",
    columns: [bool("published", { default: false }), str("blocks", 4000)],
    indexes: [],
  },
  {
    id: "class_requests", name: "Class requests",
    columns: [
      str("athleteId", 36, req), str("weekStart", 10, req), str("kind", 12, req), str("status", 12, req),
      str("fromClassId", 36), str("toClassId", 36), int("day", { min: 0, max: 6 }), float("start"),
    ],
    indexes: [{ key: "idx_weekStart", columns: ["weekStart"] }, { key: "idx_athleteId", columns: ["athleteId"] }],
  },
  {
    id: "packages", name: "Packages",
    columns: [str("athleteId", 36, req), int("total", { ...req, min: 1, max: 100 }), str("startsOn", 10, req), str("useBy", 10, req)],
    indexes: [{ key: "idx_athleteId", columns: ["athleteId"] }],
  },
]
// The athlete's usual classes, "day@start" ("0@9.5" = Monday 9:30).
const USER_COLUMNS = [str("defaultClasses", 8, { array: true })]
// Plan pauses, JSON [{ start, end, reason? }] (utils/planPauses.ts).
const PLAN_COLUMNS = [str("pauses", 2000)]

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
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} → ${res.status} ${json.message ?? ""}`), { status: res.status })
  return json
}

const db = `/tablesdb/${APPWRITE_DATABASE_ID}/tables`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function exists(path) {
  try { return await api("GET", path) } catch (e) { if (e.status === 404) return null; throw e }
}

async function ensureColumns(table, columns) {
  const { columns: have = [] } = (await exists(`${db}/${table}/columns`)) ?? {}
  for (const { type, ...c } of columns) {
    if (have.some((h) => h.key === c.key)) { console.log(`  ${table}.${c.key}: already there`); continue }
    if (!APPLY) { console.log(`  ${table}.${c.key}: would create (${type}${c.array ? "[]" : ""})`); continue }
    await api("POST", `${db}/${table}/columns/${type}`, c)
    console.log(`  ${table}.${c.key}: created`)
  }
}

// Indexes need their columns to be ready.
async function waitForColumns(table) {
  for (let i = 0; i < 30; i++) {
    const { columns = [] } = await api("GET", `${db}/${table}/columns`)
    if (columns.every((c) => c.status === "available")) return
    await sleep(1000)
  }
  throw new Error(`${table}: columns still processing`)
}

for (const t of TABLES) {
  console.log(t.id)
  if (!(await exists(`${db}/${t.id}`))) {
    if (!APPLY) console.log(`  would create table ${t.id} (read: users)`)
    else {
      await api("POST", db, { tableId: t.id, name: t.name, permissions: ['read("users")'], rowSecurity: false })
      console.log(`  created table ${t.id}`)
    }
  }
  if (!APPLY) { await ensureColumns(t.id, t.columns); continue }
  await ensureColumns(t.id, t.columns)
  if (!t.indexes.length) continue
  await waitForColumns(t.id)
  const { indexes = [] } = await api("GET", `${db}/${t.id}/indexes`)
  for (const ix of t.indexes) {
    if (indexes.some((h) => h.key === ix.key)) { console.log(`  index ${ix.key}: already there`); continue }
    await api("POST", `${db}/${t.id}/indexes`, { ...ix, type: "key" })
    console.log(`  index ${ix.key}: created`)
  }
}
console.log("users")
await ensureColumns("users", USER_COLUMNS)
console.log("training_plans")
await ensureColumns("training_plans", PLAN_COLUMNS)
if (!APPLY) console.log("\nDry run — pass --apply to create them.")
