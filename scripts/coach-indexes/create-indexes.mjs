// One-off script: key indexes for the coach dashboard's roster-wide queries
// (docs/coach-dashboard.md §7) — `protocol.planPart` (all homework) and
// `training_plans.status` (all active plans). Skips an index whose columns
// are already indexed. No dependencies — uses Appwrite's REST API directly.
//
// Usage (dry run by default — prints what it would create):
//   node --env-file=.env.local scripts/coach-indexes/create-indexes.mjs [--apply]
// (.env.local: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID)

const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID } = process.env
const APPLY = process.argv.includes("--apply")

for (const [name, value] of Object.entries({
  APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID,
})) {
  if (!value) { console.error(`Missing env var: ${name}`); process.exit(1) }
}

const WANTED = [
  // Values are short ("homework", "active"); a prefix keeps long string
  // columns under MySQL's 767-byte index limit.
  { table: "protocol", key: "idx_planPart", columns: ["planPart"], lengths: [32] },
  { table: "training_plans", key: "idx_status", columns: ["status"], lengths: [32] },
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

for (const w of WANTED) {
  const base = `/tablesdb/${APPWRITE_DATABASE_ID}/tables/${w.table}/indexes`
  const { indexes = [] } = await api("GET", base)
  const cols = (ix) => ix.columns ?? ix.attributes ?? []
  const existing = indexes.find((ix) => cols(ix)[0] === w.columns[0])
  if (existing) {
    console.log(`${w.table}: already indexed by "${existing.key}" (${cols(existing).join(", ")}, ${existing.status})`)
    continue
  }
  if (!APPLY) { console.log(`${w.table}: would create key index ${w.key} on ${w.columns.join(", ")}`); continue }
  const created = await api("POST", base, { key: w.key, type: "key", columns: w.columns, lengths: w.lengths })
  console.log(`${w.table}: created ${created.key} (${created.status})`)
}
if (!APPLY) console.log("\nDry run — pass --apply to create them.")
