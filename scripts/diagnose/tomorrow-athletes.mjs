// Read-only: everything needed to build tomorrow's workouts for a few
// athletes (thread "Build tomorrow's workouts for four athletes", 2026-11-26).
// For each name it prints the matching users, and for the best match:
//   - their active training plan and which plan workout is up next (the same
//     rule as the Plan tab: the first built one not done yet, else the first
//     not built), with its blocks, or the rotation's main type if not built;
//   - their open session tasks (users.nextTasks), active workout and flash;
//   - their latest sessions, block by block (tries, sends, fall reasons, notes).
// Also searches the block library and the coach's workouts for --find
// (default "talent") and prints the matching blocks in full.
// Writes NOTHING to Appwrite. Saves the output to
// scripts/diagnose/out/tomorrow-athletes.txt + .json (git-ignored).
//
//   node --env-file=.env.local scripts/diagnose/tomorrow-athletes.mjs
// Options:
//   --athletes="Felipe Uribe,Paula Cadena,Paulo,Alefuego"  names to look up
//   --pick="Paulo=paulo_r,Felipe Uribe=felipeu"            force a username (or user id) for a name
//   --find=talent                                           library search text
//   --sessions=6                                            sessions per athlete
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const { APPWRITE_ENDPOINT: E, APPWRITE_PROJECT_ID: P, APPWRITE_API_KEY: K, APPWRITE_DATABASE_ID: DB } = process.env
for (const [n, v] of Object.entries({ E, P, K, DB })) if (!v) { console.error("Missing env var", n); process.exit(1) }
const arg = (key, fallback) => {
  const a = process.argv.find((x) => x.startsWith(`--${key}=`))
  return a ? a.slice(key.length + 3) : fallback
}
const NAMES = arg("athletes", "Felipe Uribe,Paula Cadena,Paulo,Alefuego").split(",").map((s) => s.trim()).filter(Boolean)
const PICK = Object.fromEntries(arg("pick", "").split(",").filter((s) => s.includes("=")).map((s) => s.split("=").map((x) => x.trim())))
const FIND = arg("find", "talent")
const N_SESSIONS = Number(arg("sessions", "6")) || 6

const lines = []
const out = (...a) => { const s = a.join(" "); lines.push(s); console.log(s) }
const dump = {}

const q = (o) => "queries[]=" + encodeURIComponent(JSON.stringify(o))
async function get(path) {
  const r = await fetch(E + path, { headers: { "X-Appwrite-Project": P, "X-Appwrite-Key": K } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`GET ${path.split("?")[0]} → ${r.status} ${j.message ?? ""}`)
  return j
}
async function rows(table, queries = []) {
  const all = []
  for (let cursor; ;) {
    const qs = [...queries, { method: "limit", values: [100] }, ...(cursor ? [{ method: "cursorAfter", values: [cursor] }] : [])]
    const page = (await get(`/tablesdb/${DB}/tables/${table}/rows?${qs.map(q).join("&")}`)).rows ?? []
    all.push(...page)
    if (page.length < 100) return all
    cursor = page.at(-1).$id
  }
}
const json = (s, d) => { try { return typeof s === "string" ? JSON.parse(s) : (s ?? d) } catch { return d } }
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "")
const p2 = (n) => String(n).padStart(2, "0")
const localDate = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
const today = localDate(new Date())

// ── Users ──
let users = []
try {
  users = await rows("users")
} catch (e) {
  out(`! users table can't be read with this key (${e.message}). Falling back to athletes seen in protocol / training_plans / workoutsession.`)
}
// Score a user against a name: every word of the name found in the username
// (or name/email fields) counts; the full name joined counts double.
function score(u, name) {
  const hay = norm([u.username, u.name, u.fullName, u.displayName, u.email].filter(Boolean).join(" "))
  const words = name.split(/\s+/).map(norm).filter((w) => w.length >= 3)
  let s = 0
  if (hay.includes(norm(name))) s += 2 * words.length
  for (const w of words) if (hay.includes(w)) s += 1
  // a 4-letter prefix of a word (Paulo → paul, Cadena → cade)
  for (const w of words) if (!hay.includes(w) && w.length >= 4 && hay.includes(w.slice(0, 4))) s += 0.5
  return s
}

const library = await rows("blocks")
dump.library = library.filter((b) => (b.name ?? "").toLowerCase().includes(FIND.toLowerCase()) || (b.data ?? "").toLowerCase().includes(FIND.toLowerCase()))

for (const name of NAMES) {
  out(`\n════════ ${name} ════════`)
  const ranked = users.map((u) => ({ u, s: score(u, name) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)
  // --pick takes a username, or a user id when the users table can't be read.
  const forced = !PICK[name] ? null : users.find((u) => norm(u.username) === norm(PICK[name]) || u.$id === PICK[name])
    ?? (users.length === 0 ? { $id: PICK[name], username: PICK[name] } : null)
  out(`Matches: ${ranked.slice(0, 8).map((x) => `${x.u.username} (${x.u.$id}, ${x.s})`).join(" · ") || "none"}`)
  const user = forced ?? (ranked.length && (ranked.length === 1 || ranked[0].s > ranked[1].s) ? ranked[0].u : null)
  if (!user) { out(`→ No single match. Re-run with --pick="${name}=<username>".`); continue }
  out(`→ Using ${user.username} (${user.$id}) · flash ${user.flashLevel ?? "?"} · role ${user.role ?? "?"}`)
  const tasks = json(user.nextTasks, null)
  out(`Open session tasks: ${tasks?.tasks?.length ? tasks.tasks.map((t) => `"${t.text}" (${t.mode === "time" ? t.amount + " min" : t.amount + " tries"}, since ${t.added || "?"})`).join(" | ") : user.nextTasks === undefined ? "nextTasks column missing or not selected" : "none"}`)
  out(`Assigned workout: ${user.assignedProtocolId ?? "none"} (${user.assignedAt ?? "?"}) · home workout: ${user.homeWorkoutId ?? "none"}`)
  const A = (dump[name] = { user: { $id: user.$id, username: user.username, flashLevel: user.flashLevel, nextTasks: user.nextTasks, assignedProtocolId: user.assignedProtocolId, homeWorkoutId: user.homeWorkoutId } })

  const protocols = (await rows("protocol", [{ method: "equal", attribute: "athleteId", values: [user.$id] }]))
    .sort((a, b) => b.$createdAt.localeCompare(a.$createdAt))
  const sessions = (await rows("workoutsession", [{ method: "equal", attribute: "userId", values: [user.$id] }, { method: "orderDesc", attribute: "$createdAt" }]))
  A.protocols = protocols; A.sessions = sessions.slice(0, 20)
  out(`Coach workouts (newest 5): ${protocols.slice(0, 5).map((w) => `${w.$createdAt.slice(0, 10)} "${w.name}"${w.planIndex ? ` #${w.planIndex}` : ""}${w.planPart ? ` [${w.planPart}]` : ""}`).join(" · ") || "none"}`)

  // ── Plan ──
  const plans = (await rows("training_plans", [{ method: "equal", attribute: "athleteId", values: [user.$id] }])).sort((a, b) => b.$createdAt.localeCompare(a.$createdAt))
  const plan = plans.find((p) => p.status === "active")
  A.plan = plan ?? null
  if (!plan) out(`Plan: none active${plans[0] ? ` (latest "${plans[0].name}" ${plans[0].status} ${plans[0].windowStart}…${plans[0].windowEnd})` : ""}`)
  else {
    out(`Plan: "${plan.name}" (${plan.$id}) ${plan.kind ?? "climbing"} · focus ${plan.focus ?? "-"} · start ${plan.startType ?? "strength"} · ${plan.windowStart}…${plan.windowEnd} · S&C ${plan.hasSc ? json(plan.scFocuses, []).join("/") || "all" : "no"} · mobility ${plan.hasMobility ? "yes" : "no"}`)
    const planWorkouts = protocols.filter((w) => w.planId === plan.$id)
    const bySlot = new Map()
    for (const w of planWorkouts) {
      if (w.planPart || !w.planIndex) continue
      const prev = bySlot.get(w.planIndex)
      if (!prev || w.$createdAt > prev.$createdAt) bySlot.set(w.planIndex, w)
    }
    const done = donePlanWorkouts(plan.$id, planWorkouts, sessions)
    const over = today > plan.windowEnd
    const slots = []
    for (let n = 1; n <= 12; n++) {
      const w = bySlot.get(n) ?? null
      const status = done.get(n) ? "done" : w && !over ? "ready" : "upcoming"
      slots.push({ n, w, status, doneOn: done.get(n) })
    }
    out("Slots: " + slots.map((s) => `${s.n}:${s.status === "done" ? "✓" + s.doneOn.slice(5) : s.status === "ready" ? "ready" : "·"}`).join(" "))
    const next = slots.find((s) => s.status === "ready") ?? slots.find((s) => s.status === "upcoming")
    if (over) out("Plan is past its end date.")
    if (next) {
      const type = mainTypeFor(next.n, plan.startType)
      out(`UP NEXT: workout ${next.n} · rotation type ${type} · warm-up ${next.n % 2 === 1 ? "constraints" : "1 on 1 off"}${plan.focus === "fear_management" ? " (fear plan: may be route exploration)" : ""}`)
      if (next.w) {
        out(`  Built ${next.w.$createdAt.slice(0, 10)} as "${next.w.name}" (${next.w.$id})`)
        for (const b of json(next.w.blocks, [])) out("   - " + blockLine(b))
      } else out("  Not built yet: the coach builds it from the Plan card (or the app does when it comes up).")
      A.next = { index: next.n, type, workout: next.w ?? null }
    }
    const homework = protocols.filter((w) => w.planPart === "homework")
    if (homework.length) out(`Homework rows: ${homework.slice(0, 3).map((h) => `"${h.name}" ${h.$createdAt.slice(0, 10)} ${h.scheduledFor ?? ""}`).join(" · ")}`)
  }

  // ── Latest sessions ──
  out(`Latest ${Math.min(N_SESSIONS, sessions.length)} of ${sessions.length} sessions:`)
  for (const s of sessions.slice(0, N_SESSIONS)) {
    const blocks = json(s.protocol, [])
    const attempts = json(s.attempts, [])
    const first = attempts.find((a) => a?.timestamp)?.timestamp
    out(`  ${first ? localDate(new Date(first)) : s.$createdAt.slice(0, 10)} ${s.protocolId ? `(workout ${protocols.find((w) => w.$id === s.protocolId)?.name ?? s.protocolId})` : ""}`)
    blocks.forEach((b, i) => {
      const at = attempts.filter((a) => a?.blockIndex === i && a.timestamp)
      const sends = at.filter((a) => a.success).length
      const levels = [...new Set(at.map((a) => a.level).filter(Boolean))].join("/")
      const falls = at.flatMap((a) => a.fallReasons ?? [])
      const notes = at.map((a) => a.notes).filter(Boolean)
      const sc = at.filter((a) => a.scData).map((a) => `${a.scData.exerciseName ?? "?"} ${a.scData.reps ?? ""}${a.scData.weight ? "@" + a.scData.weight : ""}`)
      const task = b.focusTask ? ` [TASK "${b.focusTask.text}"${b.focusTask.closed ? " closed" : ""}]` : ""
      out(`     ${i + 1}. ${b.blockName ?? b.type} (${b.type})${task}: ${at.length} logged${sends ? `, ${sends} sent` : ""}${levels ? `, ${levels}` : ""}${falls.length ? `, falls ${falls.join(",")}` : ""}${sc.length ? `, ${sc.slice(0, 4).join(" | ")}` : ""}${notes.length ? `, notes: ${notes.join(" / ")}` : ""}`)
    })
  }
}

// ── Library search ──
out(`\n════════ Library / workouts matching "${FIND}" ════════`)
for (const b of dump.library) {
  const d = json(b.data, {})
  out(`Block "${b.name}" (${b.type}, ${b.$id}, updated ${b.$updatedAt.slice(0, 10)})`)
  out("   " + blockLine(d))
  out(`   description: ${JSON.stringify(d.description ?? "")}`)
  out(`   data: ${b.data}`)
}
if (!dump.library.length) {
  const near = library.filter((b) => /show|group|grupo|team/i.test(b.name ?? "")).map((b) => `"${b.name}" (${b.type})`)
  out(`No block in the library has "${FIND}" in its name or data. Names with show/group/team: ${near.join(", ") || "none"}`)
  out(`All library names: ${library.map((b) => b.name).sort().join(" · ")}`)
}
const allProtocols = await rows("protocol", [{ method: "select", values: ["$id", "$createdAt", "name", "athleteId", "blocks", "source"] }]).catch(() => [])
const inWorkouts = allProtocols.filter((w) => (w.name ?? "").toLowerCase().includes(FIND.toLowerCase()) || (w.blocks ?? "").toLowerCase().includes(FIND.toLowerCase()))
dump.workoutsMatching = inWorkouts
for (const w of inWorkouts.slice(0, 10)) {
  out(`Workout "${w.name}" (${w.$id}, ${w.$createdAt.slice(0, 10)}, athlete ${w.athleteId ?? "-"})`)
  for (const b of json(w.blocks, []).filter((b) => JSON.stringify(b).toLowerCase().includes(FIND.toLowerCase()))) {
    out("   " + blockLine(b)); out(`   description: ${JSON.stringify(b.description ?? "")}`); out(`   block: ${JSON.stringify(b)}`)
  }
}

const here = dirname(fileURLToPath(import.meta.url))
mkdirSync(join(here, "out"), { recursive: true })
writeFileSync(join(here, "out", "tomorrow-athletes.txt"), lines.join("\n") + "\n")
writeFileSync(join(here, "out", "tomorrow-athletes.json"), JSON.stringify(dump, null, 2))
console.log(`\nSaved scripts/diagnose/out/tomorrow-athletes.txt and .json. Nothing was written to Appwrite.`)

// ── Helpers (ports of utils/planRotation.ts + utils/planProgress.ts) ──
function blockLine(b) {
  const bits = [b.type]
  if (b.level) bits.push(b.level)
  if (b.grade) bits.push(`grade ${b.grade}`)
  if (b.targetAttempts) bits.push(`${b.targetAttempts} climbs`)
  if (b.timeLimit) bits.push(`${b.timeLimit} min`)
  if (b.series) bits.push(`${b.series}×${b.workTime}s/${b.restTime}s`)
  if (b.rounds) bits.push(`${b.rounds} rounds`)
  if (Array.isArray(b.exercises)) bits.push(b.exercises.map((e) => `${e.name}${e.focus ? "@" + e.focus : ""}${e.reps ? " " + e.reps : ""}`).join(" + "))
  return `${b.blockName ?? "(no name)"} — ${bits.join(", ")}${b.libraryBlockId ? " [library]" : ""}`
}
function mainTypeFor(index, startType) {
  const cycle = ["strength", "power_endurance", "power"]
  const offset = Math.max(0, cycle.indexOf(startType ?? "strength"))
  return cycle[(index - 1 + offset) % 3]
}
function sessionLocalDate(s) {
  const at = json(s.attempts, [])
  if (Array.isArray(at) && at[0]?.timestamp) return localDate(new Date(at[0].timestamp))
  return localDate(new Date(s.$createdAt))
}
function blockKeys(blocksJson) {
  const keys = new Set()
  const blocks = json(blocksJson, [])
  if (!Array.isArray(blocks)) return keys
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue
    if (b.id) { keys.add(`id:${b.id}`); continue }
    const nm = String(b.blockName ?? "").trim().toLowerCase()
    const ex = Array.isArray(b.exercises) ? b.exercises.map((e) => String(e?.name ?? "").trim().toLowerCase()).join(",") : ""
    keys.add(`${b.type ?? ""}|${nm}|${ex}`)
  }
  return keys
}
function donePlanWorkouts(planId, workouts, sessions) {
  const byId = new Map(workouts.map((w) => [w.$id, w]))
  const climbing = workouts.filter((w) => !w.planPart && w.planIndex).map((w) => ({ w, keys: blockKeys(w.blocks), built: localDate(new Date(w.$createdAt)) }))
  const done = new Map()
  const record = (i, d) => { const p = done.get(i); if (!p || d < p) done.set(i, d) }
  for (const s of sessions) {
    const date = sessionLocalDate(s)
    if (s.protocolId) {
      const w = byId.get(s.protocolId)
      if (w) { if (!w.planPart && w.planIndex) record(w.planIndex, date) }
      else if (s.planId === planId && s.planIndex) record(s.planIndex, date)
      continue
    }
    const keys = blockKeys(s.protocol)
    if (!keys.size) continue
    let best = null
    for (const c of climbing) {
      if (c.built > date) continue
      let overlap = 0
      for (const k of keys) if (c.keys.has(k)) overlap++
      if (overlap === 0 || overlap * 2 < c.keys.size) continue
      if (!best || overlap > best.overlap || (overlap === best.overlap && c.built >= best.built)) best = { index: c.w.planIndex, overlap, built: c.built }
    }
    if (best) record(best.index, date)
  }
  return done
}
