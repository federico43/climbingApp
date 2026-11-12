// Bug 2026-11-12: sequences created from a spray block's selector came out
// tagged "Base". Likely cause: spray_routes is missing an optional column the
// app writes (athleteId / variations / level), the save failed, and the
// fallback re-saved with name + holds only, so the tag was lost (and the
// builder shows an untagged sequence as "Base").
//
// This script:
//  - lists spray_routes' columns and says which ones the app needs are missing;
//  - lists sequences with no tag (newest first) so they can be re-tagged;
//  - with --apply: creates the missing athleteId column (string 36, optional);
//  - with --retag <rowId>=<tag> (repeatable, needs --apply): sets a sequence's tag
//    (base / max_bouldering / power / coordination).
//
// Usage:
//   node --env-file=.env.local scripts/spray-route-type/check.mjs
//   node --env-file=.env.local scripts/spray-route-type/check.mjs --apply
//   node --env-file=.env.local scripts/spray-route-type/check.mjs --apply --retag 6a1b...=power
// (.env.local: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID)

const env = process.env
const APPWRITE_ENDPOINT = env.APPWRITE_ENDPOINT
const APPWRITE_PROJECT_ID = env.APPWRITE_PROJECT_ID
const APPWRITE_API_KEY = env.APPWRITE_API_KEY
const APPWRITE_DATABASE_ID = env.APPWRITE_DATABASE_ID
const APPLY = process.argv.includes("--apply")
const TAGS = ["base", "max_bouldering", "power", "coordination"]
const retags = process.argv.flatMap((a, i, all) => (a === "--retag" && all[i + 1] ? [all[i + 1]] : []))

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

const table = `/tablesdb/${APPWRITE_DATABASE_ID}/tables/spray_routes`
const q = (o) => `queries[]=${encodeURIComponent(JSON.stringify(o))}`

// ── 1. Columns ──
const { columns = [] } = await api("GET", `${table}/columns`)
const byKey = new Map(columns.map((c) => [c.key, c]))
for (const key of ["type", "level", "variations", "athleteId", "wallId"]) {
  const c = byKey.get(key)
  console.log(c ? `spray_routes.${key}: ok (${c.type}${c.size ? ` ${c.size}` : ""})` : `spray_routes.${key}: MISSING`)
}
if (!byKey.has("athleteId")) {
  if (!APPLY) console.log("  → would create athleteId (string 36, optional)")
  else {
    await api("POST", `${table}/columns/string`, { key: "athleteId", size: 36, required: false })
    console.log("  → athleteId created")
  }
}
if (!byKey.has("level") || !byKey.has("variations") || !byKey.has("type")) {
  console.log("  → type / level / variations missing: tell Claude, they need to be created with the right type.")
}

// ── 2. Sequences with no tag ──
const rows = []
let cursor = null
for (;;) {
  const qs = [q({ method: "limit", values: [100] }), q({ method: "orderDesc", values: ["$createdAt"] })]
  if (cursor) qs.push(q({ method: "cursorAfter", values: [cursor] }))
  const { rows: page = [] } = await api("GET", `${table}/rows?${qs.join("&")}`)
  rows.push(...page)
  if (page.length < 100) break
  cursor = page[page.length - 1].$id
}
const untagged = rows.filter((r) => !TAGS.includes(r.type))
console.log(`\n${rows.length} sequences, ${untagged.length} with no tag:`)
for (const r of untagged.slice(0, 30)) {
  console.log(`  ${r.$id}  ${r.$createdAt.slice(0, 10)}  "${r.name}"  level=${r.level ?? "-"}  by=${r.athleteId ?? "-"}`)
}

// ── 3. Re-tag ──
for (const arg of retags) {
  const [id, tag] = arg.split("=")
  if (!id || !TAGS.includes(tag)) { console.log(`--retag ${arg}: use <rowId>=${TAGS.join("|")}`); continue }
  if (!APPLY) { console.log(`would tag ${id} as ${tag}`); continue }
  await api("PATCH", `${table}/rows/${id}`, { data: { type: tag } })
  console.log(`tagged ${id} as ${tag}`)
}

if (!APPLY) console.log("\nDry run. Re-run with --apply.")
