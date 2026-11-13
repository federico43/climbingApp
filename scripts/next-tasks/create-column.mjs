// One-off script: the `users.nextTasks` column (string, optional, 4000). The
// athlete's "For next time" tasks as JSON (utils/nextTasks.ts), written on
// the workout summary and shown at the start of the next workout. Unset = no
// tasks, so existing rows need no backfill. Until it exists the app keeps the
// list on the phone only. Skips it if it's already there.
//
// Usage (dry run by default — prints what it would create):
//   node --env-file=.env.local scripts/next-tasks/create-column.mjs [--apply]
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
if (columns.some((c) => c.key === "nextTasks")) console.log("users.nextTasks: already there")
else if (!APPLY) console.log("users.nextTasks: would create (string 4000, optional). Re-run with --apply.")
else {
  await api("POST", `${path}/string`, { key: "nextTasks", size: 4000, required: false })
  console.log("users.nextTasks: created")
}
