// Read-only: why a plan workout chose a pull-up ladder step (e.g. Negative
// pull-ups) while the builder says the athlete progressed to Pull Ups.
// Prints the athlete's pull-up test, the active plan's focuses and pull
// picks, the plan workouts' pull exercises with their focus, and every
// session on the pull-up ladder (date, focus, exercise and reps per round).
// Changes nothing.
//   node --env-file=.env.local scripts/diagnose/pullup-ladder.mjs --username=NAME
const { APPWRITE_ENDPOINT: E, APPWRITE_PROJECT_ID: P, APPWRITE_API_KEY: K, APPWRITE_DATABASE_ID: DB } = process.env
for (const [n, v] of Object.entries({ E, P, K, DB })) if (!v) { console.error("Missing variable", n); process.exit(1) }
const USERNAME = process.argv.find((a) => a.startsWith("--username="))?.slice(11)
if (!USERNAME) { console.error("Usage: ... pullup-ladder.mjs --username=NAME"); process.exit(1) }
const q = (o) => "queries[]=" + encodeURIComponent(JSON.stringify(o))
const get = async (path) => {
  const r = await fetch(E + path, { headers: { "X-Appwrite-Project": P, "X-Appwrite-Key": K } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`GET ${path} → ${r.status} ${j.message ?? ""}`)
  return j
}
async function rows(table, queries = []) {
  const out = []
  for (let cursor; ;) {
    const qs = [...queries, { method: "limit", values: [100] }, ...(cursor ? [{ method: "cursorAfter", values: [cursor] }] : [])]
    const page = (await get(`/tablesdb/${DB}/tables/${table}/rows?${qs.map(q).join("&")}`)).rows
    out.push(...page)
    if (page.length < 100) return out
    cursor = page.at(-1).$id
  }
}
const json = (s, d) => { try { return typeof s === "string" ? JSON.parse(s) : (s ?? d) } catch { return d } }

const users = await rows("users")
const user = users.find((u) => (u.username ?? "").toLowerCase() === USERNAME.toLowerCase())
if (!user) {
  const near = users.filter((u) => (u.username ?? "").toLowerCase().includes(USERNAME.toLowerCase().slice(0, 3))).map((u) => u.username)
  console.error(`No user "${USERNAME}". Similar: ${near.join(", ") || "none"}`); process.exit(1)
}
console.log(`Athlete: ${user.username} (${user.$id})`)
console.log(`Pull-up test: ${user.pullupTest ?? "none"}`)
console.log(`Band combos: ${user.bandCombos ?? "none"}`)

// The pull-up ladder: every library row linked to Pull Ups by levels.
const lib = await rows("exercises")
const byId = new Map(lib.map((r) => [r.$id, r]))
const ladderIds = new Set()
for (const r of lib) {
  const levels = json(r.levels, [])
  const ids = [r.$id, ...levels.map((l) => l.exerciseId)]
  if (ids.some((id) => /pull[- ]?ups?\b/i.test(byId.get(id)?.name ?? "") || /pull[- ]?ups?\b/i.test(r.name))) ids.forEach((id) => ladderIds.add(id))
}
console.log("\nPull-up ladder rows (name · used for · levels):")
for (const id of ladderIds) {
  const r = byId.get(id); if (!r) continue
  const lv = json(r.levels, []).map((l) => l.name).join(" → ")
  console.log(`  ${r.name} [${r.$id}] · ${json(r.focuses, []).join("/") || "all"}${lv ? " · levels: " + lv : ""}`)
}

const plans = (await rows("training_plans", [{ method: "equal", attribute: "athleteId", values: [user.$id] }]))
  .sort((a, b) => b.$createdAt.localeCompare(a.$createdAt))
const plan = plans.find((p) => p.status === "active") ?? plans[0]
if (plan) {
  console.log(`\nPlan "${plan.name}" (${plan.$id}) ${plan.status} ${plan.windowStart}…${plan.windowEnd} · S&C focuses: ${json(plan.scFocuses, []).join(", ") || "all three"}`)
  for (const p of json(plan.scPatterns, [])) console.log(`  ${p.movementType}: ${(p.exerciseIds ?? []).map((id) => byId.get(id)?.name ?? id).join(" + ")}`)
  const workouts = (await rows("protocol", [{ method: "equal", attribute: "planId", values: [plan.$id] }]))
    .sort((a, b) => (a.planIndex ?? 0) - (b.planIndex ?? 0) || a.$createdAt.localeCompare(b.$createdAt))
  console.log("\nPlan workouts (pull-up ladder exercises):")
  for (const w of workouts) {
    const exs = json(w.blocks, []).filter((b) => b?.type === "strength_conditioning").flatMap((b) => b.exercises ?? [])
      .filter((e) => ladderIds.has(e.exerciseId) || /pull/i.test(e.name ?? ""))
    console.log(`  #${w.planIndex ?? "-"} ${w.$createdAt.slice(0, 10)} ${w.name}${w.$id === user.assignedProtocolId ? " (assigned)" : ""}: ${exs.map((e) => `${e.name} @${e.focus ?? "?"} ${e.reps ?? ""}`).join(" | ") || "none"}`)
  }
}

console.log("\nSessions on the pull-up ladder (newest first):")
const sessions = (await rows("workoutsession", [{ method: "equal", attribute: "userId", values: [user.$id] }, { method: "orderDesc", attribute: "$createdAt" }]))
let n = 0
for (const s of sessions) {
  const protocol = json(s.protocol, [])
  const hits = json(s.attempts, []).filter((a) => a?.type === "strength_conditioning" && (ladderIds.has(a.scData?.exerciseId) || /pull[- ]?up/i.test(a.scData?.exerciseName ?? "")))
  if (!hits.length) continue
  const focusOf = (a) => a.scData?.focus ?? (protocol[a.blockIndex]?.exercises ?? []).find((e) => e.exerciseId === a.scData?.exerciseId || e.name === a.scData?.exerciseName)?.focus ?? "?"
  console.log(`  ${s.$createdAt.slice(0, 10)}: ${hits.sort((a, b) => (a.scData?.round ?? 0) - (b.scData?.round ?? 0)).map((a) => `R${a.scData?.round ?? "?"} ${a.scData?.exerciseName ?? byId.get(a.scData?.exerciseId)?.name} @${focusOf(a)} ×${a.scData?.repsCompleted ?? "?"}${a.scData?.band ? " band " + a.scData.band : ""}`).join(" · ")}`)
  if (++n >= 15) break
}
if (!n) console.log("  none")
