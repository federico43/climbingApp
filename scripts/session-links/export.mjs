// Read-only export: every logged attempt, one CSV line each, for review in a
// spreadsheet. Prints "CSV|<line>" so the lines can be pulled out of a log.
//   node --env-file=.env.local scripts/session-links/export.mjs > out.txt
const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID } = process.env
async function api(path) {
  const res = await fetch(`${APPWRITE_ENDPOINT}${path}`, { headers: { "X-Appwrite-Project": APPWRITE_PROJECT_ID, "X-Appwrite-Key": APPWRITE_API_KEY } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${json.message ?? ""}`)
  return json
}
const db = `/tablesdb/${APPWRITE_DATABASE_ID}/tables`
const q = (o) => `queries[]=${encodeURIComponent(JSON.stringify(o))}`
async function all(table, queries = []) {
  const out = []; let cursor = null
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
const bogota = (ms) => new Date(ms - 5 * 3600e3).toISOString().replace("T", " ").slice(0, 16)
const cell = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""').replace(/\n/g, " ")}"` : s }
const out = (cols) => console.log("CSV|" + cols.map(cell).join(","))

const users = new Map((await all("users", [q({ method: "select", values: ["$id", "username"] })])).map((u) => [u.$id, u.username]))
const lib = new Map((await all("exercises")).map((e) => [e.$id, e]))
const sessions = (await all("workoutsession")).sort((a, b) => (a.$createdAt < b.$createdAt ? -1 : 1))

out(["athlete", "date (Bogotá)", "session", "block #", "block type", "block name", "programmed exercise", "logged exercise", "movement", "focus",
  "round", "reps", "reps L", "reps R", "weight", "weight L", "weight R", "unit", "RPE", "seconds/series", "level/grade", "success", "notes", "swapped from", "swap reason", "plan linked"])
for (const s of sessions) {
  const who = users.get(s.userId?.$id ?? s.userId) ?? (s.userId?.$id ?? s.userId)
  const protocol = parse(s.protocol), attempts = parse(s.attempts)
  for (const a of attempts) {
    if (!(a?.blockIndex >= 0)) continue
    const b = protocol[a.blockIndex] ?? {}
    const d = a.scData ?? {}
    const prog = Array.isArray(b.exercises)
      ? b.exercises.find((e) => (d.exerciseId && (e.exerciseId === d.exerciseId || (e.levels ?? []).some((l) => l?.exerciseId === d.exerciseId))) || e.name === d.exerciseName)
        ?? (d.swappedFrom ? b.exercises.find((e) => e.exerciseId === d.swappedFrom.exerciseId || e.name === d.swappedFrom.exerciseName) : undefined)
      : undefined
    const libEx = lib.get(d.exerciseId) ?? lib.get(prog?.exerciseId)
    out([who, a.timestamp ? bogota(a.timestamp) : s.$createdAt.slice(0, 16), s.$id, a.blockIndex + 1, b.type ?? a.type, b.name ?? "",
      prog?.name ?? "", d.exerciseName ?? "", prog?.movementType ?? libEx?.movementType ?? "", d.focus ?? prog?.focus ?? "",
      d.round ?? "", d.repsCompleted ?? "", d.repsLeft ?? "", d.repsRight ?? "", d.weight ?? "", d.weightLeft ?? "", d.weightRight ?? "",
      d.weightUnit ?? "", d.rpe ?? a.rpe ?? "", d.seriesDone ?? d.workTime ?? d.series ?? "", a.level ?? (d.grades ? d.grades.join(" ") : ""),
      a.success == null ? "" : a.success ? "yes" : "no", d.notes ?? a.notes ?? "", d.swappedFrom?.exerciseName ?? "", d.swapReason ?? "", s.protocolId ? "yes" : "no"])
  }
}
