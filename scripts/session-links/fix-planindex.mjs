// One-off fix (approved by Federico 2026-10-31): workoutsession.planIndex was
// created as text, so every session sent with a numeric planIndex got a 400
// and was saved without its plan link (see saveSession). Recreates it as an
// integer — only if no row has a value in it, so nothing is lost.
//
//   node --env-file=.env.local scripts/session-links/fix-planindex.mjs

const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID } = process.env

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

const table = `/tablesdb/${APPWRITE_DATABASE_ID}/tables/workoutsession`
const q = (o) => `queries[]=${encodeURIComponent(JSON.stringify(o))}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const column = async () => (await api("GET", `${table}/columns`)).columns.find((c) => c.key === "planIndex")

const col = await column()
if (col?.type === "integer") { console.log("planIndex is already an integer — nothing to do."); process.exit(0) }

if (col) {
  // Every row, 100 at a time: abort if any has a planIndex.
  let cursor = null, scanned = 0, filled = 0
  for (;;) {
    const qs = [q({ method: "select", values: ["$id", "planIndex"] }), q({ method: "limit", values: [100] })]
    if (cursor) qs.push(q({ method: "cursorAfter", values: [cursor] }))
    const { rows } = await api("GET", `${table}/rows?${qs.join("&")}`)
    scanned += rows.length
    filled += rows.filter((r) => r.planIndex != null && r.planIndex !== "").length
    if (rows.length < 100) break
    cursor = rows[rows.length - 1].$id
  }
  console.log(`Scanned ${scanned} sessions: ${filled} with a planIndex.`)
  if (filled > 0) { console.error("Some rows have a planIndex — not deleting the column."); process.exit(1) }

  await api("DELETE", `${table}/columns/planIndex`)
  console.log("Deleted the text planIndex column, waiting for it to go…")
  for (let i = 0; i < 30 && (await column()); i++) await sleep(2000)
  if (await column()) { console.error("Column still there after 60 s."); process.exit(1) }
}

await api("POST", `${table}/columns/integer`, { key: "planIndex", required: false })
console.log("Created planIndex as integer, waiting for it to be available…")
for (let i = 0; i < 30; i++) {
  const c = await column()
  if (c?.status === "available") { console.log(`planIndex: ${c.type}, available`); process.exit(0) }
  await sleep(2000)
}
console.error("planIndex not available after 60 s — check the console.")
process.exit(1)
