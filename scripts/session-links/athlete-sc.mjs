// Read-only diagnosis: why an athlete's S&C exercises (e.g. pull) don't show
// on the stats charts. For every S&C exercise in the athlete's sessions, prints
// its movement type (block / library) and what was logged — the chart skips
// an exercise without a movement type, or with no weight / reps logged.
//
//   node --env-file=.env.local scripts/session-links/athlete-sc.mjs <username>

const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID } = process.env
const who = (process.argv[2] ?? "").toLowerCase()

async function api(path) {
  const res = await fetch(`${APPWRITE_ENDPOINT}${path}`, {
    headers: { "X-Appwrite-Project": APPWRITE_PROJECT_ID, "X-Appwrite-Key": APPWRITE_API_KEY },
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${json.message ?? ""}`)
  return json
}
const db = `/tablesdb/${APPWRITE_DATABASE_ID}/tables`
const q = (o) => `queries[]=${encodeURIComponent(JSON.stringify(o))}`
async function all(table, queries = []) {
  const out = []
  let cursor = null
  for (;;) {
    const qs = [...queries, q({ method: "limit", values: [100] })]
    if (cursor) qs.push(q({ method: "cursorAfter", values: [cursor] }))
    const { rows } = await api(`${db}/${table}/rows?${qs.join("&")}`)
    out.push(...rows)
    if (rows.length < 100) return out
    cursor = rows[rows.length - 1].$id
  }
}
const parse = (s) => { try { return JSON.parse(s || "[]") } catch { return [] } }
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/[\s_]+/g, "")

const users = await all("users", [q({ method: "select", values: ["$id", "username"] })])
const matches = users.filter((u) => norm(u.username).includes(norm(who)))
console.log(`Users matching "${who}": ${matches.map((u) => `${u.username} (${u.$id})`).join(", ") || "none"}`)
if (matches.length !== 1) process.exit(matches.length ? 0 : 1)
const user = matches[0]

const library = await all("exercises")
const lib = new Map(library.map((e) => [e.$id, e]))
const libByName = new Map(library.filter((e) => e.name).map((e) => [e.name.trim().toLowerCase(), e]))

const sessions = await all("workoutsession", [q({ method: "equal", attribute: "userId", values: [user.$id] })])
sessions.sort((a, b) => (a.$createdAt < b.$createdAt ? -1 : 1))
console.log(`${sessions.length} sessions\n`)

const plans = await all("training_plans", [q({ method: "equal", attribute: "athleteId", values: [user.$id] })]).catch((e) => (console.log(`plans: ${e.message}`), []))
for (const p of plans) console.log(`plan ${p.$id}: ${p.status} · window ${p.windowStart ?? p.startDate ?? "?"} → ${p.windowEnd ?? "?"}`)
console.log("")

for (const s of sessions) {
  const protocol = parse(s.protocol)
  const attempts = parse(s.attempts)
  const firstTs = attempts[0]?.timestamp ? new Date(attempts[0].timestamp).toISOString().slice(0, 10) : s.$createdAt.slice(0, 10)
  protocol.forEach((block, i) => {
    if (block?.type !== "strength_conditioning") return
    const own = attempts.filter((a) => a?.blockIndex === i && a?.type === "strength_conditioning" && a.scData)
    console.log(`${firstTs}  session ${s.$id}  block ${i} "${block.name ?? ""}": ${(block.exercises ?? []).length} exercises, ${own.length} S&C attempts`)
    for (const ex of block.exercises ?? []) {
      const libEx = (ex.exerciseId && lib.get(ex.exerciseId)) || libByName.get(String(ex.name ?? "").trim().toLowerCase())
      const mine = own.filter((a) => {
        const id = a.scData.exerciseId
        return (id && (ex.exerciseId === id || (ex.levels ?? []).some((l) => l?.exerciseId === id))) || ex.name === a.scData.exerciseName
      })
      const logged = mine.map((a) => `${a.scData.weight ?? a.scData.weightLeft ?? "–"}kg×${a.scData.repsCompleted ?? a.scData.repsLeft ?? "–"}`).join(" ")
      console.log(`    ${ex.name}  id ${ex.exerciseId ?? "–"}  move block=${ex.movementType ?? "–"} lib=${libEx?.movementType ?? (libEx ? "–" : "NOT IN LIBRARY")}  loadMode ${libEx?.loadMode ?? ex.loadMode ?? "–"}  focus ${ex.focus ?? "–"}  logged ${mine.length}: ${logged}`)
    }
    const unmatched = own.filter((a) => !(block.exercises ?? []).some((ex) => {
      const id = a.scData.exerciseId
      return (id && (ex.exerciseId === id || (ex.levels ?? []).some((l) => l?.exerciseId === id))) || ex.name === a.scData.exerciseName
    }))
    if (unmatched.length) console.log(`    ${unmatched.length} attempts match no exercise: ${[...new Set(unmatched.map((a) => a.scData.exerciseName ?? a.scData.exerciseId))].join(", ")}`)
  })
}
