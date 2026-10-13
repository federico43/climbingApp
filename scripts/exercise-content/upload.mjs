// Uploads the reviewed exercise content (exercises-content.json) to the
// exercise library: each demo photo goes to Cloudflare R2 and its public URL
// is written to `photoUri`; each description is written to `notes`.
//
// Only fills fields that are still empty — every row is re-read first, so
// anything a coach wrote in the app since missing.json was exported is never
// overwritten. Safe to re-run: rows already filled are skipped.
//
// Photos go to R2 directly (like scripts/migrate-photos-to-r2) rather than
// through the presign Appwrite Function, which only accepts signed-in users.
// Keys live under images/, so the app's deleteStorageFile() can still remove
// them later.
//
// Usage (dry run by default — prints what would change, writes nothing):
//   cd scripts/exercise-content
//   npm install
//   APPWRITE_ENDPOINT=https://nyc.cloud.appwrite.io/v1 \
//   APPWRITE_PROJECT_ID=689e515d000c2e1af428 \
//   APPWRITE_API_KEY=<server API key with tablesDB read/write scope> \
//   APPWRITE_DATABASE_ID=68bd9dd7003c15f7147e \
//   R2_ACCOUNT_ID=<...> R2_ACCESS_KEY_ID=<...> R2_SECRET_ACCESS_KEY=<...> \
//   R2_BUCKET=climbing-videos R2_PUBLIC_BASE=https://pub-xxxxxxxx.r2.dev \
//   node upload.mjs [--apply]

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import crypto from "node:crypto"

const {
  APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID,
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE,
} = process.env
const APPLY = process.argv.includes("--apply")
const TABLE = "exercises"

for (const [name, value] of Object.entries({
  APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID,
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE,
})) {
  if (!value) { console.error(`Missing env var: ${name}`); process.exit(1) }
}

const here = dirname(fileURLToPath(import.meta.url))
const content = JSON.parse(readFileSync(join(here, "exercises-content.json"), "utf8"))

const base = `${APPWRITE_ENDPOINT}/tablesdb/${APPWRITE_DATABASE_ID}/tables/${TABLE}/rows`
const headers = {
  "Content-Type": "application/json",
  "X-Appwrite-Project": APPWRITE_PROJECT_ID,
  "X-Appwrite-Key": APPWRITE_API_KEY,
}

async function call(url, init) {
  const res = await fetch(url, { headers, ...init })
  const body = await res.json()
  if (!res.ok) throw new Error(`${res.status} ${body.message ?? JSON.stringify(body)}`)
  return body
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
})
const R2_PUBLIC_BASE_CLEAN = R2_PUBLIC_BASE.replace(/\/$/, "")

const blank = (v) => typeof v !== "string" || v.trim() === ""

console.log(APPLY ? "── LIVE — uploading photos and updating rows ──" : "── DRY RUN — nothing will be written ──")
const totals = { photos: 0, notes: 0, skipped: 0, failed: 0 }

for (const item of content) {
  try {
    const row = await call(`${base}/${item.id}`)
    const data = {}
    const actions = []

    if (item.notes && blank(row.notes)) {
      data.notes = item.notes
      actions.push("notes")
    }

    if (item.image && blank(row.photoUri)) {
      const bytes = readFileSync(join(here, item.image))
      const key = `images/library/exercises/${item.id}-${crypto.randomBytes(4).toString("hex")}.jpg`
      if (APPLY) {
        await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: bytes, ContentType: "image/jpeg" }))
      }
      data.photoUri = `${R2_PUBLIC_BASE_CLEAN}/${key}`
      actions.push(`photo (${Math.round(bytes.length / 1024)} KB)`)
    }

    if (actions.length === 0) {
      totals.skipped++
      console.log(`  skip       ${item.name} (already filled)`)
      continue
    }

    if (APPLY) {
      await call(`${base}/${item.id}`, { method: "PATCH", body: JSON.stringify({ data }) })
    }
    if (data.notes) totals.notes++
    if (data.photoUri) totals.photos++
    console.log(`  ${APPLY ? "updated   " : "would set "} ${item.name}: ${actions.join(" + ")}`)
  } catch (e) {
    totals.failed++
    console.warn(`  FAILED     ${item.name} (${item.id}): ${e?.message ?? e}`)
  }
}

console.log(`\n${totals.photos} photo(s), ${totals.notes} description(s), ${totals.skipped} skipped, ${totals.failed} failed`)
if (!APPLY) console.log("Dry run — nothing written. Re-run with --apply.")
