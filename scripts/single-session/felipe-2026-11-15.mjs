// One-off session for felipegarciaovalle (coach 2026-11-15):
//   1. Sync breathing       constraint, 3 orange, 5 min   (NEW library warm-up)
//   2. One foot only        constraint, 2 blue,   5 min   (opposite foot)
//   3. One foot only        constraint, 4 green          (normal → choose → opposite → same)
//   4. Jump rope            intervals, 10 × 45 s on / 15 s off
//   5. Coffee break         10 min (rest, eat, get ready)
//   6. Project bouldering   ×2 (athlete picks the colour, 20 min each)
//   7. Stretching           10 min
//
// It also saves "Sync breathing" to the block library (if missing) so the
// coach can reuse it in the builder. It is NOT added to the automatic
// warm-up rotation (no `rotation` → not picked by plans).
//
// The workout is created as a coach protocol for the athlete and assigned as
// their active workout, like the coach UI does (createProtocol + assignProtocol).
//
// Usage (dry run by default — prints what it would do):
//   node --env-file=.env.local scripts/single-session/felipe-2026-11-15.mjs [--apply]
// Options: --username=<name> (default felipegarciaovalle), --no-assign

const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID } = process.env
const APPLY = process.argv.includes("--apply")
const ASSIGN = !process.argv.includes("--no-assign")
const USERNAME = (process.argv.find((a) => a.startsWith("--username=")) ?? "--username=felipegarciaovalle").slice(11)
const WORKOUT_NAME = "Feet & breathing + projects"

for (const [name, value] of Object.entries({ APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID })) {
  if (!value) { console.error(`Missing env var: ${name}`); process.exit(1) }
}

async function api(method, path, body) {
  const res = await fetch(`${APPWRITE_ENDPOINT}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Appwrite-Project": APPWRITE_PROJECT_ID, "X-Appwrite-Key": APPWRITE_API_KEY },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json.message ?? ""}`)
  return json
}
const db = `/tablesdb/${APPWRITE_DATABASE_ID}/tables`
const q = (o) => `queries[]=${encodeURIComponent(JSON.stringify(o))}`
const newId = () => Date.now().toString(16) + Math.random().toString(16).slice(2, 10)
const same = (a, b) => (a ?? "").trim().toLowerCase() === b.toLowerCase()

// ── Texts ──
const SYNC_BREATHING_DESC =
  "Time every move with your breath. Exhale as you pull and reach for the next hold. " +
  "When you stop on a hold, take a full breath in, and go to the next hold on the next exhale. " +
  "Don't hold your breath: if you lose the rhythm, pause, breathe, and start again."
const ONE_FOOT_RULE =
  "Rule: while a hand moves, only ONE foot can touch the wall. After the hand lands you can re-adjust your feet for the next move — the rule is only for the moment the hand moves."
const ONE_FOOT_OPPOSITE_DESC =
  "Use the foot opposite to the moving hand: left hand moves → right foot on the wall, left foot in the air (or mirroring). " + ONE_FOOT_RULE
const ONE_FOOT_PROGRESSION_DESC =
  "Same route, 4 attempts, each one different:\n" +
  "1) Normal — climb it as you like.\n" +
  "2) Your choice — one foot only, you pick which foot on each move.\n" +
  "3) Opposite — the foot opposite to the moving hand.\n" +
  "4) Same side — the foot on the same side as the moving hand.\n" + ONE_FOOT_RULE

// ── 1. Athlete ──
const { rows: found = [] } = await api("GET", `${db}/users/rows?${q({ method: "equal", attribute: "username", values: [USERNAME] })}`)
if (found.length === 0) {
  const { rows: all = [] } = await api("GET", `${db}/users/rows?${q({ method: "limit", values: [500] })}&${q({ method: "select", values: ["$id", "username"] })}`)
  const near = all.map((u) => u.username).filter((u) => u && /fel|garc|oval/i.test(u))
  console.error(`No user with username "${USERNAME}". Similar: ${near.join(", ") || "(none)"}. Re-run with --username=<name>.`)
  process.exit(1)
}
const athlete = found[0]
console.log(`Athlete: ${athlete.username} (${athlete.$id})`)

// ── 2. Library blocks ──
const { rows: library = [] } = await api("GET", `${db}/blocks/rows?${q({ method: "limit", values: [500] })}`)
const oneFoot = library.find((b) => b.type === "constraint_warmup" && same(b.name, "One foot only"))
if (!oneFoot) console.log('Library: "One foot only" not found — blocks will be created without a library link.')
let sync = library.find((b) => b.type === "constraint_warmup" && same(b.name, "Sync breathing"))
const syncData = { type: "constraint_warmup", blockName: "Sync breathing", description: SYNC_BREATHING_DESC, level: "", targetAttempts: 3, adaptation: "technique" }
if (sync) {
  console.log(`Library: "Sync breathing" already there (${sync.$id})`)
} else if (!APPLY) {
  console.log('Library: would create constraint "Sync breathing" (not in the auto warm-up rotation).')
} else {
  const body = { rowId: newId(), data: { name: "Sync breathing", type: "constraint_warmup", data: JSON.stringify(syncData) } }
  if (oneFoot?.$permissions?.length) body.permissions = oneFoot.$permissions
  sync = await api("POST", `${db}/blocks/rows`, body)
  console.log(`Library: created "Sync breathing" (${sync.$id})`)
}
const link = (row) => (row ? { libraryBlockId: row.$id } : {})

// ── 3. The workout ──
const blocks = [
  { ...syncData, level: "orange", targetAttempts: 3, timeLimit: 5, ...link(sync) },
  { type: "constraint_warmup", blockName: "One foot only", description: ONE_FOOT_OPPOSITE_DESC, level: "blue", targetAttempts: 2, timeLimit: 5, adaptation: "technique", ...link(oneFoot) },
  { type: "constraint_warmup", blockName: "One foot only", description: ONE_FOOT_PROGRESSION_DESC, level: "green", targetAttempts: 4, adaptation: "technique", ...link(oneFoot) },
  { type: "intervals", blockName: "Jump rope", description: "Jump rope: 45 s on, 15 s rest. 10 rounds.", series: 10, workTime: 45, restTime: 15 },
  { type: "free_session", blockName: "Coffee break", description: "Rest 10 minutes. Eat something, drink water, and get ready for the projects.", timeLimit: 10 },
  { type: "project_bouldering", blockName: "Project bouldering", description: "", grade: "", timeLimit: 20, restTime: 180, reviewPrompts: true },
  { type: "project_bouldering", blockName: "Project bouldering 2", description: "", grade: "", timeLimit: 20, restTime: 180, reviewPrompts: true },
  { type: "free_session", blockName: "Stretching", description: "10 minutes of easy stretching: forearms, shoulders, hips and hamstrings.", timeLimit: 10 },
]

const data = { name: WORKOUT_NAME, blocks: JSON.stringify(blocks), athleteId: athlete.$id, source: "coach" }
if (!APPLY) {
  console.log(`Would create workout "${WORKOUT_NAME}" with ${blocks.length} blocks:`)
  for (const b of blocks) console.log(`  - ${b.blockName} (${b.type}${b.level ? `, ${b.level}` : ""}${b.targetAttempts ? `, ${b.targetAttempts} attempts` : ""}${b.timeLimit ? `, ${b.timeLimit} min` : ""}${b.series ? `, ${b.series}×${b.workTime}s/${b.restTime}s` : ""})`)
  console.log(ASSIGN ? `Would assign it as ${athlete.username}'s active workout.` : "Would NOT assign it (--no-assign).")
  console.log("\nDry run only. Re-run with --apply to write.")
  process.exit(0)
}
const row = await api("POST", `${db}/protocol/rows`, { rowId: newId(), data })
console.log(`Created workout ${row.$id}`)
if (ASSIGN) {
  const today = new Date().toISOString().slice(0, 10)
  try {
    await api("PATCH", `${db}/users/rows/${athlete.$id}`, { data: { assignedProtocolId: row.$id, assignedAt: today } })
  } catch {
    await api("PATCH", `${db}/users/rows/${athlete.$id}`, { data: { assignedProtocolId: row.$id } })
  }
  console.log(`Assigned as ${athlete.username}'s active workout.`)
}
