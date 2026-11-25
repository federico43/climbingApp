// One-off: bring athletes' class packages in line with Federico's tracker
// (2026-11-25). For each athlete below it adds a new package row starting
// today whose total is the sessions they have left, so the app shows the
// right "X of Y left". Old rows stay as history (the newest one is used).
// Dry run by default: prints a before/after table and changes nothing.
//
//   node --env-file=.env.local scripts/class-packages/update-2026-11-25.mjs [--apply]
//   Options:
//     --as=Pablo:USERNAME        which username an athlete is, when the match is wrong or ambiguous
//     --barbas-paid=YYYY-MM-DD   day Pipe Barbas's new package starts (default 2026-11-23)
//     --barbas-size=N            sessions in it (default 8)
//
// Only in-person classes in the app count down a package. Virtual classes
// (workouts) don't, so a virtual balance stays until the coach changes it.
import { classesDone, createRow, describe, loadAll, now, packageNow, plusDays, rows } from "./lib.mjs"

const APPLY = process.argv.includes("--apply")
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)
const AS = Object.fromEntries(process.argv.filter((a) => a.startsWith("--as=")).map((a) => a.slice(5).split(":")))
const BARBAS_PAID = arg("barbas-paid") ?? "2026-11-23"
const BARBAS_SIZE = Number(arg("barbas-size") ?? 8)
const at = now()
const NEW_USE_BY = plusDays(at.ymd, 28) // same as the app's default "use within 4 weeks"

// left(ctx) → sessions left; useBy "new" = 4 weeks from today, "keep" = the current use-by (if not past).
const PLAN = [
  { who: "Danna", match: /danna/i, useBy: "new", why: "owed 1 class, paid 3",
    left: () => 2 },
  { who: "Milena", match: /mile/i, useBy: "new", why: "2 virtual (swap) + 6 virtual paid = 8, minus the \"leticia\" workouts",
    left: (c) => Math.max(0, 8 - c.leticia.length) },
  { who: "Pablo", match: /pabl|p1blis/i, useBy: "new", why: "new 4 virtual + 4 in-person, none used",
    left: () => 8 },
  { who: "Pipe Barbas", match: /barba/i, useBy: "new", why: `new ${BARBAS_SIZE} from ${BARBAS_PAID}, minus in-app classes since`,
    left: (c) => Math.max(0, BARBAS_SIZE - classesDone(c.all, c.user.$id, BARBAS_PAID, null, at).length) },
  { who: "Val", match: /^val/i, useBy: "keep", why: "1 left",
    left: () => 1 },
]

const all = await loadAll()
const athletes = all.users.filter((u) => u.role !== "coach")
const leticia = (await rows("protocol", [{ method: "select", values: ["$id", "name", "athleteId", "$createdAt"] }]))
  .filter((w) => /leticia/i.test(w.name ?? ""))

console.log(`Today in the gym: ${at.ymd}${APPLY ? "" : "  (dry run)"}\n`)
const todo = []
for (const p of PLAN) {
  const forced = AS[p.who] ?? AS[p.who.split(" ")[0]]
  const found = forced ? athletes.filter((u) => u.username === forced) : athletes.filter((u) => p.match.test(u.username ?? ""))
  if (found.length !== 1) {
    console.log(`${p.who}: ${found.length ? "more than one match: " + found.map((u) => u.username).join(", ") : "no username matches"}` +
      ` → skipped. Pass --as="${p.who.split(" ")[0]}:USERNAME".`)
    continue
  }
  const user = found[0]
  const before = packageNow(all, user.$id, at)
  const left = p.left({ all, user, leticia: leticia.filter((w) => !w.athleteId || w.athleteId === user.$id) })
  const useBy = p.useBy === "keep" && before.pkg && before.pkg.useBy >= at.ymd ? before.pkg.useBy : NEW_USE_BY
  console.log(`${p.who} = ${user.username}`)
  console.log(`   before: ${describe(before)}`)
  console.log(`   after:  ${left} of ${left} left · started ${at.ymd} · use by ${useBy}${left <= 0 ? " · LOCKED" : ""}   (${p.why})`)
  if (p.who === "Milena") console.log(`   "leticia" workouts counted: ${leticia.filter((w) => !w.athleteId || w.athleteId === user.$id).length}`)
  if (before.locked && left > 0) console.log("   note: was locked, so the app took them out of this week's classes; they go back into their usual ones from next week (add them to this week's by hand if needed)")
  todo.push({ user, row: { athleteId: user.$id, total: left, startsOn: at.ymd, useBy } })
}
console.log("\nNot changed (fine as they are): Pipe / Felipe U, Manuel.")

if (!APPLY) { console.log("\nDry run. Pass --apply to add these packages."); process.exit(0) }
for (const t of todo) {
  await createRow("packages", t.row)
  console.log(`added: ${t.user.username} ${t.row.total} sessions, use by ${t.row.useBy}`)
}
