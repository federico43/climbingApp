// One-off script: the cron_marks table. The hourly class cron writes one row
// per reminder it sends ("class tomorrow", package low, …), its id a hash of
// the reminder's key, so a late or overlapping run never sends it twice. No
// client permissions: only the climbingApp function (server key) uses it,
// and it deletes rows older than 14 days. Skips what already exists. No
// dependencies.
//
// Usage (dry run by default — prints what it would create):
//   node --env-file=.env.local scripts/cron-marks/create-table.mjs [--apply]
// (.env.local: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID)

const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID } = process.env
const APPLY = process.argv.includes("--apply")

for (const [name, value] of Object.entries({
  APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID,
})) {
  if (!value) { console.error(`Missing env var: ${name}`); process.exit(1) }
}

const TABLE = "cron_marks"
// e.g. "tomorrow:<classId>", "package:<classId>:<athleteId>"
const COLUMNS = [{ type: "string", key: "key", size: 200, required: true }]

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

async function exists(path) {
  try { return await api("GET", path) } catch (e) { if (e.status === 404) return null; throw e }
}

console.log(TABLE)
if (!(await exists(`${db}/${TABLE}`))) {
  if (!APPLY) console.log(`  would create table ${TABLE} (no client permissions)`)
  else {
    await api("POST", db, { tableId: TABLE, name: "Cron marks", permissions: [], rowSecurity: false })
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

if (!APPLY) console.log("\nDry run — pass --apply to create it.")
