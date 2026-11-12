// One-off script: the `training_plans.scFocuses` column (string, optional,
// JSON Focus[]). The S&C focuses the coach left on in the plan form
// (coach 2026-11-12); unset / empty = all three, so existing plans need no
// backfill. Only needed once a coach turns a focus off. Skips it if it's
// already there.
//
// Usage (dry run by default — prints what it would create):
//   node --env-file=.env.local scripts/sc-focuses/create-column.mjs [--apply]
// (.env.local: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID)

const env = process.env
const APPWRITE_ENDPOINT = env.APPWRITE_ENDPOINT
const APPWRITE_PROJECT_ID = env.APPWRITE_PROJECT_ID
const APPWRITE_API_KEY = env.APPWRITE_API_KEY
const APPWRITE_DATABASE_ID = env.APPWRITE_DATABASE_ID
const APPLY = process.argv.includes("--apply")

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

const SIZE = 100
const path = `/tablesdb/${APPWRITE_DATABASE_ID}/tables/training_plans/columns`
const { columns = [] } = await api("GET", path)
if (columns.some((c) => c.key === "scFocuses")) console.log("training_plans.scFocuses: already there")
else if (!APPLY) console.log(`training_plans.scFocuses: would create (string ${SIZE}, optional). Re-run with --apply.`)
else {
  await api("POST", `${path}/string`, { key: "scFocuses", size: SIZE, required: false })
  console.log("training_plans.scFocuses: created")
}
