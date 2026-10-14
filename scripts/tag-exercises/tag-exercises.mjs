// One-off script: sets `movementType` on the exercise library (Appwrite
// `exercises` table) so the training-plan S&C generator can pick exercises
// by movement pattern (docs/training-plan-implementation.md, phase 0).
// Matches by exact (trimmed) exercise name; only rows whose tag would change
// are written. No dependencies — uses Appwrite's REST API directly.
//
// Usage (dry run by default — prints what would change, writes nothing):
//   APPWRITE_ENDPOINT=https://nyc.cloud.appwrite.io/v1 \
//   APPWRITE_PROJECT_ID=689e515d000c2e1af428 \
//   APPWRITE_API_KEY=<server API key with tablesDB read/write scope> \
//   APPWRITE_DATABASE_ID=68bd9dd7003c15f7147e \
//   node scripts/tag-exercises/tag-exercises.mjs [--apply]

const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID } = process.env
const APPLY = process.argv.includes("--apply")
const TABLE = "exercises"

for (const [name, value] of Object.entries({
  APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID,
})) {
  if (!value) { console.error(`Missing env var: ${name}`); process.exit(1) }
}

// Exercise name → MovementType (utils/movementTypes.ts).
const TAGS = {
  pull_vertical: ["Pull Ups", "weighted Pull-ups", "Negative pull-ups", "explosive pull-ups", "chin-up isometric"],
  pull_horizontal: ["Inverted Row", "One-Arm Inverted Row"],
  push: ["Push-ups", "Elevated push-ups", "Bench press", "Chest flys", "Arm Bar Roll Over"],
  squat: [
    "Pistol Squat", "Assisted Pistol Squat", "Split Squat", "KettleBell Squat", "Cosack Squat", "squat isometric",
    "explosive Squats", "Jumps into box", "Salto con pesas", "Salto con mancuerna",
  ],
  hinge: ["Single Leg good morning", "KettleBell Deadlift"],
  core: ["Toes to Bar", "Trx core", "Hanging Knee Raises", "Starfish crunch", "Front lever", "planch twist"],
  carry_grip: [
    "Jumps to Catch", "Edge Lifts", "edge lifts", "repeaters", "hangBoard", "pinch lifts", "Salto a presas",
    "Campus jumps", "ladder jumps",
  ],
  wrist: ["Wrist Extensions", "Wrist flexion", "wrist rotations"],
  mobility: [
    "Shoulder mobility", "shoulder stretch", "pancake", "Frogs", "Standing Hamstring stretch",
    "Lunge stretch with knew", "kneeling lunge stretch", "roller",
  ],
}

const tagByName = new Map()
for (const [movementType, names] of Object.entries(TAGS)) {
  for (const n of names) tagByName.set(n, movementType)
}

const base = `${APPWRITE_ENDPOINT}/tablesdb/${APPWRITE_DATABASE_ID}/tables/${TABLE}/rows`
const headers = {
  "Content-Type": "application/json",
  "X-Appwrite-Project": APPWRITE_PROJECT_ID,
  "X-Appwrite-Key": APPWRITE_API_KEY,
}

async function call(url, init) {
  const res = await fetch(url, { headers, ...init })
  const body = await res.json()
  if (!res.ok) throw new Error(`${res.status} ${body.message ?? JSON.stringify(body)}`)
  return body
}

const limit = encodeURIComponent(JSON.stringify({ method: "limit", values: [500] }))
const { rows } = await call(`${base}?queries[]=${limit}`)

const seen = new Set()
let changes = 0
for (const row of rows) {
  const name = row.name.trim()
  const next = tagByName.get(name)
  if (!next) { console.log(`  skip       ${name} (not in mapping, stays ${row.movementType ?? "untagged"})`); continue }
  seen.add(name)
  if (row.movementType === next) continue
  changes++
  console.log(`  ${APPLY ? "update" : "would set"} ${name}: ${row.movementType ?? "untagged"} → ${next}`)
  if (APPLY) {
    await call(`${base}/${row.$id}`, { method: "PATCH", body: JSON.stringify({ data: { movementType: next } }) })
  }
}
for (const name of tagByName.keys()) {
  if (!seen.has(name)) console.log(`  missing    ${name} (in mapping, not in the library)`)
}
console.log(`\n${changes} change(s)${APPLY ? " applied" : " — dry run, nothing written. Re-run with --apply."}`)
