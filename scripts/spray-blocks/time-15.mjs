// Coach 2026-11-12: Power boulders and Coordination boulders last 15 min.
// Plans already set 15 min on the workouts they build (utils/planRotation.ts);
// this sets timeLimit 15 on the two library blocks, so workouts the coach
// builds by hand from the library get it too. Workouts already created are
// not changed.
//
// Usage (dry run by default):
//   node --env-file=.env.local scripts/spray-blocks/time-15.mjs [--apply]
// (.env.local: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID)

const env = process.env
const APPWRITE_ENDPOINT = env.APPWRITE_ENDPOINT
const APPWRITE_PROJECT_ID = env.APPWRITE_PROJECT_ID
const APPWRITE_API_KEY = env.APPWRITE_API_KEY
const APPWRITE_DATABASE_ID = env.APPWRITE_DATABASE_ID
const APPLY = process.argv.includes("--apply")
const NAMES = ["Power boulders", "Coordination boulders"]
const MINUTES = 15

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

const db = `/tablesdb/${APPWRITE_DATABASE_ID}/tables`
const q = (o) => `queries[]=${encodeURIComponent(JSON.stringify(o))}`
const rows = []
let cursor = null
for (;;) {
  const qs = [q({ method: "limit", values: [100] })]
  if (cursor) qs.push(q({ method: "cursorAfter", values: [cursor] }))
  const { rows: page = [] } = await api("GET", `${db}/blocks/rows?${qs.join("&")}`)
  rows.push(...page)
  if (page.length < 100) break
  cursor = page[page.length - 1].$id
}

const same = (a, b) => (a ?? "").trim().toLowerCase() === b.toLowerCase()
for (const name of NAMES) {
  const found = rows.filter((r) => r.type === "free_session" && same(r.name, name))
  if (found.length === 0) { console.log(`"${name}": not in the library`); continue }
  for (const r of found) {
    let data = {}
    try { data = JSON.parse(r.data || "{}") } catch {}
    if (data.timeLimit === MINUTES) { console.log(`"${name}" (${r.$id}): already ${MINUTES} min`); continue }
    if (!APPLY) { console.log(`"${name}" (${r.$id}): ${data.timeLimit ?? "no"} min → would set ${MINUTES}`); continue }
    await api("PATCH", `${db}/blocks/rows/${r.$id}`, { data: { data: JSON.stringify({ ...data, timeLimit: MINUTES }) } })
    console.log(`"${name}" (${r.$id}): set to ${MINUTES} min`)
  }
}
if (!APPLY) console.log("Dry run. Re-run with --apply.")
