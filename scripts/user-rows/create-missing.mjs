// Crea en `users` la fila que le falta a cuentas de Auth (rol "athlete"),
// para que salgan en el dashboard del coach. Sin ids: todas las que falten.
// Prueba por defecto: solo muestra lo que haría. Con --apply escribe.
//   node --env-file=.env.local scripts/user-rows/create-missing.mjs [--apply] [id ...]
const { APPWRITE_ENDPOINT: E, APPWRITE_PROJECT_ID: P, APPWRITE_API_KEY: K, APPWRITE_DATABASE_ID: DB } = process.env
for (const [n, v] of Object.entries({ E, P, K, DB })) if (!v) { console.error("Falta variable", n); process.exit(1) }
const APPLY = process.argv.includes("--apply")
const ARGS = process.argv.slice(2).filter((a) => !a.startsWith("--"))
async function api(method, path, body) {
  const r = await fetch(E + path, {
    method, body: body && JSON.stringify(body),
    headers: { "Content-Type": "application/json", "X-Appwrite-Project": P, "X-Appwrite-Key": K },
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(`${method} ${path} → ${r.status} ${j.message ?? ""}`), { status: r.status })
  return j
}
async function allAuthIds() {
  const out = []
  for (let cursor; ;) {
    const qs = [JSON.stringify({ method: "limit", values: [100] })]
    if (cursor) qs.push(JSON.stringify({ method: "cursorAfter", values: [cursor] }))
    const { users } = await api("GET", "/users?" + qs.map((q) => "queries[]=" + encodeURIComponent(q)).join("&"))
    out.push(...users.map((u) => u.$id))
    if (users.length < 100) return out
    cursor = out.at(-1)
  }
}
const IDS = ARGS.length ? ARGS : await allAuthIds()
for (const id of IDS) {
  const u = await api("GET", `/users/${id}`)
  try { await api("GET", `/tablesdb/${DB}/tables/users/rows/${id}`); if (ARGS.length) console.log(`${id}: ya tiene fila, nada que hacer`); continue }
  catch (e) { if (e.status !== 404) throw e }
  const username = u.name || u.email.split("@")[0]
  if (!APPLY) { console.log(`${id}: crearía fila username="${username}" role="athlete" (${u.email})`); continue }
  await api("POST", `/tablesdb/${DB}/tables/users/rows`, {
    rowId: id, data: { username, role: "athlete" },
    permissions: [`read("user:${id}")`, `update("user:${id}")`],
  })
  console.log(`${id}: fila creada (username="${username}")`)
}
if (!APPLY) console.log("\nPrueba: no se escribió nada. Repite con --apply para crearlas.")
