// One-off migration: moves existing photos (spray wall photos, project cover
// photos, exercise demo photos) from Appwrite Storage to Cloudflare R2, and
// updates each row's URL field to point at the new R2 object.
//
// Why: uploadPhoto() now uploads new photos straight to R2 (see
// services/BoulderGraphService.tsx), matching how video already works. But
// that only affects NEW uploads — anything uploaded before that change is
// still sitting in Appwrite Storage and still counts against Appwrite's
// bandwidth quota every time it's viewed. This script backfills those.
//
// Usage:
//   cd scripts/migrate-photos-to-r2
//   npm install
//   APPWRITE_ENDPOINT=https://nyc.cloud.appwrite.io/v1 \
//   APPWRITE_PROJECT_ID=689e515d000c2e1af428 \
//   APPWRITE_API_KEY=<server API key with tablesDB read/write + storage read scopes> \
//   APPWRITE_DATABASE_ID=68bd9dd7003c15f7147e \
//   R2_ACCOUNT_ID=<...> R2_ACCESS_KEY_ID=<...> R2_SECRET_ACCESS_KEY=<...> \
//   R2_BUCKET=climbing-videos R2_PUBLIC_BASE=https://pub-xxxxxxxx.r2.dev \
//   npm run migrate -- --dry-run
//
// Run once with --dry-run first to see what it would do, with no writes.
// Drop --dry-run to actually migrate. Old Appwrite Storage files are left in
// place (not deleted) so this is safe to re-run and easy to roll back from —
// clean those up manually later once you've confirmed everything looks right.

import { Client, TablesDB, Query } from "node-appwrite"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import crypto from "node:crypto"

const {
  APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID,
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE,
} = process.env

const DRY_RUN = process.argv.includes("--dry-run")

for (const [name, value] of Object.entries({
  APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID,
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE,
})) {
  if (!value) { console.error(`Missing env var: ${name}`); process.exit(1) }
}

const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(APPWRITE_API_KEY)
const tablesDB = new TablesDB(client)

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
})

const R2_PUBLIC_BASE_CLEAN = R2_PUBLIC_BASE.replace(/\/$/, "")

// Every table + column pair that stores a photo URL from the old uploadPhoto().
// Only spray_walls for now — projects/exercises photos are left on Appwrite
// Storage for a later pass.
const TARGETS = [
  { table: "spray_walls", field: "imageUri" },
]

function extFromUrlOrContentType(url, contentType) {
  const m = /\.([a-zA-Z0-9]+)(?:\?|$)/.exec(url)
  if (m) return m[1].toLowerCase()
  if (contentType?.includes("png")) return "png"
  if (contentType?.includes("webp")) return "webp"
  return "jpg"
}

async function listAllRows(tableId) {
  const all = []
  let cursor
  for (;;) {
    const queries = [Query.limit(100)]
    if (cursor) queries.push(Query.cursorAfter(cursor))
    const response = await tablesDB.listRows({ databaseId: APPWRITE_DATABASE_ID, tableId, queries })
    all.push(...response.rows)
    if (response.rows.length < 100) break
    cursor = response.rows[response.rows.length - 1].$id
  }
  return all
}

async function migrateRow(table, field, row) {
  const url = row[field]
  if (!url || typeof url !== "string") return { status: "skip", reason: "empty" }
  if (url.startsWith(R2_PUBLIC_BASE_CLEAN + "/")) return { status: "skip", reason: "already-r2" }
  if (!url.includes("/storage/buckets/")) return { status: "skip", reason: "not-appwrite-storage" }

  const download = await fetch(url)
  if (!download.ok) return { status: "fail", reason: `download ${download.status}` }
  const contentType = download.headers.get("content-type") ?? "image/jpeg"
  const bytes = Buffer.from(await download.arrayBuffer())

  const ext = extFromUrlOrContentType(url, contentType)
  const key = `images/migrated/${table}/${row.$id}-${crypto.randomBytes(4).toString("hex")}.${ext}`
  const publicUrl = `${R2_PUBLIC_BASE_CLEAN}/${key}`

  if (DRY_RUN) return { status: "would-migrate", key, bytes: bytes.length }

  await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: bytes, ContentType: contentType }))
  await tablesDB.updateRow({
    databaseId: APPWRITE_DATABASE_ID, tableId: table, rowId: row.$id, data: { [field]: publicUrl },
  })
  return { status: "migrated", key, bytes: bytes.length }
}

async function main() {
  console.log(DRY_RUN ? "── DRY RUN — no writes will happen ──" : "── LIVE — will upload to R2 and update rows ──")
  const totals = { migrated: 0, "would-migrate": 0, skip: 0, fail: 0 }

  for (const { table, field } of TARGETS) {
    const rows = await listAllRows(table)
    console.log(`\n${table}: ${rows.length} rows`)
    for (const row of rows) {
      let result
      try {
        result = await migrateRow(table, field, row)
      } catch (e) {
        result = { status: "fail", reason: e?.message ?? String(e) }
      }
      totals[result.status] = (totals[result.status] ?? 0) + 1
      if (result.status === "fail") {
        console.warn(`  [FAIL] ${row.$id}: ${result.reason}`)
      } else if (result.status === "skip") {
        console.log(`  [skip] ${row.$id}: ${result.reason}`)
      } else {
        console.log(`  [${result.status}] ${row.$id} -> ${result.key} (${result.bytes} bytes)`)
      }
    }
  }

  console.log("\n── Summary ──")
  console.log(totals)
  if (!DRY_RUN && totals.migrated > 0) {
    console.log(
      "\nOld files were left in Appwrite Storage untouched. Once you've spot-checked\n" +
      "that the new R2 URLs load correctly in the app, clean up the old bucket\n" +
      "manually from the Appwrite console (or extend this script)."
    )
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
