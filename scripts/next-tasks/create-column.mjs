// One-off script: the `users.nextTasks` column (string, optional, 600 — two
// tasks fit in well under that, see COLUMN_SIZE in utils/sessionTasks.ts; the
// users table has no room left for a 4000 one). The
// athlete's next-session tasks as JSON (utils/sessionTasks.ts, docs/session-tasks.md),
// set on the workout summary and run as blocks in the next workouts. Unset = no
// tasks, so existing rows need no backfill. Until it exists the app keeps the
// list on the phone only. Skips it if it's already there. Run it BEFORE the EAS update.
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
const SIZE = 600
const { columns = [] } = await api("GET", path)
const strings = columns.filter((c) => c.type === "string")
console.log(`users: ${columns.length} columns, ${strings.length} strings, ${strings.reduce((n, c) => n + (c.size ?? 0), 0)} characters of string columns in all`)
if (columns.some((c) => c.key === "nextTasks")) console.log("users.nextTasks: already there")
else if (!APPLY) console.log(`users.nextTasks: would create (string ${SIZE}, optional). Re-run with --apply.`)
else {
  await api("POST", `${path}/string`, { key: "nextTasks", size: SIZE, required: false })
  console.log("users.nextTasks: created")
}
