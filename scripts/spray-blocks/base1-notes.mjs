// Coach 2026-11-12: Base 1's coach notes — drop the first one and make the
// rest as short as possible. The notes are the library block's
// data.description ("Base 1", type sequence), one step per line.
//
// Dry run (default): prints the current notes, numbered as the app shows them.
// --apply: writes NEW_NOTES below (old note 1 dropped, the rest shortened;
// the variations note is gone, spray blocks have none). Workouts already created keep their old copy.
//
// Usage:
//   node --env-file=.env.local scripts/spray-blocks/base1-notes.mjs [--apply]
// (.env.local: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID)

const env = process.env
const APPWRITE_ENDPOINT = env.APPWRITE_ENDPOINT
const APPWRITE_PROJECT_ID = env.APPWRITE_PROJECT_ID
const APPWRITE_API_KEY = env.APPWRITE_API_KEY
const APPWRITE_DATABASE_ID = env.APPWRITE_DATABASE_ID
const APPLY = process.argv.includes("--apply")

// The new notes, one step per line. Empty = nothing to write yet.
const NEW_NOTES = [
  "Goal: repeat moderately hard moves with little rest.",
  "It should feel hard but doable. Falling on the first attempt means it's too hard.",
  "Memorize the sequence before your first attempt, so you never stop to think.",
  "If you fall, get back on fast and finish the moves. The volume counts, not the send.",
  "Same effort on every attempt.",
].join("\n")

for (const [name, value] of Object.entries({
  APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID,
})) {
  if (!value) { console.error(`Missing env var: ${name}`); process.exit(1) }
}

async function api(method, path, body) {
  const res = await fetch(`${APPWRITE_ENDPOINT}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Appwrite-Project": APPWRITE_PROJECT_ID,
      "X-Appwrite-Key": APPWRITE_API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json.message ?? ""}`)
  return json
}

const db = `/tablesdb/${APPWRITE_DATABASE_ID}/tables`
const q = (o) => `queries[]=${encodeURIComponent(JSON.stringify(o))}`
const { rows = [] } = await api("GET", `${db}/blocks/rows?${[
  q({ method: "equal", attribute: "type", values: ["sequence"] }),
  q({ method: "limit", values: [100] }),
].join("&")}`)
const found = rows.filter((r) => (r.name ?? "").trim().toLowerCase() === "base 1")
if (found.length === 0) { console.log('"Base 1" is not in the library'); process.exit(0) }

for (const r of found) {
  let data = {}
  try { data = JSON.parse(r.data || "{}") } catch {}
  const text = typeof data.description === "string" ? data.description : ""
  console.log(`\n"Base 1" (${r.$id}) — current coach notes:\n`)
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  lines.forEach((l, i) => console.log(`${i + 1}. ${l}`))
  if (lines.length === 0) console.log("(none)")
  if (!APPLY) continue
  if (!NEW_NOTES) { console.log("\nNEW_NOTES is empty: nothing written."); continue }
  await api("PATCH", `${db}/blocks/rows/${r.$id}`, { data: { data: JSON.stringify({ ...data, description: NEW_NOTES }) } })
  console.log("\n→ notes updated to:\n" + NEW_NOTES.split("\n").map((l, i) => `${i + 1}. ${l}`).join("\n"))
}
if (!APPLY) console.log("\nDry run. Paste this to Claude.")
