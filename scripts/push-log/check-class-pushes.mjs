// Read-only check: did the class notifications go out after the coach
// published a week? Writes nothing.
//
// It looks at:
//   1. class_weeks   is the week published, and when (its last update)
//   2. push_log      the "classes are up" push (type class_week, source
//                    classPublish): which athletes got a row, and with what
//                    status (sent / failed / no_token). Athletes with no row
//                    at all are listed too.
//   3. push_log      the "Class tomorrow" reminders (type class_tomorrow,
//                    source classCron, from 20:00 the night before) for the
//                    week's classes whose eve has passed, against each roster.
//   4. push_log      every other class push in the window, grouped.
//   5. executions    the climbingApp function's latest runs: does the hourly
//                    schedule keep firing, and did any run fail.
//
// "sent" means Expo accepted the push. It does not prove the phone showed it:
// that part is checked on a real phone (doc "Pruebas en teléfono real").
//
// Usage (from testApp):
//   node --env-file=.env.local scripts/push-log/check-class-pushes.mjs [WEEK_START]
// WEEK_START is the Monday (YYYY-MM-DD). Left out: the most recently
// published week. No dependencies — Appwrite's REST API directly.
// (.env.local: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID)

import { formatTime } from "../../functions/aiProtocol/src/classRules.js"

const env = process.env
const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID } = env
for (const [name, value] of Object.entries({ APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID })) {
  if (!value) { console.error(`Missing env var: ${name}`); process.exit(1) }
}

const FUNCTION_ID = "6a1c2e850024e1f59fc3" // climbingApp
const TZ_OFFSET_H = -5 // America/Bogota, no daylight saving
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const argWeek = process.argv.slice(2).find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a))

async function api(path) {
  const res = await fetch(`${APPWRITE_ENDPOINT}${path}`, {
    headers: { "X-Appwrite-Project": APPWRITE_PROJECT_ID, "X-Appwrite-Key": APPWRITE_API_KEY },
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(`GET ${path} → ${res.status} ${json.message ?? ""}`), { status: res.status })
  return json
}
const qs = (queries) => queries.map((q) => `queries[]=${encodeURIComponent(JSON.stringify(q))}`).join("&")
const equal = (attribute, value) => ({ method: "equal", attribute, values: [value] })
const gte = (attribute, value) => ({ method: "greaterThanEqual", attribute, values: [value] })
const desc = (attribute) => ({ method: "orderDesc", attribute })

// Every row matching `queries`, page by page.
async function rows(table, queries = []) {
  const out = []
  for (let offset = 0; ; offset += 500) {
    const page = await api(`/tablesdb/${APPWRITE_DATABASE_ID}/tables/${table}/rows?${qs([...queries,
      { method: "limit", values: [500] }, { method: "offset", values: [offset] }])}`)
    out.push(...(page.rows ?? []))
    if ((page.rows ?? []).length < 500) return out
  }
}

const bogota = (iso) => {
  const d = new Date(new Date(iso).getTime() + TZ_OFFSET_H * 3600000)
  return `${DAYS[(d.getUTCDay() + 6) % 7]} ${d.toISOString().slice(5, 16).replace("T", " ")}`
}
const addDays = (ymd, n) => {
  const [y, m, d] = ymd.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
// The moment (UTC ms) of a wall-clock time in Bogota.
const gymMs = (ymd, hour) => {
  const [y, m, d] = ymd.split("-").map(Number)
  return Date.UTC(y, m - 1, d) + (hour - TZ_OFFSET_H) * 3600000
}
const problems = []
const note = (msg) => { problems.push(msg); return `  ← ${msg}` }

// ── 1. The week ──────────────────────────────────────────────────────────────
const weeks = (await rows("class_weeks", [desc("$updatedAt")])).filter((w) => w.$id !== "series")
const week = argWeek ? weeks.find((w) => w.$id === argWeek) : weeks.find((w) => w.published)
if (!week) {
  console.log(argWeek ? `Week ${argWeek} has no row in class_weeks (never saved or published).` : "No published week found.")
  process.exit(0)
}
const weekStart = week.$id
console.log(`Week of ${weekStart}: ${week.published ? "PUBLISHED" : "NOT published (draft)"}, last saved ${bogota(week.$updatedAt)} (Bogota)`)
if (!week.published) {
  console.log("Nothing to check until the coach publishes it. Run this again after publishing.")
  process.exit(0)
}

// The publish push happens once, the first time a week is published. Look a
// little before its row was created (first save) to be safe.
const since = new Date(new Date(week.$createdAt).getTime() - 10 * 60000).toISOString()

const users = await rows("users")
const byId = new Map(users.map((u) => [u.$id, u]))
const label = (id) => byId.get(id)?.username ?? `(${id})`
const log = await rows("push_log", [gte("$createdAt", since), desc("$createdAt")])
const isClass = (r) => typeof r.type === "string" && r.type.startsWith("class_")

// ── 2. "This/Next week's classes are up" ─────────────────────────────────────
console.log(`\n① "Classes are up" push (sent when the week is first published)`)
const upRows = log.filter((r) => r.type === "class_week" && r.source === "classPublish" && /classes are up/i.test(r.title ?? ""))
const athletes = users.filter((u) => u.role !== "coach")
if (!upRows.length) {
  console.log(note("No rows in push_log. Either the week was published before the push log existed, the publish was a re-publish (only the first one pushes), or the push didn't run."))
} else {
  console.log(`  At ${bogota(upRows.at(-1).$createdAt)}: ${upRows.length} row(s) — "${upRows[0].title}"`)
  const got = new Map(upRows.map((r) => [r.userId, r]))
  for (const a of athletes) {
    const r = got.get(a.$id)
    const inactive = a.active === false ? " (deactivated)" : ""
    if (!r) console.log(`  ·  ${label(a.$id)}${inactive}: no row (paused all week, or missed)`)
    else if (r.status === "sent") console.log(`  ✓  ${label(a.$id)}${inactive}: sent${inactive ? note(`${label(a.$id)} is deactivated but still got it`) : ""}`)
    else if (r.status === "no_token") console.log(`  ✗  ${label(a.$id)}${inactive}: no_token${note(`${label(a.$id)} has no phone registered (open the app once with notifications allowed)`)}`)
    else console.log(`  ✗  ${label(a.$id)}${inactive}: FAILED — ${r.error ?? "?"}${note(`push to ${label(a.$id)} failed`)}`)
  }
}

// ── 3. "Class tomorrow" reminders ────────────────────────────────────────────
console.log(`\n② "Class tomorrow" reminders (hourly cron, from 20:00 the night before)`)
const classes = (await rows("classes", [equal("weekStart", weekStart)])).sort((a, b) => a.day - b.day || a.start - b.start)
const now = Date.now()
const tomorrowRows = log.filter((r) => r.type === "class_tomorrow")
if (!classes.length) console.log("  The week has no classes.")
for (const c of classes) {
  const date = addDays(weekStart, c.day)
  const name = `${DAYS[c.day]} ${date.slice(5)} ${formatTime(c.start)}`
  const roster = c.roster ?? []
  const eve = gymMs(addDays(date, -1), 20)
  if (now < eve) { console.log(`  ·  ${name}: not due yet (${roster.length} in roster)`); continue }
  if (!roster.length) { console.log(`  ·  ${name}: empty roster, nothing to send`); continue }
  // Reminders for this class: same title time, logged between its eve and midnight.
  const forIt = tomorrowRows.filter((r) => {
    const t = new Date(r.$createdAt).getTime()
    return t >= eve && t < eve + 4 * 3600000 && (r.title ?? "").endsWith(formatTime(c.start))
  })
  const parts = roster.map((id) => {
    const r = forIt.find((x) => x.userId === id)
    if (!r) { problems.push(`no "Class tomorrow" row for ${label(id)} (${name})`); return `${label(id)} ✗ missing` }
    if (r.status !== "sent") problems.push(`"Class tomorrow" to ${label(id)} (${name}): ${r.status} ${r.error ?? ""}`.trim())
    return `${label(id)} ${r.status === "sent" ? "✓" : `✗ ${r.status}`} ${bogota(r.$createdAt).slice(-5)}`
  })
  console.log(`  ${name}: ${parts.join(", ")}`)
}

// ── 4. Every other class push since the publish ──────────────────────────────
console.log(`\n③ Other class pushes since ${bogota(since)}`)
const others = log.filter((r) => isClass(r) && !upRows.includes(r) && r.type !== "class_tomorrow")
if (!others.length) console.log("  None.")
for (const r of others.slice(0, 40)) {
  const bad = r.status !== "sent" ? `  ← ${r.status}${r.error ? `: ${r.error}` : ""}` : ""
  if (bad) problems.push(`${r.type} to ${r.userName ?? r.userId}: ${r.status}`)
  console.log(`  ${bogota(r.$createdAt)}  ${r.type.padEnd(15)} → ${(r.userName ?? r.userId).padEnd(14)} ${r.status.padEnd(8)} "${r.title}"${bad}`)
}
if (others.length > 40) console.log(`  … and ${others.length - 40} more`)

// ── 5. Function executions ───────────────────────────────────────────────────
console.log(`\n④ climbingApp executions (latest 25)`)
try {
  const { executions = [] } = await api(`/functions/${FUNCTION_ID}/executions?${qs([desc("$createdAt"), { method: "limit", values: [25] }])}`)
  const failed = executions.filter((e) => e.status === "failed" || (e.responseStatusCode ?? 0) >= 500)
  const scheduled = executions.filter((e) => e.trigger === "schedule")
  console.log(`  ${executions.length} runs, ${failed.length} failed. Scheduled: ${scheduled.length}, latest ${scheduled[0] ? bogota(scheduled[0].$createdAt) : "none in this page"}`)
  for (let i = 0; i + 1 < scheduled.length; i++) {
    const gapMin = (new Date(scheduled[i].$createdAt) - new Date(scheduled[i + 1].$createdAt)) / 60000
    if (gapMin > 90) console.log(note(`schedule gap of ${Math.round(gapMin)} min before ${bogota(scheduled[i].$createdAt)}`))
  }
  if (scheduled[0] && now - new Date(scheduled[0].$createdAt) > 90 * 60000) console.log(note("no scheduled run in the last 90 min"))
  for (const e of failed.slice(0, 5)) {
    console.log(note(`failed run ${bogota(e.$createdAt)} (${e.trigger}, ${e.responseStatusCode}): ${(e.errors || e.responseBody || "").slice(0, 160).replace(/\s+/g, " ")}`))
  }
} catch (e) {
  console.log(`  Couldn't read executions (${e.status ?? e.message}). The API key may lack the execution.read scope; check Appwrite › Functions › climbingApp › Executions instead.`)
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${problems.length ? `PROBLEMS (${problems.length}):\n${[...new Set(problems)].map((p) => `  - ${p}`).join("\n")}` : "OK: every class push due so far was accepted by Expo."}`)
