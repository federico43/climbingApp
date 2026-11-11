// One-off script for Max Hangs (utils/maxHangs.ts, coach 2026-11-11):
//  - creates `users.hangMaxLog` (string, JSON: the athlete's max per edge
//    size, every change newest first) if it's missing;
//  - creates the "Max Hangs" library exercise (fingers, max force, a 10 s
//    hang, default grip 20mm) with the same permissions as "Edge Lifts".
//    Skipped if it already exists.
//
// Usage (dry run by default — prints what it would change):
//   node --env-file=.env.local scripts/max-hangs/setup.mjs [--apply]
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

// ── 1. users.hangMaxLog ──
const LOG_SIZE = 10000   // 60 entries (HANG_LOG_LIMIT) ≈ 4.5 KB
const { columns: userCols = [] } = await api("GET", `${db}/users/columns`)
const logCol = userCols.find((c) => c.key === "hangMaxLog")
if (!logCol) {
  if (!APPLY) console.log(`users.hangMaxLog: missing — would create (string ${LOG_SIZE}, optional).`)
  else {
    await api("POST", `${db}/users/columns/string`, { key: "hangMaxLog", size: LOG_SIZE, required: false })
    console.log("users.hangMaxLog: created")
  }
} else if (logCol.type !== "string") {
  console.log(`users.hangMaxLog: is ${logCol.type}, expected string — check it by hand.`)
} else {
  console.log(`users.hangMaxLog: already there (string ${logCol.size})`)
}

// ── 2. The Max Hangs library exercise ──
const { rows: exercises = [] } = await api("GET", `${db}/exercises/rows?${q({ method: "limit", values: [500] })}`)
const same = (a, b) => (a ?? "").trim().toLowerCase() === b.toLowerCase()
const existing = exercises.find((e) => same(e.name, "Max Hangs") || same(e.name, "Max Hang"))
const edgeLifts = exercises.find((e) => same(e.name, "Edge Lifts") || same(e.name, "Edge Lift"))
if (existing) {
  console.log(`exercises: "Max Hangs" already there (${existing.$id})`)
} else {
  const { columns: exCols = [] } = await api("GET", `${db}/exercises/columns`)
  const has = new Set(exCols.map((c) => c.key))
  const wanted = {
    name: "Max Hangs",
    type: "reps",
    unit: "seconds",
    defaultReps: "10",
    defaultEdge: "20mm",
    movementType: "carry_grip",
    loadMode: "weight",
    loadStep: 0.5,
    focuses: JSON.stringify(["max_force"]),
    notes: "Hangboard, two hands, on the edge set for the block. Hang 10 s with weight added to your bodyweight (0 = bodyweight). Shoulder blades retracted (pulled back and down) the whole hang, arms slightly bent, no swinging.",
  }
  const row = {}
  for (const [k, v] of Object.entries(wanted)) {
    if (has.has(k)) row[k] = v
    else console.log(`  exercises.${k}: no such column, skipped`)
  }
  const permissions = edgeLifts?.$permissions ?? []
  if (!edgeLifts) console.log(`  no "Edge Lifts" row to copy permissions from — the row gets no row-level permissions (table permissions apply).`)
  if (!APPLY) console.log(`exercises: would create "Max Hangs": ${JSON.stringify(row)}`)
  else {
    const created = await api("POST", `${db}/exercises/rows`, { rowId: "unique()", data: row, permissions })
    console.log(`exercises: created "Max Hangs" (${created.$id})`)
  }
}

if (!APPLY) console.log("Dry run. Re-run with --apply.")
