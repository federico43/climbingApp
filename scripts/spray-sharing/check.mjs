// Read-only check: can every athlete read every spray-wall sequence?
// The app now lists all sequences on the wall in spray blocks, whoever built
// them. Appwrite still has to let other users read a row an athlete created:
// rows created from the app with no explicit permissions are readable only
// by their creator, unless the spray_routes TABLE grants read to all users.
//
// Prints the table's permissions and row security, and how many sequences
// were built by athletes. Changes nothing.
//
//   node --env-file=.env.local scripts/spray-sharing/check.mjs
// (.env.local: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID)

const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID } = process.env
for (const [name, value] of Object.entries({ APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID })) {
  if (!value) { console.error(`Missing env var: ${name}`); process.exit(1) }
}

async function api(path) {
  const res = await fetch(`${APPWRITE_ENDPOINT}${path}`, {
    headers: { "X-Appwrite-Project": APPWRITE_PROJECT_ID, "X-Appwrite-Key": APPWRITE_API_KEY },
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${json.message ?? ""}`)
  return json
}

const table = await api(`/tablesdb/${APPWRITE_DATABASE_ID}/tables/spray_routes`)
const perms = table.$permissions ?? []
const tableRead = perms.some((p) => /^read\("(users|any)"\)$/.test(p))
console.log("spray_routes")
console.log(`  table permissions: ${perms.length ? perms.join(", ") : "(none)"}`)
console.log(`  row security: ${table.rowSecurity ?? table.documentSecurity ? "on" : "off"}`)

const queries = [JSON.stringify({ method: "limit", values: [500] })].map((q) => `queries[]=${encodeURIComponent(q)}`).join("&")
const { rows = [], total } = await api(`/tablesdb/${APPWRITE_DATABASE_ID}/tables/spray_routes/rows?${queries}`)
const byAthletes = rows.filter((r) => r.athleteId)
console.log(`  sequences: ${total} (${byAthletes.length} built by athletes)`)

if (tableRead) {
  console.log("\nOK — every signed-in user can read every sequence (table grants read).")
} else {
  const openRows = byAthletes.filter((r) => (r.$permissions ?? []).some((p) => /^read\("(users|any)"\)$/.test(p)))
  console.log(`\nPROBLEM — the table doesn't grant read to all users: athletes only see their own sequences`)
  console.log(`(${openRows.length} of ${byAthletes.length} athlete sequences are readable by others).`)
  console.log(`Fix in the Appwrite console: Databases → spray_routes → Settings → Permissions → add role "Users" with Read.`)
}
