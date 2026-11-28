// One-off script: the `users.techniqueProgress` column (text, optional). A
// text column is stored outside the row, so it fits although the users table
// has no room left for another string one. Each athlete's progress through
// the technique modules as JSON (utils/techniqueProgress.ts,
// docs/technique-modules.md): level, passes, techniques found. A full
// Footwork entry stays under 4,000 characters. Unset = nothing done yet, so
// existing rows need no backfill. Until it exists the app keeps progress on
// the phone only. Skips it if it's already there. Run it BEFORE the EAS update.
//
// Usage (dry run by default — prints what it would create):
//   node --env-file=.env.local scripts/technique-modules/create-progress-column.mjs [--apply]
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
const strings = columns.filter((c) => c.type === "string")
console.log(`users: ${columns.length} columns, ${strings.length} strings, ${strings.reduce((n, c) => n + (c.size ?? 0), 0)} characters of string columns in all`)
for (const c of columns) console.log(`  ${c.key}: ${c.type}${c.size ? ` ${c.size}` : ""}${c.array ? " (array)" : ""}`)
if (columns.some((c) => c.key === "techniqueProgress")) console.log("users.techniqueProgress: already there")
else if (!APPLY) console.log("users.techniqueProgress: would create (text, optional). Re-run with --apply.")
else {
  await api("POST", `${path}/text`, { key: "techniqueProgress", required: false })
  console.log("users.techniqueProgress: created")
}
