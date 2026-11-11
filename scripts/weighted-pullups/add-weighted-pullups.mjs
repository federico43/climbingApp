// One-off script: adds "Weighted pull-ups" to the exercise library and puts
// it at the top of the pull-up ladder (… → Negative pull-ups → Pull Ups →
// Weighted pull-ups), so the pull-up assessment (utils/pullupAssessment.ts)
// can assign it and progression can step up onto it. Copies type, unit,
// movement type and permissions from the "Pull Ups" row. Idempotent: an
// existing "Weighted pull-ups" row is reused, an existing link is kept.
//
// Usage (dry run by default — prints what it would do):
//   node --env-file=.env.local scripts/weighted-pullups/add-weighted-pullups.mjs [--apply]
// (.env.local: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID)

const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID } = process.env
const APPLY = process.argv.includes("--apply")
for (const [name, value] of Object.entries({ APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID })) {
  if (!value) { console.error(`Missing env var: ${name}`); process.exit(1) }
}

const NAME = "Weighted pull-ups"
const base = `${APPWRITE_ENDPOINT}/tablesdb/${APPWRITE_DATABASE_ID}/tables/exercises/rows`
const headers = { "Content-Type": "application/json", "X-Appwrite-Project": APPWRITE_PROJECT_ID, "X-Appwrite-Key": APPWRITE_API_KEY }
async function call(url, init) {
  const res = await fetch(url, { headers, ...init })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${res.status} ${body.message ?? JSON.stringify(body)}`)
  return body
}
const parse = (raw) => { try { const v = typeof raw === "string" ? JSON.parse(raw) : raw; return Array.isArray(v) ? v : [] } catch { return [] } }
const norm = (s) => (s ?? "").trim().toLowerCase().replace(/[-\s]+/g, " ")

const limit = encodeURIComponent(JSON.stringify({ method: "limit", values: [500] }))
const { rows } = await call(`${base}?queries[]=${limit}`)

const pull = rows.find((r) => ["pull ups", "pull up", "pullups"].includes(norm(r.name)))
if (!pull) { console.error('No "Pull Ups" row in the library — nothing to copy from.'); process.exit(1) }
console.log(`Pull-up row: ${pull.name} (${pull.$id})`)

let weighted = rows.find((r) => norm(r.name) === norm(NAME) || /weighted pull/i.test(r.name))
if (weighted) {
  console.log(`  exists     ${weighted.name} (${weighted.$id})`)
} else {
  const data = {
    name: NAME,
    type: pull.type ?? "reps",
    ...(pull.unit ? { unit: pull.unit } : {}),
    movementType: pull.movementType ?? "pull_vertical",
    loadMode: "weight",
    loadStep: 2.5,
    focuses: JSON.stringify(["max_force", "hypertrophy"]),
    notes: "Belt or vest. Scapulas retracted, full range on every rep.",
  }
  console.log(`  ${APPLY ? "create" : "would create"}     ${NAME}`, data)
  if (APPLY) {
    weighted = await call(base, { method: "POST", body: JSON.stringify({ rowId: "unique()", data, permissions: pull.$permissions ?? [] }) })
    console.log(`  created ${weighted.$id}`)
  }
}

// The ladder link: the row whose levels end on Pull Ups gets Weighted
// pull-ups appended (levels are "harder than me" lists, utils/levelChain.ts).
const holder = rows.find((r) => r.loadMode === "level" && parse(r.levels).some((l) => l.exerciseId === pull.$id))
if (!holder) {
  console.log("  no ladder row lists Pull Ups — link it by hand in the ladder editor")
} else {
  const levels = parse(holder.levels)
  if (weighted && levels.some((l) => l.exerciseId === weighted.$id)) {
    console.log(`  linked     already on ${holder.name}'s ladder`)
  } else if (levels[levels.length - 1]?.exerciseId !== pull.$id) {
    console.log(`  ${holder.name}'s ladder doesn't end on Pull Ups — link Weighted pull-ups by hand in the ladder editor`)
  } else {
    const next = [...levels, { exerciseId: weighted?.$id ?? "<new id>", name: NAME }]
    console.log(`  ${APPLY ? "link" : "would link"}       ${holder.name}: ${levels.map((l) => l.name).join(" → ")} → ${NAME}`)
    if (APPLY) await call(`${base}/${holder.$id}`, { method: "PATCH", body: JSON.stringify({ data: { levels: JSON.stringify(next) } }) })
  }
}
console.log(APPLY ? "\nDone." : "\nDry run, nothing written. Re-run with --apply.")
