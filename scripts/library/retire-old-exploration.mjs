// Takes the old "Exploration session" (a Boulder Logger block: one 25 min
// timer, 1/2/3 goes by colour) out of the block library, so "Add block →
// Library" only offers the Route exploration we built (2026-11-23).
// Workouts that already have a copy keep it: only the library row goes.
// A copy of the row is saved to scripts/library/out/ first (git-ignored).
//
// Simulation by default. Add --apply to really delete.
//   node --env-file=.env.local scripts/library/retire-old-exploration.mjs [--apply]
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

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
const NAME = "exploration session"
const TYPE = "exploration_session"

async function api(method, path) {
  const res = await fetch(`${ENV.APPWRITE_ENDPOINT}${path}`, { method, headers: { "X-Appwrite-Project": ENV.APPWRITE_PROJECT_ID, "X-Appwrite-Key": ENV.APPWRITE_API_KEY } })
  const json = res.status === 204 ? {} : await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path.split("?")[0]} → ${res.status} ${json.message ?? ""}`)
  return json
}
const db = `/tablesdb/${ENV.APPWRITE_DATABASE_ID}/tables/blocks/rows`
const q = (o) => `queries[]=${encodeURIComponent(JSON.stringify(o))}`

const rows = (await api("GET", `${db}?${q({ method: "equal", attribute: "type", values: [TYPE] })}&${q({ method: "limit", values: [100] })}`)).rows ?? []
const targets = rows.filter((r) => String(r.name ?? "").trim().toLowerCase() === NAME)
console.log(`Boulder Logger library blocks: ${rows.map((r) => `"${r.name}"`).join(", ") || "(none)"}`)
if (targets.length === 0) { console.log(`No library block called "Exploration session" — nothing to do.`); process.exit(0) }

const outDir = join(dirname(fileURLToPath(import.meta.url)), "out")
mkdirSync(outDir, { recursive: true })
const backup = join(outDir, `exploration-session-backup-${Date.now()}.json`)
writeFileSync(backup, JSON.stringify(targets, null, 2))
console.log(`Saved a copy to ${backup}`)

for (const r of targets) {
  console.log(`${APPLY ? "Deleting" : "Would delete"} "${r.name}" (${r.$id}) — ${r.data}`)
  if (APPLY) await api("DELETE", `${db}/${r.$id}`)
}
console.log(APPLY ? "Done. The Density test and Route exploration stay in the library." : "Simulation only. Run again with --apply to delete.")
