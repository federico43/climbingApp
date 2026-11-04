// One-off script: the push_log table (Settings › Notifications sent, for the
// coach). One row per person a push was meant for. No client permissions:
// only the climbingApp function (server key) writes and reads it, and it
// checks the caller is a coach. Skips what already exists. No dependencies.
//
// Usage (dry run by default — prints what it would create):
//   node --env-file=.env.local scripts/push-log/create-table.mjs [--apply]
// (.env.local: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID)

const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID } = process.env
const APPLY = process.argv.includes("--apply")

for (const [name, value] of Object.entries({
  APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID,
})) {
  if (!value) { console.error(`Missing env var: ${name}`); process.exit(1) }
}

const TABLE = "push_log"
const str = (key, size, extra = {}) => ({ type: "string", key, size, required: false, ...extra })
const COLUMNS = [
  str("userId", 36, { required: true }),
  str("userName", 64),
  str("type", 40),
  str("title", 120),
  str("body", 500),
  // "sent" | "failed" | "no_token"
  str("status", 12, { required: true }),
  str("error", 200),
  // what sent it: the action ("notifyCoach", "classPublish", …) or "classCron"
  str("source", 40),
]
const INDEXES = [
  { key: "idx_userId", columns: ["userId"] },
  { key: "idx_status", columns: ["status"] },
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
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} → ${res.status} ${json.message ?? ""}`), { status: res.status })
  return json
}

const db = `/tablesdb/${APPWRITE_DATABASE_ID}/tables`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function exists(path) {
  try { return await api("GET", path) } catch (e) { if (e.status === 404) return null; throw e }
}

console.log(TABLE)
if (!(await exists(`${db}/${TABLE}`))) {
  if (!APPLY) console.log(`  would create table ${TABLE} (no client permissions)`)
  else {
    await api("POST", db, { tableId: TABLE, name: "Push log", permissions: [], rowSecurity: false })
    console.log(`  created table ${TABLE}`)
  }
}

const { columns: have = [] } = (await exists(`${db}/${TABLE}/columns`)) ?? {}
for (const { type, ...c } of COLUMNS) {
  if (have.some((h) => h.key === c.key)) { console.log(`  ${c.key}: already there`); continue }
  if (!APPLY) { console.log(`  ${c.key}: would create (${type})`); continue }
  await api("POST", `${db}/${TABLE}/columns/${type}`, c)
  console.log(`  ${c.key}: created`)
}

if (APPLY) {
  // Indexes need their columns to be ready.
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
