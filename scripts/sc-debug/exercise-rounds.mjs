// Read-only: every logged round of one S&C exercise for one athlete, as the
// coach's Progression card (utils/scCoach.ts) reads them — focus saved on
// each round, reps, weight, effort, the hardest-setup switch — next to how
// the exercise was programmed in that session's block. Writes nothing.
//
//   node --env-file=.env.local scripts/sc-debug/exercise-rounds.mjs <username> "<exercise name>"
//   e.g. node --env-file=.env.local scripts/sc-debug/exercise-rounds.mjs nalguete "TRX Biceps Curl"

const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID } = process.env
const who = process.argv[2] ?? ""
const exArg = process.argv[3] ?? ""
if (!who || !exArg) {
  console.log('Usage: node --env-file=.env.local scripts/sc-debug/exercise-rounds.mjs <username> "<exercise name>"')
  process.exit(1)
}

async function api(path) {
  const res = await fetch(`${APPWRITE_ENDPOINT}${path}`, {
    headers: { "X-Appwrite-Project": APPWRITE_PROJECT_ID, "X-Appwrite-Key": APPWRITE_API_KEY },
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${json.message ?? ""}`)
  return json
}
const db = `/tablesdb/${APPWRITE_DATABASE_ID}/tables`
const q = (o) => `queries[]=${encodeURIComponent(JSON.stringify(o))}`
async function all(table, queries = []) {
  const out = []
  let cursor = null
  for (;;) {
    const qs = [...queries, q({ method: "limit", values: [100] })]
    if (cursor) qs.push(q({ method: "cursorAfter", values: [cursor] }))
    const { rows } = await api(`${db}/${table}/rows?${qs.join("&")}`)
    out.push(...rows)
    if (rows.length < 100) return out
    cursor = rows[rows.length - 1].$id
  }
}
const parse = (s) => { try { return JSON.parse(s || "[]") } catch { return [] } }
const norm = (s) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[\s_-]+/g, "")

// ── Athlete ──
const users = await all("users", [q({ method: "select", values: ["$id", "username"] })])
const exact = users.filter((u) => norm(u.username) === norm(who))
const matches = exact.length ? exact : users.filter((u) => norm(u.username).includes(norm(who)))
console.log(`Users matching "${who}": ${matches.map((u) => `${u.username} (${u.$id})`).join(", ") || "none"}`)
if (matches.length !== 1) process.exit(matches.length ? 0 : 1)
const user = matches[0]

// ── Exercise (library) ──
const library = await all("exercises")
const libMatches = library.filter((e) => norm(e.name).includes(norm(exArg)))
console.log(`Library rows matching "${exArg}":`)
for (const e of libMatches) {
  console.log(`  ${e.name} (${e.$id}) · type ${e.type ?? "–"} · movement ${e.movementType ?? "–"} · focuses ${e.focuses ?? "–"} · loadMode ${e.loadMode ?? "–"}`)
  console.log(`    setting harder: ${e.settingHarder || "–"} · easier: ${e.settingEasier || "–"} · levels ${e.levels ? "yes" : "–"}`)
}
const ids = new Set(libMatches.map((e) => e.$id))
const isMine = (d) => !!d && ((d.exerciseId && ids.has(d.exerciseId)) || norm(d.exerciseName).includes(norm(exArg)))
const progMatches = (ex, d) => (d.exerciseId && (ex.exerciseId === d.exerciseId || (ex.levels ?? []).some((l) => l?.exerciseId === d.exerciseId))) || ex.name === d.exerciseName

// ── Plans (for the focus rules) ──
const plans = await all("training_plans", [q({ method: "equal", attribute: "athleteId", values: [user.$id] })]).catch((e) => (console.log(`plans: ${e.message}`), []))
for (const p of plans) {
  console.log(`plan ${p.$id}: ${p.status ?? "–"} · kind ${p.kind ?? "–"} · window ${p.windowStart ?? p.startDate ?? "?"} → ${p.windowEnd ?? "?"} · scFocuses ${p.scFocuses ?? "–"}`)
}
console.log("")

// ── Sessions ──
const sessions = await all("workoutsession", [q({ method: "equal", attribute: "userId", values: [user.$id] })])
sessions.sort((a, b) => (a.$createdAt < b.$createdAt ? -1 : 1))
let shown = 0
for (const s of sessions) {
  const protocol = parse(s.protocol)
  const attempts = parse(s.attempts).filter((a) => a?.type === "strength_conditioning" && (isMine(a.scData) || isMine(a.scData?.swappedFrom)))
  if (!attempts.length) continue
  shown++
  const extra = ["protocolId", "protocolName", "name", "planId", "workoutIndex", "source"].filter((k) => s[k] != null).map((k) => `${k} ${s[k]}`).join(" · ")
  console.log(`${s.$createdAt}  session ${s.$id}${extra ? `  (${extra})` : ""}`)
  const blocks = [...new Set(attempts.map((a) => a.blockIndex))]
  for (const bi of blocks) {
    const block = protocol[bi]
    const ex = (block?.exercises ?? []).find((e) => attempts.some((a) => a.blockIndex === bi && progMatches(e, a.scData)))
    console.log(`  block ${bi} "${block?.blockName ?? block?.name ?? "?"}" · rounds ${block?.rounds ?? "–"} · rest ${block?.restBetweenRounds ?? "–"}s · ${(block?.exercises ?? []).map((e) => e.name).join(" + ")}`)
    if (ex) console.log(`    programmed: ${ex.name} · focus ${ex.focus ?? "–"} · reps "${ex.reps ?? "–"}" · unit ${ex.unit ?? "–"} · movement ${ex.movementType ?? "–"} · setting ${ex.settingHarder || ex.settingEasier ? "yes" : "–"}`)
    else console.log("    programmed: (no matching exercise in this block)")
    const rounds = attempts.filter((a) => a.blockIndex === bi).sort((a, b) => (a.scData?.round ?? 0) - (b.scData?.round ?? 0))
    for (const a of rounds) {
      const d = a.scData
      const reps = d.repsCompleted ?? (d.repsLeft != null ? `${d.repsLeft}/${d.repsRight}` : "–")
      const weight = d.weight ?? (d.weightLeft != null ? `${d.weightLeft}/${d.weightRight}` : "–")
      const flags = [
        d.atHardestSetting === true ? "HARDEST" : d.atHardestSetting === false ? "not hardest" : null,
        d.adjustedFrom ? `adjustedFrom ${JSON.stringify(d.adjustedFrom)}` : null,
        d.swappedFrom ? `swappedFrom ${d.swappedFrom.exerciseName ?? d.swappedFrom.exerciseId}` : null,
      ].filter(Boolean).join(" · ")
      const time = a.timestamp ? new Date(a.timestamp).toISOString().slice(11, 16) : "–"
      console.log(`    round ${d.round ?? "?"} ${time} · ${d.exerciseName} · focus ${d.focus ?? "(none saved)"} · reps ${reps} · weight ${weight} · effort ${d.effort ?? "–"} (rpe ${d.rpe ?? d.rpeLeft ?? "–"})${flags ? ` · ${flags}` : ""}`)
    }
  }
  console.log("")
}
console.log(`${shown} of ${sessions.length} sessions logged "${exArg}".`)
