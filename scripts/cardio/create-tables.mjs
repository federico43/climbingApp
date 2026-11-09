// One-off script: what the jump rope cardio plan needs (docs/cardio-rope.md).
//   users.cardioEnabled  boolean — the coach's switch (unset = off)
//   users.cardioPlan     string (JSON) — days, reminder, step, cycle, …
//   cardio_sessions      one row per cardio session (athletes write their own,
//                        the coach reads them)
// Skips what already exists. No dependencies.
//
// Usage (dry run by default — prints what it would create):
//   node --env-file=.env.local scripts/cardio/create-tables.mjs [--apply]
// (.env.local: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID)

const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID } = process.env
const APPLY = process.argv.includes("--apply")

for (const [name, value] of Object.entries({
  APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID,
})) {
  if (!value) { console.error(`Missing env var: ${name}`); process.exit(1) }
}

const str = (key, size, extra = {}) => ({ type: "string", key, size, required: false, ...extra })
const int = (key) => ({ type: "integer", key, required: false })
const bool = (key) => ({ type: "boolean", key, required: false })

const USER_COLUMNS = [bool("cardioEnabled"), str("cardioPlan", 4000)]

const TABLE = "cardio_sessions"
const SESSION_COLUMNS = [
  str("userId", 36, { required: true }),
  str("date", 10, { required: true }),     // "YYYY-MM-DD", the athlete's day
  str("kind", 12),                         // "test" | "session" | "deload"
  int("step"),
  int("cycle"),
  str("protocol", 500),                    // JSON CardioProtocol actually done
  str("answers", 1000),                    // JSON CardioAnswers (+ test stop counts)
  str("outcome", 12),                      // up | skip | cycleUp | repeat | down | deloadHold | start
  int("rule"),
  int("nextStep"),
  int("nextCycle"),
  bool("climbedHard"),
]
const INDEXES = [{ key: "idx_userId", columns: ["userId"] }, { key: "idx_date", columns: ["date"] }]

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

async function columns(table, wanted) {
  const { columns: have = [] } = (await exists(`${db}/${table}/columns`)) ?? {}
  for (const { type, ...c } of wanted) {
    if (have.some((h) => h.key === c.key)) { console.log(`  ${c.key}: already there`); continue }
    if (!APPLY) { console.log(`  ${c.key}: would create (${type})`); continue }
    await api("POST", `${db}/${table}/columns/${type}`, c)
    console.log(`  ${c.key}: created`)
  }
}

console.log("users")
await columns("users", USER_COLUMNS)

console.log(TABLE)
if (!(await exists(`${db}/${TABLE}`))) {
  const permissions = ['read("users")', 'create("users")', 'update("users")', 'delete("users")']
  if (!APPLY) console.log(`  would create table ${TABLE} (${permissions.join(", ")})`)
  else {
    await api("POST", db, { tableId: TABLE, name: "Cardio sessions", permissions, rowSecurity: false })
    console.log(`  created table ${TABLE}`)
  }
}
await columns(TABLE, SESSION_COLUMNS)

if (APPLY) {
  for (let i = 0; ; i++) {
    const { columns = [] } = await api("GET", `${db}/${TABLE}/columns`)
    if (columns.every((c) => c.status === "available")) break
    if (i >= 30) throw new Error("columns still processing")
    await sleep(1000)
  }
  const { indexes = [] } = await api("GET", `${db}/${TABLE}/indexes`)
  for (const ix of INDEXES) {
    if (indexes.some((h) => h.key === ix.key)) { console.log(`  index ${ix.key}: already there`); continue }
    await api("POST", `${db}/${TABLE}/indexes`, { ...ix, type: "key" })
    console.log(`  index ${ix.key}: created`)
  }
} else {
  console.log("\nDry run — pass --apply to create it.")
}
