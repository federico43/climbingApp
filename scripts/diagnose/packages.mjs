// Read-only: every athlete's class package as the app sees it right now
// (sessions left, start, use-by, locked), the in-app classes counted against
// it, and every package row they have. Also lists the workouts (protocol
// rows) whose name contains a keyword, e.g. Milena's virtual classes.
// Changes nothing.
//   node --env-file=.env.local scripts/diagnose/packages.mjs [--keyword=leticia]
import { describe, loadAll, now, packageNow, rows } from "../class-packages/lib.mjs"

const KEYWORD = (process.argv.find((a) => a.startsWith("--keyword="))?.slice(10) ?? "leticia").toLowerCase()
const at = now()
const all = await loadAll()
const name = new Map(all.users.map((u) => [u.$id, u.username ?? u.$id]))

console.log(`Today in the gym: ${at.ymd}\n`)
const withPkg = new Set(all.packages.map((p) => p.athleteId))
const athletes = all.users.filter((u) => u.role !== "coach" && withPkg.has(u.$id))
  .sort((a, b) => (a.username ?? "").localeCompare(b.username ?? ""))
for (const u of athletes) {
  const s = packageNow(all, u.$id, at)
  console.log(`${u.username} (${u.$id}): ${describe(s)}`)
  if (s.done.length) console.log(`   in-app classes counted: ${s.done.join(", ")}`)
  if (s.skips) console.log(`   accepted skips since the package: ${s.skips}`)
  if (s.rows.length > 1) {
    const hist = s.rows.sort((a, b) => a.$createdAt.localeCompare(b.$createdAt))
      .map((p) => `${p.total} from ${p.startsOn} (added ${p.$createdAt.slice(0, 10)})`).join(" | ")
    console.log(`   all packages: ${hist}`)
  }
}
const noPkg = all.users.filter((u) => u.role !== "coach" && !withPkg.has(u.$id)).map((u) => u.username).sort()
console.log(`\nAthletes with no package: ${noPkg.join(", ") || "none"}`)

const workouts = (await rows("protocol", [{ method: "select", values: ["$id", "name", "athleteId", "source", "$createdAt"] }]))
  .filter((w) => (w.name ?? "").toLowerCase().includes(KEYWORD))
  .sort((a, b) => a.$createdAt.localeCompare(b.$createdAt))
console.log(`\nWorkouts with "${KEYWORD}" in the name: ${workouts.length}`)
for (const w of workouts) {
  console.log(`  ${w.$createdAt.slice(0, 10)} · ${w.name} · athlete ${name.get(w.athleteId) ?? w.athleteId ?? "none"} · ${w.source ?? ""}`)
}
