// One-off script: the `users.active` column (boolean, optional). The coach
// turns an account off with it (components/coach/ActivePill); unset = active,
// so existing rows need no backfill. Skips it if it's already there.
//
// Usage (dry run by default — prints what it would create):
//   node --env-file=.env.local scripts/user-active/create-column.mjs [--apply]
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

const path = `/tablesdb/${APPWRITE_DATABASE_ID}/tables/users/columns`
const { columns = [] } = await api("GET", path)
if (columns.some((c) => c.key === "active")) console.log("users.active: already there")
else if (!APPLY) console.log("users.active: would create (boolean, optional). Re-run with --apply.")
else {
  await api("POST", `${path}/boolean`, { key: "active", required: false })
  console.log("users.active: created")
}
