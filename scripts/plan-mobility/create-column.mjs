// One-off script: the `training_plans.mobilityIds` column (string, optional,
// JSON string[]). The mobility exercises the coach chose for the athlete in
// the plan form (components/TrainingPlanModal); unset / empty = the app picks
// from the whole library, so existing rows need no backfill. Skips it if it's
// already there.
//
// Usage (dry run by default — prints what it would create):
//   node --env-file=.env.local scripts/plan-mobility/create-column.mjs [--apply]
// (.env.local: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID)

const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID } = process.env
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

// ~40 ids of 20 chars as JSON fits easily.
const SIZE = 2000
const path = `/tablesdb/${APPWRITE_DATABASE_ID}/tables/training_plans/columns`
const { columns = [] } = await api("GET", path)
if (columns.some((c) => c.key === "mobilityIds")) console.log("training_plans.mobilityIds: already there")
else if (!APPLY) console.log(`training_plans.mobilityIds: would create (string ${SIZE}, optional). Re-run with --apply.`)
else {
  await api("POST", `${path}/string`, { key: "mobilityIds", size: SIZE, required: false })
  console.log("training_plans.mobilityIds: created")
}
