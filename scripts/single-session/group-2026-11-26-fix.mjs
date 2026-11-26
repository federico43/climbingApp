// Follow-up to group-2026-11-26.mjs (coach 2026-11-25, after --apply):
//   - Quita Presas becomes two blocks of 7 minutes each: first "Orange", then "Blue".
//   - A workout with route exploration AND project bouldering keeps only ONE
//     project (AleFuego W7, Pablo W1).
// For Paula Cadena W9, AleFuego W7 and Pablo (p1blis81) W1. Safe to re-run.
//
//   node --env-file=.env.local scripts/single-session/group-2026-11-26-fix.mjs [--apply]

const { APPWRITE_ENDPOINT: E, APPWRITE_PROJECT_ID: P, APPWRITE_API_KEY: K, APPWRITE_DATABASE_ID: DB } = process.env
for (const [n, v] of Object.entries({ E, P, K, DB })) if (!v) { console.error("Missing env var", n); process.exit(1) }
const APPLY = process.argv.includes("--apply")
const PABLO = process.argv.find((a) => a.startsWith("--pablo="))?.slice(8) ?? "p1blis81"

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
const same = (a, b) => String(a ?? "").trim().toLowerCase() === String(b).trim().toLowerCase()
const line = (b) => `${String(b.blockName ?? b.type).trim()}${b.timeLimit ? ` ${b.timeLimit} min` : ""}${isQuita(b) ? ` (${String(b.description ?? "").split(".")[0] || "no note"})` : ""}`

const isQuita = (b) => /quita\s*presas/i.test(b?.blockName ?? "")
const isProject = (b) => b?.type === "project_bouldering" && !b.focusTask && !b.taskIntro
const quitaPair = (base) => {
  const rest = base
  return ["Orange", "Blue"].map((colour) => ({
    ...rest,
    timeLimit: 7,
    description: `${colour}.${rest.description ? `\n\n${String(rest.description).replace(/^(Orange|Blue)\.\s*/i, "")}` : ""}`,
  }))
}

const users = await list("users", [{ method: "select", values: ["$id", "username"] }])
for (const [username, index] of [["Paula Cadena", 9], ["AleFuego", 7], [PABLO, 1]]) {
  console.log(`\n── ${username} ──`)
  const u = users.find((x) => same(x.username, username))
  if (!u) { console.log("! user not found"); continue }
  const plan = (await list("training_plans", [{ method: "equal", attribute: "athleteId", values: [u.$id] }, { method: "equal", attribute: "status", values: ["active"] }]))[0]
  const w = plan && (await list("protocol", [{ method: "equal", attribute: "planId", values: [plan.$id] }]))
    .filter((r) => r.planIndex === index && !r.planPart).sort((a, b) => b.$createdAt.localeCompare(a.$createdAt))[0]
  if (!w) { console.log(`! Workout ${index} not found`); continue }
  const blocks = json(w.blocks, [])
  console.log(`  "${w.name}" now: ${blocks.map(line).join(" · ")}`)

  let out = blocks
  const quitas = blocks.filter(isQuita)
  const pairDone = quitas.length === 2 && quitas.every((b) => b.timeLimit === 7)
  if (!quitas.length) console.log("  ! no Quita Presas block")
  else if (!pairDone) {
    const at = blocks.findIndex(isQuita)
    const rest = blocks.filter((b) => !isQuita(b))
    out = [...rest.slice(0, at), ...quitaPair(quitas[0]), ...rest.slice(at)]
  }
  if (out.some((b) => b?.type === "route_exploration")) {
    let seen = false
    out = out.filter((b) => (isProject(b) ? (seen ? false : (seen = true)) : true))
  }
  if (JSON.stringify(out) === JSON.stringify(blocks)) { console.log("  already done"); continue }
  console.log(`  → ${out.map(line).join(" · ")}`)
  if (!APPLY) { console.log("  [dry run] would save"); continue }
  await api("PATCH", `${db}/protocol/rows/${w.$id}`, { data: { blocks: JSON.stringify(out) } })
  console.log("  saved")
}
console.log(APPLY ? "\nDone." : "\nDry run only. Re-run with --apply to write.")
