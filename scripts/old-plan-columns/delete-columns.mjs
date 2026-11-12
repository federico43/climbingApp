// One-off script (to-do "Borrar columnas viejas de training_plans"): deletes
// the columns the app stopped using when classes moved to the calendar
// tables: training_plans.trainingDays, trainingTime and scheduleOverrides.
// No code in the app or the Appwrite functions reads or writes them any more.
//
// Deleting a column also deletes its data and CAN'T be undone. The dry run
// (default) shows each column and how many plans still have a value in it.
//
// Usage:
//   node --env-file=.env.local scripts/old-plan-columns/delete-columns.mjs           (dry run)
//   node --env-file=.env.local scripts/old-plan-columns/delete-columns.mjs --apply   (deletes)
// (.env.local: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID)

const env = process.env
const APPWRITE_ENDPOINT = env.APPWRITE_ENDPOINT
const APPWRITE_PROJECT_ID = env.APPWRITE_PROJECT_ID
const APPWRITE_API_KEY = env.APPWRITE_API_KEY
const APPWRITE_DATABASE_ID = env.APPWRITE_DATABASE_ID
const APPLY = process.argv.includes("--apply")
const OLD = ["trainingDays", "trainingTime", "scheduleOverrides"]

for (const [name, value] of Object.entries({
  APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID,
})) {
  if (!value) { console.error(`Missing env var: ${name}`); process.exit(1) }
}

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

const table = `/tablesdb/${APPWRITE_DATABASE_ID}/tables/training_plans`
const { columns = [] } = await api("GET", `${table}/columns`)

// How many plans still hold a value in each old column (first 5000 rows).
const used = Object.fromEntries(OLD.map((k) => [k, 0]))
let total = 0
for (let offset = 0; offset < 5000; offset += 100) {
  const q = [JSON.stringify({ method: "limit", values: [100] }), JSON.stringify({ method: "offset", values: [offset] })]
  const qs = q.map((x) => `queries[]=${encodeURIComponent(x)}`).join("&")
  const { rows = [] } = await api("GET", `${table}/rows?${qs}`)
  for (const r of rows) {
    total++
    for (const k of OLD) {
      const v = r[k]
      if (v != null && v !== "" && !(Array.isArray(v) && v.length === 0)) used[k]++
    }
  }
  if (rows.length < 100) break
}
console.log(`training_plans: ${total} plans checked`)

for (const key of OLD) {
  const col = columns.find((c) => c.key === key)
  if (!col) { console.log(`training_plans.${key}: already gone`); continue }
  const info = `${col.type}${col.array ? "[]" : ""}, ${used[key]} plans with a value`
  if (!APPLY) { console.log(`training_plans.${key}: would delete (${info})`); continue }
  await api("DELETE", `${table}/columns/${key}`)
  console.log(`training_plans.${key}: deleted (${info})`)
}

if (!APPLY) console.log("Dry run. Re-run with --apply to delete (can't be undone).")
