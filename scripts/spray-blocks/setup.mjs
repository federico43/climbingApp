// One-off script for the spray-wall blocks (utils/sprayBlocks.ts, coach
// 2026-11-09):
//  - checks `spray_routes.type` (the route tag: base / max_bouldering / power /
//    coordination) is there and long enough; creates it if missing;
//  - lists how many spray routes have each tag (read only);
//  - creates the "Coordination boulders" library block (free_session) as a
//    copy of "Power boulders" — Power days now run 2 Power boulders + 2
//    Coordination boulders. Skipped if it already exists.
//
// Usage (dry run by default — prints what it would change):
//   node --env-file=.env.local scripts/spray-blocks/setup.mjs [--apply]
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

const db = `/tablesdb/${APPWRITE_DATABASE_ID}/tables`
const q = (o) => `queries[]=${encodeURIComponent(JSON.stringify(o))}`

async function allRows(table, select) {
  const out = []
  let cursor = null
  for (;;) {
    const qs = [q({ method: "limit", values: [100] })]
    if (select) qs.push(q({ method: "select", values: select }))
    if (cursor) qs.push(q({ method: "cursorAfter", values: [cursor] }))
    const { rows = [] } = await api("GET", `${db}/${table}/rows?${qs.join("&")}`)
    out.push(...rows)
    if (rows.length < 100) break
    cursor = rows[rows.length - 1].$id
  }
  return out
}

const ROUTE_TYPES = ["base", "max_bouldering", "power", "coordination"]
const MIN_SIZE = Math.max(...ROUTE_TYPES.map((t) => t.length))

// ── 1. spray_routes.type ──
const { columns = [] } = await api("GET", `${db}/spray_routes/columns`)
const typeCol = columns.find((c) => c.key === "type")
const hasType = !!typeCol
if (!typeCol) {
  if (!APPLY) console.log("spray_routes.type: missing — would create (string 30, optional).")
  else {
    await api("POST", `${db}/spray_routes/columns/string`, { key: "type", size: 30, required: false })
    console.log("spray_routes.type: created")
  }
} else if (typeCol.type !== "string") {
  console.log(`spray_routes.type: is ${typeCol.type}, expected string — check it by hand.`)
} else if ((typeCol.size ?? 0) < MIN_SIZE) {
  console.log(`spray_routes.type: size ${typeCol.size} is too short for "max_bouldering" — make it at least ${MIN_SIZE} by hand.`)
} else {
  console.log(`spray_routes.type: already there (string ${typeCol.size}) — tags: ${ROUTE_TYPES.join(", ")}`)
}

// ── 2. Routes per tag (read only) ──
if (hasType) {
  const routes = await allRows("spray_routes", ["$id", "type"])
  const count = new Map()
  for (const r of routes) count.set(r.type || "(none)", (count.get(r.type || "(none)") ?? 0) + 1)
  console.log(`Spray routes: ${routes.length}`)
  for (const t of [...ROUTE_TYPES, "(none)"]) console.log(`  ${t}: ${count.get(t) ?? 0}`)
  for (const [t, n] of count) if (!ROUTE_TYPES.includes(t) && t !== "(none)") console.log(`  ${t} (unknown tag): ${n}`)
}

// ── 3. The Coordination boulders library block ──
const blocks = await allRows("blocks")
const same = (a, b) => (a ?? "").trim().toLowerCase() === b.toLowerCase()
const coord = blocks.find((b) => b.type === "free_session" && same(b.name, "Coordination boulders"))
const power = blocks.find((b) => b.type === "free_session" && same(b.name, "Power boulders"))
if (coord) console.log(`blocks: "Coordination boulders" already there (${coord.$id})`)
else if (!power) console.log(`blocks: no "Power boulders" free_session to copy — create "Coordination boulders" by hand in the app's block library.`)
else {
  let data = {}
  try { data = JSON.parse(power.data || "{}") } catch {}
  data = { ...data, blockName: "Coordination boulders" }
  delete data.description // Power boulders' text doesn't fit; the coach can write one
  const row = {}
  for (const [k, v] of Object.entries(power)) if (!k.startsWith("$")) row[k] = v
  row.name = "Coordination boulders"
  row.data = JSON.stringify(data)
  if (!APPLY) console.log(`blocks: would create "Coordination boulders" (copy of Power boulders ${power.$id}): ${row.data}`)
  else {
    const created = await api("POST", `${db}/blocks/rows`, { rowId: "unique()", data: row, permissions: power.$permissions })
    console.log(`blocks: created "Coordination boulders" (${created.$id})`)
  }
}

if (!APPLY) console.log("Dry run. Re-run with --apply.")
