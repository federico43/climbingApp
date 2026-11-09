// One-off script for conditioning-only plans (docs/conditioning-plan.md):
//  - creates `training_plans.kind` (string, optional; "conditioning", unset
//    = climbing, so existing plans need no backfill);
//  - makes `training_plans.focus` optional if it's required (conditioning
//    plans have no climbing focus).
// Skips whatever is already right.
//
// Usage (dry run by default — prints what it would change):
//   node --env-file=.env.local scripts/conditioning-plan/create-column.mjs [--apply]
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

const path = `/tablesdb/${APPWRITE_DATABASE_ID}/tables/training_plans/columns`
const { columns = [] } = await api("GET", path)

if (columns.some((c) => c.key === "kind")) console.log("training_plans.kind: already there")
else if (!APPLY) console.log("training_plans.kind: would create (string 20, optional).")
else {
  await api("POST", `${path}/string`, { key: "kind", size: 20, required: false })
  console.log("training_plans.kind: created")
}

const focus = columns.find((c) => c.key === "focus")
if (!focus) console.log("training_plans.focus: not found (nothing to do)")
else if (!focus.required) console.log("training_plans.focus: already optional")
else if (!APPLY) console.log("training_plans.focus: would make optional.")
else {
  await api("PATCH", `${path}/string/focus`, { required: false, default: null })
  console.log("training_plans.focus: now optional")
}

if (!APPLY) console.log("Dry run. Re-run with --apply.")
