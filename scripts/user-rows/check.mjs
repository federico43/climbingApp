// Solo lectura: compara las cuentas de Appwrite Auth con las filas de la tabla
// `users` (lo que lee el dashboard del coach). No cambia nada.
//   node --env-file=.env.local scripts/user-rows/check.mjs
const { APPWRITE_ENDPOINT: E, APPWRITE_PROJECT_ID: P, APPWRITE_API_KEY: K, APPWRITE_DATABASE_ID: DB } = process.env
for (const [n, v] of Object.entries({ E, P, K, DB })) if (!v) { console.error("Falta variable", n); process.exit(1) }
const get = async (path) => {
  const r = await fetch(E + path, { headers: { "X-Appwrite-Project": P, "X-Appwrite-Key": K } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`GET ${path} → ${r.status} ${j.message ?? ""}`)
  return j
}
const q = (o) => "queries[]=" + encodeURIComponent(JSON.stringify(o))
async function all(path, key) {
  const out = []
  for (let cursor; ;) {
    const qs = [q({ method: "limit", values: [100] })]
    if (cursor) qs.push(q({ method: "cursorAfter", values: [cursor] }))
    const page = (await get(`${path}?${qs.join("&")}`))[key]
    out.push(...page)
    if (page.length < 100) return out
    cursor = page.at(-1).$id
  }
}
const table = await get(`/tablesdb/${DB}/tables/users`)
const auth = await all("/users", "users")
const rows = await all(`/tablesdb/${DB}/tables/users/rows`, "rows")
const rowIds = new Set(rows.map((r) => r.$id))
const authIds = new Set(auth.map((u) => u.$id))
const roles = {}
for (const r of rows) roles[r.role ?? "(vacío)"] = (roles[r.role ?? "(vacío)"] ?? 0) + 1

console.log(`Cuentas en Auth: ${auth.length}`)
console.log(`Filas en tabla users (lo que ve el dashboard): ${rows.length}`)
console.log("Filas por rol:", roles)
console.log(`Tabla users: rowSecurity=${table.rowSecurity}, permisos de tabla=${JSON.stringify(table.$permissions)}`)

const sinFila = auth.filter((u) => !rowIds.has(u.$id))
console.log(`\nCuentas en Auth SIN fila en users (no salen en el dashboard): ${sinFila.length}`)
for (const u of sinFila) console.log(`  ${u.$id}  ${u.name || "-"}  ${u.email}  creada ${u.$createdAt.slice(0, 10)}`)

const huerfanas = rows.filter((r) => !authIds.has(r.$id))
console.log(`\nFilas en users sin cuenta en Auth: ${huerfanas.length}`)
for (const r of huerfanas) console.log(`  ${r.$id}  ${r.username || "-"}  rol=${r.role ?? "-"}`)

if (table.rowSecurity) {
  const tablaLee = (table.$permissions ?? []).some((p) => p.startsWith("read("))
  console.log(`\nrowSecurity activo; la tabla ${tablaLee ? "SÍ" : "NO"} da lectura general.`)
  if (!tablaLee) {
    const raras = rows.filter((r) => !(r.$permissions ?? []).some((p) => /read\("(any|users)"\)/.test(p)))
    console.log(`Filas que solo puede leer su dueño (el coach no las vería): ${raras.length}`)
    for (const r of raras) console.log(`  ${r.$id}  ${r.username || "-"}  ${JSON.stringify(r.$permissions)}`)
  }
}
