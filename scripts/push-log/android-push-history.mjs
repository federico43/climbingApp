// Read-only: for the athletes you name, does their row have a push token, and
// has any push from the server ever been "sent" to them in the push log
// (kept 60 days)? Used to confirm that Android phones never register for push.
// Writes nothing.
//
// Usage (from testApp):
//   node --env-file=.env.local scripts/push-log/android-push-history.mjs Carlos MaxMan Val09 anaBotero p1blis81
// Names match users.username, ignoring case and spaces. With no names: every user.

const env = process.env
const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID } = env
for (const [name, value] of Object.entries({ APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID })) {
  if (!value) { console.error(`Missing env var: ${name}`); process.exit(1) }
}

async function api(path) {
  const res = await fetch(`${APPWRITE_ENDPOINT}${path}`, {
    headers: { "X-Appwrite-Project": APPWRITE_PROJECT_ID, "X-Appwrite-Key": APPWRITE_API_KEY },
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${json.message ?? ""}`)
  return json
}
const qs = (queries) => queries.map((q) => `queries[]=${encodeURIComponent(JSON.stringify(q))}`).join("&")
async function rows(table, queries = []) {
  const out = []
  for (let offset = 0; ; offset += 500) {
    const page = await api(`/tablesdb/${APPWRITE_DATABASE_ID}/tables/${table}/rows?${qs([...queries,
      { method: "limit", values: [500] }, { method: "offset", values: [offset] }])}`)
    out.push(...(page.rows ?? []))
    if ((page.rows ?? []).length < 500) return out
  }
}
const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, "")
const wanted = process.argv.slice(2).map(norm)

const users = (await rows("users")).filter((u) => !wanted.length || wanted.includes(norm(u.username)))
const missing = wanted.filter((w) => !users.some((u) => norm(u.username) === w))
if (missing.length) console.log(`Not found: ${missing.join(", ")}\n`)

const log = await rows("push_log")
const day = (iso) => (iso ? iso.slice(0, 10) : "–")
console.log(`Push log: ${log.length} rows, ${day(log.reduce((a, r) => (a && a < r.$createdAt ? a : r.$createdAt), null))} → today\n`)

for (const u of users) {
  const mine = log.filter((r) => r.userId === u.$id)
  const count = (s) => mine.filter((r) => r.status === s).length
  const lastSent = mine.filter((r) => r.status === "sent").sort((a, b) => b.$createdAt.localeCompare(a.$createdAt))[0]
  const types = [...new Set(mine.map((r) => r.type).filter(Boolean))].join(", ")
  console.log(`${u.username}${u.active === false ? " (deactivated)" : ""}`)
  console.log(`  token on the row now: ${u.pushToken ? "YES" : "no"}`)
  console.log(`  pushes meant for them: ${mine.length} · sent ${count("sent")} · no_token ${count("no_token")} · failed ${count("failed")}`)
  console.log(`  last one sent: ${lastSent ? `${day(lastSent.$createdAt)} "${lastSent.title}"` : "never"}`)
  if (types) console.log(`  types: ${types}`)
  console.log("")
}
