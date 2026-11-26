// Thursday 2026-11-26 (coach 2026-11-25, thread "Build tomorrow's workouts
// for four athletes"). Run AFTER building the plan workouts from each Plan
// card in the app: Felipe Uribe W8, Paula Cadena W9, AleFuego W7 and Pablo W1
// (Pablo first needs his new Fear management plan, made in the app).
//   1. Felipe Uribe: takes the fingers / grip exercise out of his new plan
//      workout's S&C (he's coming back from an injury) and gives him one
//      session task (runs after his warm-up).
//   2. Paula, AleFuego and Pablo train together, same order: Quitapresas
//      (2 attempts) → Show de talentos (15 min rehearse, each with their own
//      boulder, + 10 min show) → route exploration → the rest of their plan
//      workout (main block, S&C…). The plan's own warm-up is dropped.
//   3. Saves "Show de talentos" (and "Quitapresas" if missing) in the block
//      library. Not in the automatic rotation.
// Every step skips itself when it's already done, so it's safe to re-run.
//
// Dry run by default (prints what it would do):
//   node --env-file=.env.local scripts/single-session/group-2026-11-26.mjs [--apply]
// Options: --pablo=<username> (default p1blis81)

const { APPWRITE_ENDPOINT: E, APPWRITE_PROJECT_ID: P, APPWRITE_API_KEY: K, APPWRITE_DATABASE_ID: DB } = process.env
for (const [n, v] of Object.entries({ E, P, K, DB })) if (!v) { console.error("Missing env var", n); process.exit(1) }
const APPLY = process.argv.includes("--apply")
const arg = (key, fallback) => process.argv.find((a) => a.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback
const PABLO = arg("pablo", "p1blis81")
const TODAY = "2026-11-26"

async function api(method, path, body) {
  const res = await fetch(E + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Appwrite-Project": P, "X-Appwrite-Key": K },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path.split("?")[0]} → ${res.status} ${json.message ?? ""}`)
  return json
}
const db = `/tablesdb/${DB}/tables`
const q = (o) => "queries[]=" + encodeURIComponent(JSON.stringify(o))
const list = async (table, queries = []) => (await api("GET", `${db}/${table}/rows?${[...queries, { method: "limit", values: [500] }].map(q).join("&")}`)).rows ?? []
const json = (s, d) => { try { return typeof s === "string" ? JSON.parse(s) : (s ?? d) } catch { return d } }
const newId = () => Date.now().toString(16) + Math.random().toString(16).slice(2, 10)
const same = (a, b) => String(a ?? "").trim().toLowerCase() === String(b).trim().toLowerCase()
const say = (s) => console.log(s)
const would = (s) => say(`${APPLY ? "" : "[dry run] would "}${s}`)

// ── Texts ──
const TALENT_NAME = "Show de talentos"
const TALENT_DESC =
  "Group challenge. Each climber gets one boulder (yours is below). " +
  "You have 15 minutes to rehearse it: start with a couple of easy goes to warm up, then work out the beta and practise the hard part. " +
  "After that comes the show: each of you climbs your boulder once in front of the others."
const SHOW_DESC =
  "Show time. Each climber climbs their boulder once while the other two watch. " +
  "The two watching each give a score from 1 to 5 for: clean execution (no slips or readjusting), precise feet, flow (no long stops), and commitment. " +
  "Add up the scores and say one thing that went well and one to improve."
const BOULDERS = {
  alefuego: "Your boulder: la verde de presas azules, primera placa al lado del spray.",
  pablo: "Your boulder: la amarilla de presas moradas, segunda placa.",
  paula: "Your boulder: la verde de presas moradas del slab.",
}
const FELIPE_TASK = "Green, white holds slab: rehearse the beta from last session"

// ── Library ──
const library = await list("blocks")
let talent = library.find((b) => b.type === "free_session" && same(b.name, TALENT_NAME))
const talentData = { type: "free_session", blockName: TALENT_NAME, description: TALENT_DESC, timeLimit: 15 }
const oldTalent = library.find((b) => /show talentos/i.test(b.name ?? ""))
if (talent) say(`Library: "${TALENT_NAME}" already there (${talent.$id})`)
else if (!APPLY) would(`create library block "${TALENT_NAME}" (free session, 15 min)`)
else {
  const body = { rowId: newId(), data: { name: TALENT_NAME, type: "free_session", data: JSON.stringify(talentData) } }
  if (oldTalent?.$permissions?.length) body.permissions = oldTalent.$permissions
  talent = await api("POST", `${db}/blocks/rows`, body)
  say(`Library: created "${TALENT_NAME}" (${talent.$id})`)
}
const talentBlocks = (who) => [
  { ...talentData, description: `${TALENT_DESC}\n\n${BOULDERS[who]}`, ...(talent ? { libraryBlockId: talent.$id } : {}) },
  { type: "free_session", blockName: `${TALENT_NAME} · show`, description: SHOW_DESC, timeLimit: 10 },
]
const hasTalent = (blocks) => blocks.some((b) => same(b?.blockName, TALENT_NAME))

// ── Users ──
const users = await list("users", [{ method: "select", values: ["$id", "username", "flashLevel", "nextTasks"] }])
function user(username) {
  const u = users.find((x) => same(x.username, username))
  if (!u) {
    const near = users.map((x) => x.username).filter((n) => n && n.toLowerCase().includes(username.toLowerCase().slice(0, 3)))
    say(`! No user "${username}". Similar: ${near.join(", ") || "none"}`)
  }
  return u
}

// The plan workout built for this slot (newest), or null.
async function planWorkout(u, index) {
  const plans = await list("training_plans", [{ method: "equal", attribute: "athleteId", values: [u.$id] }, { method: "equal", attribute: "status", values: ["active"] }])
  const plan = plans[0]
  if (!plan) { say(`! ${u.username}: no active plan`); return null }
  const rows = (await list("protocol", [{ method: "equal", attribute: "planId", values: [plan.$id] }]))
    .filter((w) => w.planIndex === index && !w.planPart)
    .sort((a, b) => b.$createdAt.localeCompare(a.$createdAt))
  if (!rows[0]) say(`! ${u.username}: Workout ${index} isn't built yet. Create it from their Plan card in the app, then run this again.`)
  return rows[0] ?? null
}
const blockLine = (b) => `${b.blockName ?? b.type}${b.timeLimit ? ` ${b.timeLimit} min` : ""}${Array.isArray(b.exercises) ? ` [${b.exercises.map((e) => e.name).join(", ")}]` : ""}`
async function saveBlocks(w, blocks, what) {
  say(`  → ${blocks.map(blockLine).join(" · ")}`)
  if (!APPLY) return would(`save "${w.name}" (${what})`)
  await api("PATCH", `${db}/protocol/rows/${w.$id}`, { data: { blocks: JSON.stringify(blocks) } })
  say(`  saved "${w.name}" (${what})`)
}

// ── 1. Felipe Uribe ──
say("\n── Felipe Uribe ──")
const felipe = user("Felipe Uribe")
if (felipe) {
  const w = await planWorkout(felipe, 8)
  if (w) {
    const GRIP = new Set(["edge lifts", "repeaters", "jumps to catch"])
    const isGrip = (e) => e?.movementType === "carry_grip" || GRIP.has(String(e?.name ?? "").trim().toLowerCase())
    const blocks = json(w.blocks, [])
    const removed = blocks.flatMap((b) => (b.type === "strength_conditioning" ? (b.exercises ?? []).filter(isGrip).map((e) => e.name) : []))
    if (!removed.length) say(`  "${w.name}": no grip exercise in it, nothing to take out.`)
    else {
      say(`  "${w.name}": taking out ${removed.join(", ")}`)
      const next = blocks
        .map((b) => (b.type === "strength_conditioning" ? { ...b, exercises: (b.exercises ?? []).filter((e) => !isGrip(e)) } : b))
        .filter((b) => b.type !== "strength_conditioning" || b.exercises.length > 0)
      await saveBlocks(w, next, "no grip")
    }
  }
  const list0 = json(felipe.nextTasks, null)
  const tasks = Array.isArray(list0?.tasks) ? list0.tasks : []
  if (tasks.some((t) => same(t.text, FELIPE_TASK))) say(`  Task already there: "${FELIPE_TASK}"`)
  else if (tasks.length >= 2) say(`! Felipe already has 2 open tasks (${tasks.map((t) => t.text).join(" | ")}). Not adding.`)
  else {
    const value = JSON.stringify({ tasks: [...tasks, { id: newId(), text: FELIPE_TASK, mode: "tries", amount: 5, added: TODAY }], updatedAt: Date.now() })
    if (!APPLY) would(`add task "${FELIPE_TASK}" (5 tries)`)
    else { await api("PATCH", `${db}/users/rows/${felipe.$id}`, { data: { nextTasks: value } }); say(`  Task added: "${FELIPE_TASK}" (5 tries)`) }
  }
}

// ── 2. The group: Paula Cadena, AleFuego, Pablo ──
// Same order for the three (coach 2026-11-25): Quitapresas (2 attempts) →
// Show de talentos (rehearse + show) → route exploration → whatever the plan
// workout has next (its main block, S&C…). The plan's own warm-up (1 on 1 off
// / constraints) is dropped; its route exploration is kept and moved.
let quita = library.find((b) => /quita\s*presas/i.test(b.name ?? ""))
const quitaData = quita
  ? { ...json(quita.data, {}), blockName: quita.name, type: quita.type }
  : { type: "constraint_warmup", blockName: "Quitapresas", description: "Quitapresas, the warm-up game you know. 2 attempts.", level: "orange", targetAttempts: 2, adaptation: "technique" }
if (quita) say(`\nLibrary: using "${quita.name}" (${quita.type}, ${quita.$id})`)
else if (!APPLY) would('create library block "Quitapresas" (constraint warm-up, 2 attempts, orange)')
else {
  const body = { rowId: newId(), data: { name: "Quitapresas", type: "constraint_warmup", data: JSON.stringify(quitaData) } }
  if (oldTalent?.$permissions?.length) body.permissions = oldTalent.$permissions
  quita = await api("POST", `${db}/blocks/rows`, body)
  say(`Library: created "Quitapresas" (${quita.$id})`)
}
const quitaBlock = () => ({ ...quitaData, ...(quitaData.type === "constraint_warmup" ? { targetAttempts: 2 } : {}), ...(quita ? { libraryBlockId: quita.$id } : {}) })
const exploreRow = library.find((b) => b.type === "route_exploration")
const isWarmup = (b) => b?.type === "constraint_warmup" || (b?.type === "intervals" && (b.kind === "warmup" || same(b.blockName, "1 on 1 off")))

for (const [username, index, who] of [["Paula Cadena", 9, "paula"], ["AleFuego", 7, "alefuego"], [PABLO, 1, "pablo"]]) {
  say(`\n── ${username} ──`)
  const u = user(username)
  const w = u && (await planWorkout(u, index))
  if (!w) continue
  const blocks = json(w.blocks, [])
  if (hasTalent(blocks)) { say(`  "${w.name}" already has ${TALENT_NAME}.`); continue }
  say(`  "${w.name}" now: ${blocks.map(blockLine).join(" · ")}`)
  let explore = blocks.find((b) => b?.type === "route_exploration")
  if (!explore) {
    if (!exploreRow) say("! No route exploration in the workout or the library: left out.")
    else { explore = { ...json(exploreRow.data, {}), type: "route_exploration", blockName: exploreRow.name, libraryBlockId: exploreRow.$id }; say(`  (no exploration in it: adding "${exploreRow.name}" from the library)`) }
  }
  const dropped = blocks.filter(isWarmup).map((b) => b.blockName)
  if (dropped.length) say(`  dropping the plan's warm-up: ${dropped.join(", ")}`)
  const rest = blocks.filter((b) => !isWarmup(b) && b?.type !== "route_exploration")
  await saveBlocks(w, [quitaBlock(), ...talentBlocks(who), ...(explore ? [explore] : []), ...rest], "group order")
}

say(APPLY ? "\nDone." : "\nDry run only. Re-run with --apply to write.")
