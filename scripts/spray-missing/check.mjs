// Read-only check (2026-11-20): why doesn't a sequence show up in a spray block?
//
// Spray blocks (Max bouldering, Base 1, Benchmark, Power boulders,
// Coordination boulders) don't list every sequence on the wall. The "Choose a
// sequence" screen only shows:
//   · Suggested: 5 sequences of the block's tag (with a flash colour: the 5
//     closest to the athlete's level; without one: only ones they've climbed);
//   · New on the wall: the 10 newest of that tag the athlete hasn't climbed.
// There is no search and no "see all". A sequence with no tag (or another
// tag) never shows, and an older one falls off once there are more.
//
// This script finds a sequence by name (accents and case ignored) and says,
// for one athlete, whether each spray block would list it and why not.
// It also prints table permissions and counts of untagged / unlevelled
// sequences. Changes nothing.
//
//   node --env-file=.env.local scripts/spray-missing/check.mjs --name "part of the name" --username athlete
//   node --env-file=.env.local scripts/spray-missing/check.mjs            (summary only)
// (.env.local: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID)

const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID } = process.env
for (const [k, v] of Object.entries({ APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID })) {
  if (!v) { console.error(`Missing env var: ${k}`); process.exit(1) }
}
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  if (i >= 0) return process.argv[i + 1]
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`))
  return eq ? eq.slice(name.length + 3) : undefined
}
const NAME = arg("name")
const USERNAME = arg("username")

// Same values as utils/sprayBlocks.ts
const BLOCKS = [
  { name: "Max bouldering", routeType: "max_bouldering" },
  { name: "Base 1", routeType: "base" },
  { name: "Benchmark", routeType: "max_bouldering" },
  { name: "Power boulders", routeType: "power" },
  { name: "Coordination boulders", routeType: "coordination" },
]
const SUGGESTION_COUNT = 5
const NEW_COUNT = 10
const FLASH_LEVEL = { orange: 1, blue: 2, green: 3, yellow: 4, red: 5, black: 7 }
const LEVEL_OFFSET = { base: -1, coordination: -1, power: 0, max_bouldering: 1 }

async function api(path) {
  const res = await fetch(`${APPWRITE_ENDPOINT}${path}`, {
    headers: { "X-Appwrite-Project": APPWRITE_PROJECT_ID, "X-Appwrite-Key": APPWRITE_API_KEY },
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${json.message ?? ""}`)
  return json
}
const q = (method, attribute, values) => JSON.stringify({ method, ...(attribute ? { attribute } : {}), ...(values ? { values } : {}) })
async function listAll(table, queries = []) {
  const all = []
  let cursor
  for (;;) {
    const qs = [...queries, q("limit", null, [100]), ...(cursor ? [q("cursorAfter", null, [cursor])] : [])]
    const { rows = [] } = await api(`/tablesdb/${APPWRITE_DATABASE_ID}/tables/${table}/rows?${qs.map((x) => `queries[]=${encodeURIComponent(x)}`).join("&")}`)
    all.push(...rows)
    if (rows.length < 100) return all
    cursor = rows[rows.length - 1].$id
  }
}
const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()

// ── Table + all sequences ──
const table = await api(`/tablesdb/${APPWRITE_DATABASE_ID}/tables/spray_routes`)
const perms = table.$permissions ?? []
const tableRead = perms.some((p) => /^read\("(users|any)"\)$/.test(p))
const routes = await listAll("spray_routes", [q("orderDesc", "$createdAt")])
console.log("spray_routes")
console.log(`  table permissions: ${perms.length ? perms.join(", ") : "(none)"}${tableRead ? "  → everyone can read every sequence" : "  → PROBLEM: athletes may only see their own sequences"}`)
console.log(`  sequences: ${routes.length}`)
const byType = {}
for (const r of routes) byType[r.type || "(no tag)"] = (byType[r.type || "(no tag)"] ?? 0) + 1
for (const [t, n] of Object.entries(byType)) console.log(`    ${t.padEnd(16)} ${n}`)
const noLevel = routes.filter((r) => typeof r.level !== "number").length
console.log(`  without a level: ${noLevel}`)
const untagged = routes.filter((r) => !r.type)
if (untagged.length) {
  console.log(`\n${untagged.length} sequence(s) with NO tag never show in any spray block:`)
  for (const r of untagged.slice(0, 30)) console.log(`  ${r.$id}  "${r.name}"  ${r.$createdAt.slice(0, 10)}`)
  if (untagged.length > 30) console.log(`  … and ${untagged.length - 30} more`)
}

if (!NAME) {
  console.log(`\nAdd --name "part of the name" (and --username athlete) to check one sequence.`)
  process.exit(0)
}

// ── The sequence(s) asked about ──
const matches = routes.filter((r) => fold(r.name).includes(fold(NAME)))
console.log(`\nSequences matching "${NAME}" (accents/case ignored): ${matches.length}`)
if (!matches.length) {
  console.log("  None. It may have been deleted, or saved under another name.")
  process.exit(0)
}
const plainMatches = routes.filter((r) => String(r.name ?? "").toLowerCase().includes(NAME.trim().toLowerCase()))
if (plainMatches.length < matches.length) {
  console.log(`  Note: the app's search box (Spray Wall tab / route picker) doesn't ignore accents — it would find only ${plainMatches.length}.`)
}

// ── The athlete: flash colour + what they've climbed ──
let athlete = null
let records = new Map()
if (USERNAME) {
  const users = await listAll("users", [q("equal", "username", [USERNAME])])
  athlete = users[0] ?? null
  if (!athlete) console.log(`\nNo user with username "${USERNAME}" — checking without an athlete (no flash, nothing climbed).`)
  else {
    const sessions = await listAll("workoutsession", [q("equal", "userId", [athlete.$id])])
    for (const s of sessions) {
      let attempts = []
      try { attempts = JSON.parse(s.attempts || "[]") } catch { continue }
      if (!Array.isArray(attempts)) continue
      for (const a of attempts) {
        if (!a?.routeId) continue
        const r = records.get(a.routeId) ?? { routeId: a.routeId, tries: 0, sends: 0, lastAt: "" }
        r.tries++
        if (a.success) r.sends++
        if (s.$createdAt > r.lastAt) r.lastAt = s.$createdAt
        records.set(a.routeId, r)
      }
    }
    console.log(`\nAthlete ${athlete.username} (${athlete.$id}): flash ${athlete.flashLevel ?? "(none)"}, ${sessions.length} sessions, ${records.size} sequences climbed`)
  }
}

// Same order as suggestSprayRoutes / newSprayRoutes in utils/sprayBlocks.ts
function listed(routeType) {
  const base = athlete?.flashLevel ? FLASH_LEVEL[athlete.flashLevel] : undefined
  const target = base == null ? null : Math.max(1, Math.min(8, base + (LEVEL_OFFSET[routeType] ?? 0)))
  const ofType = routes.filter((r) => r.type === routeType)
  const bySends = (a, b) => a.sends - b.sends || a.lastAt.localeCompare(b.lastAt) || a.routeId.localeCompare(b.routeId)
  let sug
  if (target == null) {
    sug = [...records.values()].filter((r) => ofType.some((x) => x.$id === r.routeId)).sort(bySends)
  } else {
    const lvl = new Map(ofType.map((r) => [r.$id, r.level]))
    const dist = (id) => (typeof lvl.get(id) === "number" ? Math.abs(lvl.get(id) - target) : Infinity)
    sug = ofType.map((r) => records.get(r.$id) ?? { routeId: r.$id, tries: 0, sends: 0, lastAt: "" })
      .sort((a, b) => { const da = dist(a.routeId), db = dist(b.routeId); return (da === db ? 0 : da < db ? -1 : 1) || bySends(a, b) })
  }
  const suggested = sug.slice(0, SUGGESTION_COUNT).map((r) => r.routeId)
  const fresh = ofType
    .filter((r) => !suggested.includes(r.$id) && !records.has(r.$id))
    .sort((a, b) => b.$createdAt.localeCompare(a.$createdAt) || a.$id.localeCompare(b.$id))
  return { target, suggested, fresh: fresh.slice(0, NEW_COUNT).map((r) => r.$id), freshAll: fresh.map((r) => r.$id), sugAll: sug.map((r) => r.routeId) }
}

for (const r of matches) {
  const others = (r.$permissions ?? []).some((p) => /^read\("(users|any)"\)$/.test(p))
  console.log(`\n"${r.name}"  id ${r.$id}`)
  console.log(`  tag: ${r.type || "(none)"} · level: ${r.level ?? "(none)"} · wall: ${r.wallId || "(none)"} · built by: ${r.athleteId || "coach"} · created ${r.$createdAt.slice(0, 10)}`)
  if (!tableRead && !others && r.athleteId !== athlete?.$id) console.log("  ✗ Other athletes can't read this row (no Users read on the table or the row).")
  const rec = records.get(r.$id)
  if (athlete) console.log(`  ${athlete.username}: ${rec ? `${rec.tries} tries, ${rec.sends} tops` : "never climbed"}`)
  if (!r.type) { console.log("  ✗ No tag → not listed in ANY spray block. Re-tag it with scripts/spray-route-type/check.mjs."); continue }
  for (const b of BLOCKS.filter((b) => b.routeType === r.type)) {
    const l = listed(b.routeType)
    if (l.suggested.includes(r.$id)) { console.log(`  ✓ ${b.name}: listed under Suggested`); continue }
    if (l.fresh.includes(r.$id)) { console.log(`  ✓ ${b.name}: listed under New on the wall`); continue }
    let why
    if (rec && l.target == null) why = `climbed before, but it's #${l.sugAll.indexOf(r.$id) + 1} by fewest tops — only the first ${SUGGESTION_COUNT} are suggested`
    else if (rec) why = `climbed before; #${l.sugAll.indexOf(r.$id) + 1} by closeness to level ${l.target} — only the first ${SUGGESTION_COUNT} are suggested`
    else if (l.target != null) why = `#${l.sugAll.indexOf(r.$id) + 1} by closeness to level ${l.target} (its level: ${r.level ?? "none"}), and #${l.freshAll.indexOf(r.$id) + 1} of the newest not-climbed — only ${SUGGESTION_COUNT} + ${NEW_COUNT} are shown`
    else why = `#${l.freshAll.indexOf(r.$id) + 1} of the newest not-climbed — only the ${NEW_COUNT} newest are shown`
    console.log(`  ✗ ${b.name}: NOT listed (${why})`)
  }
  for (const b of BLOCKS.filter((b) => b.routeType !== r.type)) console.log(`  ✗ ${b.name}: NOT listed (tagged ${r.type}, block wants ${b.routeType})`)
}
