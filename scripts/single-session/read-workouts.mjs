// Read-only: the coach's workouts whose name contains --name (e.g. every
// "Leticia …" workout), who they belong to, and what the athlete logged in
// them and in their latest sessions — so a thread can build the next one-off
// session on top of them (docs/single-session-recipe.md).
// Writes NOTHING to Appwrite. Saves everything it read to
// scripts/single-session/out/<name>.json + .txt (git-ignored) and prints the
// summary.
//
//   node --env-file=.env.local scripts/single-session/read-workouts.mjs --name=Leticia [--user=alguete] [--last=3] [--sessions=12]
//
// --user: comma list of parts of a username to also look up (e.g. when the
// workouts aren't linked to an athlete). --last: how many of the newest
// matches count as "the last workouts". --sessions: how many of each
// athlete's latest sessions to include.
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID } = process.env
for (const [name, value] of Object.entries({ APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID })) {
  if (!value) { console.error(`Missing env var: ${name}`); process.exit(1) }
}

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
const arg = (key, fallback) => {
  const a = process.argv.find((x) => x.startsWith(`--${key}=`))
  return a ? a.slice(key.length + 3) : fallback
}
const NAME = arg("name", "")
if (!NAME) { console.error("Usage: node --env-file=.env.local scripts/single-session/read-workouts.mjs --name=<part of the workout name> [--user=<part of a username>]"); process.exit(1) }
const USER_HINTS = arg("user", "").split(",").map(norm).filter(Boolean)
const LAST = Number(arg("last", "3")) || 3
const SESSIONS = Number(arg("sessions", "12")) || 12

async function api(path) {
  const res = await fetch(`${APPWRITE_ENDPOINT}${path}`, { headers: { "X-Appwrite-Project": APPWRITE_PROJECT_ID, "X-Appwrite-Key": APPWRITE_API_KEY } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`GET ${path.split("?")[0]} → ${res.status} ${json.message ?? ""}`)
  return json
}
const db = `/tablesdb/${APPWRITE_DATABASE_ID}/tables`
const q = (o) => `queries[]=${encodeURIComponent(JSON.stringify(o))}`
const rowsOf = async (table, queries) => (await api(`${db}/${table}/rows?${queries.join("&")}`)).rows ?? []
async function all(table, queries = []) {
  const out = []; let cursor = null
  for (;;) {
    const qs = [...queries, q({ method: "limit", values: [100] })]
    if (cursor) qs.push(q({ method: "cursorAfter", values: [cursor] }))
    const rows = await rowsOf(table, qs)
    out.push(...rows)
    if (rows.length < 100) return out
    cursor = rows[rows.length - 1].$id
  }
}
// Tries each column list in turn (a select on a missing column is a 400);
// null = no select (every column).
async function allSelect(table, selects, queries = []) {
  for (const cols of selects) {
    try { return await all(table, cols ? [...queries, q({ method: "select", values: cols })] : queries) }
    catch (e) { if (!/ 400 /.test(e.message) || !cols) throw e }
  }
  return all(table, queries)
}
const tryRows = async (table, queries) => { try { return await rowsOf(table, queries) } catch (e) { return { error: e.message } } }
const parse = (s, fallback = []) => { if (typeof s !== "string") return s ?? fallback; try { return JSON.parse(s || "null") ?? fallback } catch { return fallback } }
const bogota = (iso) => (iso ? new Date(new Date(iso).getTime() - 5 * 3600e3).toISOString().replace("T", " ").slice(0, 16) : "")
const bogotaMs = (ms) => new Date(ms - 5 * 3600e3).toISOString().replace("T", " ").slice(0, 16)

const report = []
const say = (line = "") => { report.push(line); console.log(line) }

// ── Workouts named like --name ──
const protocols = await allSelect("protocol", [
  ["$id", "$createdAt", "name", "athleteId", "source", "planId", "planPart"],
  ["$id", "$createdAt", "name", "athleteId"],
  null,
])
const byId = new Map(protocols.map((p) => [p.$id, p]))
const matches = protocols.filter((p) => norm(p.name).includes(norm(NAME))).sort((a, b) => (a.$createdAt < b.$createdAt ? 1 : -1))
const users = await all("users")
const userById = new Map(users.map((u) => [u.$id, u]))
const who = (id) => (id ? userById.get(id?.$id ?? id)?.username ?? `(unknown user ${id?.$id ?? id})` : "(no athlete: library workout)")

say(`Workouts whose name contains "${NAME}": ${matches.length} (of ${protocols.length} workouts)`)
for (const p of matches) say(`  ${bogota(p.$createdAt)}  "${p.name}"  → ${who(p.athleteId)}${p.source ? `  [${p.source}]` : ""}${p.planId ? "  [from a plan]" : ""}  (${p.$id})`)
if (matches.length === 0) say("  (none — try a shorter --name)")

const full = []
for (const p of matches.slice(0, Math.max(LAST, 8))) {
  const row = await api(`${db}/protocol/rows/${p.$id}`)
  full.push({ ...row, blocks: parse(row.blocks) })
}

const blockLine = (b, i) => {
  const bits = [b.type]
  if (b.level) bits.push(b.level)
  if (b.grade) bits.push(`grade ${b.grade}`)
  if (b.targetAttempts) bits.push(`${b.targetAttempts} climbs`)
  if (b.timeLimit) bits.push(`${b.timeLimit} min`)
  if (b.series) bits.push(`${b.series}×${b.workTime ?? "?"}s on/${b.restTime ?? "?"}s off`)
  else if (b.restTime) bits.push(`rest ${b.restTime}s`)
  if (Array.isArray(b.exercises)) bits.push(`${b.exercises.length} exercises: ${b.exercises.map((e) => `${e.name ?? e.exerciseName ?? "?"}${e.sets ? ` ${e.sets}×${e.reps ?? "?"}` : ""}`).join(", ")}`)
  if (b.libraryBlockId) bits.push("library")
  return `  ${i + 1}. ${b.blockName ?? b.name ?? "(no name)"} — ${bits.join(", ")}${b.description ? `\n       "${String(b.description).replace(/\s+/g, " ").trim()}"` : ""}`
}
for (const [i, p] of full.entries()) {
  say("")
  say(`${i < LAST ? `#${i + 1} newest` : "older"}: "${p.name}" — ${bogota(p.$createdAt)} — ${who(p.athleteId)} (${p.$id})`)
  for (const [j, b] of (Array.isArray(p.blocks) ? p.blocks : []).entries()) say(blockLine(b, j))
}

// ── Athletes: owners of those workouts + any --user match ──
const athleteIds = new Set(matches.map((p) => p.athleteId?.$id ?? p.athleteId).filter(Boolean))
for (const u of users) if (USER_HINTS.some((h) => norm(u.username).includes(h))) athleteIds.add(u.$id)
const athletes = [...athleteIds].map((id) => userById.get(id)).filter(Boolean)
say("")
say(`Athletes: ${athletes.map((u) => u.username).join(", ") || "(none)"}`)
if (USER_HINTS.length) {
  const near = users.filter((u) => USER_HINTS.some((h) => norm(u.username).includes(h.slice(0, 3)))).map((u) => u.username)
  say(`  usernames close to "${USER_HINTS.join(", ")}": ${near.join(", ") || "(none)"}`)
}

const sessionTokens = (a) => {
  const d = a.scData ?? {}
  const t = []
  if (d.exerciseName) t.push(d.exerciseName)
  if (d.round != null) t.push(`r${d.round}`)
  if (d.repsCompleted != null) t.push(`${d.repsCompleted} reps`)
  if (d.repsLeft != null || d.repsRight != null) t.push(`L${d.repsLeft ?? "-"}/R${d.repsRight ?? "-"}`)
  if (d.weight != null) t.push(`${d.weight}${d.weightUnit ?? ""}`)
  if (d.seriesDone != null) t.push(`${d.seriesDone} series`)
  if (a.level) t.push(a.level)
  if (Array.isArray(d.grades)) t.push(d.grades.join(" "))
  if (a.success != null) t.push(a.success ? "✓" : "✗")
  const rpe = d.rpe ?? a.rpe
  if (rpe != null) t.push(`RPE ${rpe}`)
  const note = d.notes ?? a.notes
  if (note) t.push(`"${String(note).replace(/\s+/g, " ").trim()}"`)
  return t.join(" ") || a.type || "?"
}

const matchIds = matches.map((p) => p.$id)
const linked = matchIds.length ? await tryRows("workoutsession", [q({ method: "equal", attribute: "protocolId", values: matchIds.slice(0, 100) }), q({ method: "limit", values: [100] })]) : []
const light = ({ $id, $createdAt, name, athleteId, source, planId, planPart }) => ({ $id, $createdAt, name, athleteId, source, planId, planPart })
const data = { generatedAt: new Date().toISOString(), name: NAME, matches: matches.map(light), workouts: full, athletes: [] }
if (linked.error) say(`(could not look up sessions by workout: ${linked.error})`)

const sessionSummary = (s) => {
  const blocks = parse(s.protocol), attempts = parse(s.attempts), durations = parse(s.blockDurations, {})
  const totalMin = Math.round(Object.values(durations ?? {}).reduce((n, v) => n + (Number(v) || 0), 0) / 60)
  const first = attempts.find((a) => a?.timestamp)?.timestamp
  say(`  ${first ? bogotaMs(first) : bogota(s.$createdAt)}  ${s.protocolId ? `"${byId.get(s.protocolId)?.name ?? s.protocolId}"` : "(no workout link)"}${totalMin ? `  ~${totalMin} min` : ""}  (${s.$id})`)
  for (const [i, b] of (Array.isArray(blocks) ? blocks : []).entries()) {
    const mine = attempts.filter((a) => a?.blockIndex === i)
    const secs = durations?.[i] ?? durations?.[String(i)]
    say(`     ${i + 1}. ${b.blockName ?? b.name ?? b.type}${secs ? ` (${Math.round(secs / 60)} min)` : ""}: ${mine.length ? mine.map(sessionTokens).join(" | ") : "—"}`)
  }
  const loose = attempts.filter((a) => !(a?.blockIndex >= 0))
  if (loose.length) say(`     other: ${loose.map(sessionTokens).join(" | ")}`)
  return { ...s, protocol: blocks, attempts, blockDurations: durations }
}

for (const u of athletes) {
  const { pushToken: _t, ...row } = u
  say("")
  say(`── ${u.username} (${u.$id}) — role ${u.role ?? "?"}${u.active === false ? ", DEACTIVATED" : ""}`)
  say(`  flash level: ${u.flashLevel ?? "—"} · active workout: ${u.assignedProtocolId ? `"${byId.get(u.assignedProtocolId)?.name ?? u.assignedProtocolId}"` : "—"} (assigned ${u.assignedAt ?? "?"}) · home workout: ${u.homeWorkoutId ? `"${byId.get(u.homeWorkoutId)?.name ?? u.homeWorkoutId}"` : "—"}`)
  for (const k of ["edgeLiftMax", "hangMaxLog", "pullupTest", "nextTasks", "defaultClasses"]) if (u[k] != null && u[k] !== "") say(`  ${k}: ${typeof u[k] === "string" ? u[k] : JSON.stringify(u[k])}`.slice(0, 400))
  const theirs = protocols.filter((p) => (p.athleteId?.$id ?? p.athleteId) === u.$id).sort((a, b) => (a.$createdAt < b.$createdAt ? 1 : -1))
  say(`  their workouts (newest first, ${theirs.length}): ${theirs.slice(0, 15).map((p) => `"${p.name}" ${bogota(p.$createdAt).slice(0, 10)}`).join(" · ") || "—"}`)
  const plans = await tryRows("training_plans", [q({ method: "equal", attribute: "athleteId", values: [u.$id] }), q({ method: "orderDesc", attribute: "$createdAt" }), q({ method: "limit", values: [5] })])
  if (Array.isArray(plans)) say(`  training plans: ${plans.map((p) => `${p.status ?? "?"} ${p.kind ?? "climbing"} ${p.focus ?? ""} from ${bogota(p.$createdAt).slice(0, 10)}`).join(" · ") || "—"}`)
  const projects = await tryRows("projects", [q({ method: "equal", attribute: "userId", values: [u.$id] }), q({ method: "orderDesc", attribute: "$createdAt" }), q({ method: "limit", values: [10] })])
  if (Array.isArray(projects) && projects.length) say(`  projects: ${projects.map((p) => `${p.name ?? "?"} ${p.grade ?? ""} ${p.status ?? ""} (${p.location ?? ""})`).join(" · ")}`)
  const recent = await tryRows("workoutsession", [q({ method: "equal", attribute: "userId", values: [u.$id] }), q({ method: "orderDesc", attribute: "$createdAt" }), q({ method: "limit", values: [SESSIONS] })])
  const sessions = Array.isArray(recent) ? recent : []
  if (recent.error) say(`  (could not read sessions: ${recent.error})`)
  for (const s of Array.isArray(linked) ? linked : []) if ((s.userId?.$id ?? s.userId) === u.$id && !sessions.some((x) => x.$id === s.$id)) sessions.push(s)
  sessions.sort((a, b) => (a.$createdAt < b.$createdAt ? 1 : -1))
  say(`  latest sessions (${sessions.length}):`)
  const parsed = sessions.map(sessionSummary)
  data.athletes.push({ user: row, plans: Array.isArray(plans) ? plans : plans, projects, sessions: parsed })
}
const others = (Array.isArray(linked) ? linked : []).filter((s) => !athleteIds.has(s.userId?.$id ?? s.userId))
if (others.length) {
  say("")
  say(`Sessions of these workouts by other users (${others.length}):`)
  data.otherSessions = others.map((s) => { say(`  by ${who(s.userId)}`); return sessionSummary(s) })
}

const dir = join(dirname(fileURLToPath(import.meta.url)), "out")
const base = norm(NAME).replace(/[^a-z0-9]+/g, "-") || "workouts"
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, `${base}.json`), JSON.stringify(data, null, 2))
writeFileSync(join(dir, `${base}.txt`), report.join("\n") + "\n")
console.log(`\nRead only — nothing was changed. Saved to scripts/single-session/out/${base}.json and .txt`)
