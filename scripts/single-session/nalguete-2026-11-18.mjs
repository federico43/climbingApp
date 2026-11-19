// One-off workout for Nalguete (coach 2026-11-18): "Workout 12 · Leticia 4",
// the 4th of her "Leticia" series (workouts 9–11 of her conditioning plan,
// which ended on 15 Nov, so it can't build a 12th). The series alternates
// Hypertrophy (Leticia 1, 3) and Max force (Leticia 2🔥), so this one is Max
// force: Leticia 2's exercises again, each on a focus it already had in her
// sessions, with the jump rope warm-up of Leticia 1 and 3, and explosive
// squats (her own swap for Box Step-Ups in Leticia 2) instead of step-ups.
//   1. jump Rope  intervals, 12 × 30 s on / 30 s off (library block)
//   2. S&C 1      planch twist (max force) + explosive Squats (explosiveness)
//   3. S&C 2      TRX Hamstring Curl (max force) + One-Arm Inverted Row (max force)
//   4. S&C 3      TRX Triceps Extension (max force) + TRX Bulgarian Split Squat (max force)
//   S&C: 3 rounds, 180 s rest, 3–6 reps — as in Leticia 2.
//
// A standalone coach workout (not linked to the ended plan), saved like the
// coach UI saves one (same row permissions as her other coach workouts) and
// assigned as her active workout. Exercises are copied from the live
// exercise library, so photos and cues are current.
//
// Usage (dry run by default — prints what it would do):
//   node --env-file=.env.local scripts/single-session/nalguete-2026-11-18.mjs [--apply]
// Options: --username=<name> (default Nalguete), --no-assign,
//          --again (create it even if she already has a workout with this name)

const ENV = {
  APPWRITE_ENDPOINT: process.env.APPWRITE_ENDPOINT,
  APPWRITE_PROJECT_ID: process.env.APPWRITE_PROJECT_ID,
  APPWRITE_API_KEY: process.env.APPWRITE_API_KEY,
  APPWRITE_DATABASE_ID: process.env.APPWRITE_DATABASE_ID,
}
for (const [name, value] of Object.entries(ENV)) {
  if (!value) { console.error(`Missing env var: ${name}`); process.exit(1) }
}
const APPLY = process.argv.includes("--apply")
const ASSIGN = !process.argv.includes("--no-assign")
const AGAIN = process.argv.includes("--again")
const USERNAME = (process.argv.find((a) => a.startsWith("--username=")) ?? "--username=Nalguete").slice(11)
const WORKOUT_NAME = "Workout 12 · Leticia 4"

async function api(method, path, body) {
  const res = await fetch(`${ENV.APPWRITE_ENDPOINT}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Appwrite-Project": ENV.APPWRITE_PROJECT_ID, "X-Appwrite-Key": ENV.APPWRITE_API_KEY },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path.split("?")[0]} → ${res.status} ${json.message ?? ""}`)
  return json
}
const db = `/tablesdb/${ENV.APPWRITE_DATABASE_ID}/tables`
const q = (o) => `queries[]=${encodeURIComponent(JSON.stringify(o))}`
const newId = () => Date.now().toString(16) + Math.random().toString(16).slice(2, 10)
const norm = (s) => String(s ?? "").trim().toLowerCase()
const parseJson = (s) => {
  if (typeof s !== "string") return s ?? undefined
  try { return JSON.parse(s) } catch { return undefined }
}
async function all(table, queries = []) {
  const out = []; let cursor = null
  for (;;) {
    const qs = [...queries, q({ method: "limit", values: [100] })]
    if (cursor) qs.push(q({ method: "cursorAfter", values: [cursor] }))
    const { rows = [] } = await api("GET", `${db}/${table}/rows?${qs.join("&")}`)
    out.push(...rows)
    if (rows.length < 100) return out
    cursor = rows[rows.length - 1].$id
  }
}

// ── What goes in (ids from her Leticia workouts; names as a fallback) ──
const ROPE_BLOCK = { id: "6adc90dc0025f70c1727", name: "jump Rope" }
const EX = {
  planchTwist:   { id: "6a6ff8490021815012ce", name: "planch twist" },
  jumpSquats:    { id: "6ab1d9b70035e1212af7", name: "explosive Squats" },
  hamstringCurl: { id: "6af2267163781bb8c576", name: "TRX Hamstring Curl" },
  oneArmRow:     { id: "6a388d19000906d04e72", name: "One-Arm Inverted Row" },
  tricepsExt:    { id: "6af2266d6b8582519636", name: "TRX Triceps Extension" },
  bulgarian:     { id: "6af226720f552e863666", name: "TRX Bulgarian Split Squat" },
}
const REP_RANGE = { max_force: "3-6", hypertrophy: "8-12", explosiveness: "3-6" }
const FOCUS_LABEL = { max_force: "Max force", hypertrophy: "Hypertrophy", explosiveness: "Explosiveness" }
const REST_S = 180

// No block notes: the athlete knows how to make an exercise harder or easier
// (coach 2026-11-18). What matters is that every exercise is on a focus it
// can be trained at — the script stops if the library says otherwise.
const ROPE_DESC = ""
const SC1_DESC = ""
const SC2_DESC = ""
const SC3_DESC = ""

// ── 1. Athlete ──
let { rows: found = [] } = await api("GET", `${db}/users/rows?${q({ method: "equal", attribute: "username", values: [USERNAME] })}`)
if (found.length === 0) {
  const everyone = await all("users", [q({ method: "select", values: ["$id", "username"] })])
  found = everyone.filter((u) => norm(u.username) === norm(USERNAME))
  if (found.length === 0) {
    const near = everyone.map((u) => u.username).filter((u) => u && /alg|nal|leti/i.test(u))
    console.error(`No user with username "${USERNAME}". Similar: ${near.join(", ") || "(none)"}. Re-run with --username=<name>.`)
    process.exit(1)
  }
}
const athlete = await api("GET", `${db}/users/rows/${found[0].$id}`)
console.log(`Athlete: ${athlete.username} (${athlete.$id})`)

// ── 2. Her workouts: no duplicate, same permissions as the coach's others ──
const theirs = (await all("protocol", [q({ method: "equal", attribute: "athleteId", values: [athlete.$id] })]))
  .sort((a, b) => (a.$createdAt < b.$createdAt ? 1 : -1))
const existing = theirs.find((p) => norm(p.name) === norm(WORKOUT_NAME))
if (existing && !AGAIN) {
  console.log(`"${WORKOUT_NAME}" already exists for ${athlete.username} (${existing.$id}, created ${existing.$createdAt.slice(0, 10)}). Nothing to do; --again creates another one.`)
  process.exit(0)
}
const sibling = theirs.find((p) => p.source !== "library" && p.$permissions?.length)
const permissions = sibling?.$permissions ?? []
console.log(sibling ? `Permissions: same as "${sibling.name}" (${permissions.join(", ")})` : "Permissions: none found on her other workouts; the row gets the table's defaults.")

// ── 3. Library: the jump rope block and the exercises ──
const library = await all("blocks")
const rope = library.find((b) => b.$id === ROPE_BLOCK.id) ?? library.find((b) => b.type === "intervals" && norm(b.name) === norm(ROPE_BLOCK.name))
if (!rope) console.log(`Library: "${ROPE_BLOCK.name}" not found, the rope block is created without a library link.`)
const exercises = await all("exercises")
const exById = new Map(exercises.map((e) => [e.$id, e]))
const missing = []
const mismatches = []
const row = (ref) => {
  const r = exById.get(ref.id) ?? exercises.find((e) => norm(e.name) === norm(ref.name))
  if (!r) missing.push(ref.name)
  return r
}
const rows = Object.fromEntries(Object.entries(EX).map(([k, ref]) => [k, row(ref)]))
if (missing.length) {
  console.error(`Not in the exercise library: ${missing.join(", ")}. Nothing was written.`)
  process.exit(1)
}

// An exercise as the builder puts it in a block (exerciseDraftFromLibrary +
// the focus's rep range; no local ids, as stripLocalIds saves it).
function draft(ex, focus) {
  const unit = ex.unit ?? "reps"
  const repCounted = (ex.type === "reps" || ex.type === "both_sides") && unit !== "seconds"
  const focuses = parseJson(ex.focuses)
  if (Array.isArray(focuses) && focuses.length && !focuses.includes(focus)) {
    mismatches.push(`"${ex.name}" is set to ${FOCUS_LABEL[focus]}, but the library only allows ${focuses.map((f) => FOCUS_LABEL[f] ?? f).join(", ")}.`)
  }
  return {
    type: ex.type, name: ex.name, exerciseId: ex.$id, unit,
    photoUri: ex.photoUri ?? null, notes: ex.notes ?? undefined,
    movementType: ex.movementType ?? undefined, loadMode: ex.loadMode ?? "weight",
    levels: parseJson(ex.levels), loadStep: ex.loadStep ?? undefined,
    settingHarder: ex.settingHarder || undefined, settingEasier: ex.settingEasier || undefined,
    reps: repCounted ? REP_RANGE[focus] : (ex.defaultReps ?? "20-30"),
    focus,
    libraryFocuses: Array.isArray(focuses) && focuses.length ? focuses : null,
  }
}
const sc = (blockName, description, exs) => ({ type: "strength_conditioning", blockName, description, rounds: 3, restBetweenRounds: REST_S, exercises: exs })

// ── 4. The workout ──
const blocks = [
  {
    ...(rope ? parseJson(rope.data) ?? {} : {}),
    type: "intervals", blockName: rope?.name ?? ROPE_BLOCK.name, description: ROPE_DESC,
    series: 12, workTime: 30, restTime: 30,
    ...(rope ? { libraryBlockId: rope.$id } : {}),
  },
  sc("S&C 1", SC1_DESC, [draft(rows.planchTwist, "max_force"), draft(rows.jumpSquats, "explosiveness")]),
  sc("S&C 2", SC2_DESC, [draft(rows.hamstringCurl, "max_force"), draft(rows.oneArmRow, "max_force")]),
  sc("S&C 3", SC3_DESC, [draft(rows.tricepsExt, "max_force"), draft(rows.bulgarian, "max_force")]),
]
if (mismatches.length) {
  console.error(`Wrong focus, nothing was written:\n  ${mismatches.join("\n  ")}`)
  process.exit(1)
}
const shown = blocks.map((b) => (b.exercises ? { ...b, exercises: b.exercises.map((e) => ({ ...e })) } : b))
for (const b of blocks) if (b.exercises) for (const e of b.exercises) delete e.libraryFocuses

const data = { name: WORKOUT_NAME, blocks: JSON.stringify(blocks), athleteId: athlete.$id, source: "coach" }
const home = athlete.homeWorkoutId ? theirs.find((p) => p.$id === athlete.homeWorkoutId) : null
if (!APPLY) {
  console.log(`\nWould create "${WORKOUT_NAME}" with ${blocks.length} blocks:`)
  for (const [i, b] of shown.entries()) {
    if (b.type === "intervals") {
      console.log(`  ${i + 1}. ${b.blockName}: ${b.series} × ${b.workTime} s on / ${b.restTime} s off${b.libraryBlockId ? " (library block)" : ""}`)
    } else {
      console.log(`  ${i + 1}. ${b.blockName}: ${b.rounds} rounds, ${b.restBetweenRounds} s rest`)
      for (const e of b.exercises) console.log(`       - ${e.name}: ${e.reps}${e.type === "both_sides" ? " per side" : ""}, ${FOCUS_LABEL[e.focus]} (library allows: ${e.libraryFocuses ? e.libraryFocuses.map((f) => FOCUS_LABEL[f] ?? f).join(", ") : "all focuses"})`)
    }
  }
  console.log(ASSIGN ? `Would assign it as ${athlete.username}'s active workout.` : "Would NOT assign it (--no-assign).")
  if (home) console.log(`Note: her Home is pinned to "${home.name}". To show the new one, pick it in the app (her workouts, ⋯ → Show on athlete's home).`)
  console.log("\nDry run only. Re-run with --apply to write.")
  process.exit(0)
}

const body = { rowId: newId(), data }
if (permissions.length) body.permissions = permissions
const created = await api("POST", `${db}/protocol/rows`, body)
console.log(`Created workout "${WORKOUT_NAME}" (${created.$id})`)
if (ASSIGN) {
  const today = new Date().toISOString().slice(0, 10)
  try {
    await api("PATCH", `${db}/users/rows/${athlete.$id}`, { data: { assignedProtocolId: created.$id, assignedAt: today } })
  } catch {
    await api("PATCH", `${db}/users/rows/${athlete.$id}`, { data: { assignedProtocolId: created.$id } })
  }
  console.log(`Assigned as ${athlete.username}'s active workout.`)
}
if (home) console.log(`Note: her Home is pinned to "${home.name}". To show the new one, pick it in the app (her workouts, ⋯ → Show on athlete's home).`)
