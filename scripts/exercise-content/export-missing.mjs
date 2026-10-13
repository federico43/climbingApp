// Read-only: lists every exercise in the Appwrite `exercises` table that is
// missing a description (`notes`) and/or a photo (`photoUri`), and writes them
// to missing.json next to this script. Phase 1 of filling in exercise content
// (descriptions + demo photos). Writes nothing to Appwrite.
//
// Photos still on old Appwrite Storage (".../storage/buckets/...") are hidden
// by the app but count as present here — they're left for a later migration.
//
// Usage:
//   APPWRITE_ENDPOINT=https://nyc.cloud.appwrite.io/v1 \
//   APPWRITE_PROJECT_ID=689e515d000c2e1af428 \
//   APPWRITE_API_KEY=<server API key with tablesDB read scope> \
//   APPWRITE_DATABASE_ID=68bd9dd7003c15f7147e \
//   node scripts/exercise-content/export-missing.mjs

import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID } = process.env
const TABLE = "exercises"

for (const [name, value] of Object.entries({
  APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID,
})) {
  if (!value) { console.error(`Missing env var: ${name}`); process.exit(1) }
}

const base = `${APPWRITE_ENDPOINT}/tablesdb/${APPWRITE_DATABASE_ID}/tables/${TABLE}/rows`
const headers = {
  "X-Appwrite-Project": APPWRITE_PROJECT_ID,
  "X-Appwrite-Key": APPWRITE_API_KEY,
}

async function call(url) {
  const res = await fetch(url, { headers })
  const body = await res.json()
  if (!res.ok) throw new Error(`${res.status} ${body.message ?? JSON.stringify(body)}`)
  return body
}

// Page through the whole table with cursors.
const rows = []
let cursor
for (;;) {
  const queries = [{ method: "limit", values: [100] }]
  if (cursor) queries.push({ method: "cursorAfter", values: [cursor] })
  const qs = queries.map((q) => `queries[]=${encodeURIComponent(JSON.stringify(q))}`).join("&")
  const page = await call(`${base}?${qs}`)
  rows.push(...page.rows)
  if (page.rows.length < 100) break
  cursor = page.rows[page.rows.length - 1].$id
}

const blank = (v) => typeof v !== "string" || v.trim() === ""

const missing = rows
  .map((row) => ({
    id: row.$id,
    name: row.name.trim(),
    type: row.type,
    unit: row.unit ?? null,
    movementType: row.movementType ?? null,
    missingNotes: blank(row.notes),
    missingPhoto: blank(row.photoUri),
  }))
  .filter((r) => r.missingNotes || r.missingPhoto)
  .sort((a, b) => a.name.localeCompare(b.name))

const out = join(dirname(fileURLToPath(import.meta.url)), "missing.json")
writeFileSync(out, JSON.stringify(missing, null, 2) + "\n")

const n = (pred) => missing.filter(pred).length
console.log(`${rows.length} exercises in the library, ${missing.length} need content:`)
console.log(`  ${n((r) => r.missingNotes && r.missingPhoto)} missing both`)
console.log(`  ${n((r) => r.missingNotes && !r.missingPhoto)} missing description only`)
console.log(`  ${n((r) => !r.missingNotes && r.missingPhoto)} missing photo only`)
console.log(`\nWrote ${out}`)
