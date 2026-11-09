// One-off script: adds the reviewed TRX exercises (trx-exercises.json) to the
// exercise library (Appwrite `exercises` table). Each demo image in images/
// goes to Cloudflare R2 and its public URL becomes the row's `photoUri`.
//
// Skips any exercise whose name is already in the library (case-insensitive),
// so it's safe to re-run. Entries with "skip": true in the JSON are left out
// (TRX Row = the existing "Inverted Row").
//
// The images are for the personal demo only — replace them with your own
// photos (Exercise library › edit) before a store release.
//
// No dependencies: Appwrite via REST, R2 via a signed S3 PUT.
//
// Usage (dry run by default — prints what it would create, writes nothing):
//   node --env-file=.env.local scripts/trx-exercises/upload.mjs [--apply]
// (.env.local: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY,
//  APPWRITE_DATABASE_ID, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
//  R2_BUCKET, R2_PUBLIC_BASE)

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import crypto from "node:crypto"

const env = process.env
const APPLY = process.argv.includes("--apply")
const TABLE = "exercises"
const REQUIRED = [
  "APPWRITE_ENDPOINT", "APPWRITE_PROJECT_ID", "APPWRITE_API_KEY", "APPWRITE_DATABASE_ID",
  "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_BASE",
]
const missing = REQUIRED.filter((k) => !env[k])
if (missing.length) {
  console.error(`Missing in .env.local: ${missing.join(", ")}`)
  process.exit(1)
}

const here = dirname(fileURLToPath(import.meta.url))
const exercises = JSON.parse(readFileSync(join(here, "trx-exercises.json"), "utf8"))

// ─── Appwrite ────────────────────────────────────────────────────────────────

const base = `${env.APPWRITE_ENDPOINT}/tablesdb/${env.APPWRITE_DATABASE_ID}/tables/${TABLE}/rows`
const headers = {
  "Content-Type": "application/json",
  "X-Appwrite-Project": env.APPWRITE_PROJECT_ID,
  "X-Appwrite-Key": env.APPWRITE_API_KEY,
}

async function call(url, init) {
  const res = await fetch(url, { headers, ...init })
  const body = await res.json()
  if (!res.ok) throw new Error(`${res.status} ${body.message ?? JSON.stringify(body)}`)
  return body
}

// ─── R2 (S3 SigV4, single PUT) ───────────────────────────────────────────────

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex")
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest()

async function putR2(key, bytes, contentType) {
  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  const path = `/${env.R2_BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "")
  const day = amzDate.slice(0, 8)
  const payloadHash = sha256(bytes)
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date"
  const canonicalRequest = ["PUT", path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n")
  const scope = `${day}/auto/s3/aws4_request`
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n")
  let k = hmac(`AWS4${env.R2_SECRET_ACCESS_KEY}`, day)
  for (const part of ["auto", "s3", "aws4_request"]) k = hmac(k, part)
  const signature = crypto.createHmac("sha256", k).update(stringToSign).digest("hex")
  const res = await fetch(`https://${host}${path}`, {
    method: "PUT",
    body: bytes,
    headers: {
      "Content-Type": contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${env.R2_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  })
  if (!res.ok) throw new Error(`R2 ${res.status} ${await res.text()}`)
}

// ─── Run ─────────────────────────────────────────────────────────────────────

const limit = encodeURIComponent(JSON.stringify({ method: "limit", values: [1000] }))
const { rows } = await call(`${base}?queries[]=${limit}`)
const existing = new Set(rows.map((r) => r.name.trim().toLowerCase()))
const publicBase = env.R2_PUBLIC_BASE.replace(/\/$/, "")

console.log(APPLY ? "── LIVE — uploading images and creating rows ──" : "── DRY RUN — nothing will be written ──")
const totals = { created: 0, skipped: 0, failed: 0 }

for (const ex of exercises) {
  if (ex.skip) {
    totals.skipped++
    console.log(`  skip       ${ex.name} (${ex.skipReason ?? "marked skip"})`)
    continue
  }
  if (existing.has(ex.name.trim().toLowerCase())) {
    totals.skipped++
    console.log(`  skip       ${ex.name} (already in the library)`)
    continue
  }
  try {
    const bytes = readFileSync(join(here, ex.image))
    const key = `images/library/exercises/trx-${ex.key}-${crypto.randomBytes(4).toString("hex")}.jpg`
    const data = {
      name: ex.name,
      type: ex.type,
      unit: ex.unit,
      notes: ex.notes,
      movementType: ex.movementType,
      photoUri: `${publicBase}/${key}`,
    }
    if (ex.defaultReps) data.defaultReps = ex.defaultReps
    if (ex.movementType !== "mobility") {
      data.loadMode = "weight"
      if (ex.settingHarder) data.settingHarder = ex.settingHarder
      if (ex.settingEasier) data.settingEasier = ex.settingEasier
      // Unset = every focus the pattern allows (core and joints never get
      // explosiveness, see focusesFor in utils/scProgression.ts).
      if (ex.focuses?.length) data.focuses = JSON.stringify(ex.focuses)
    }
    if (APPLY) {
      await putR2(key, bytes, "image/jpeg")
      await call(base, { method: "POST", body: JSON.stringify({ rowId: "unique()", data }) })
    }
    totals.created++
    const focus = ex.movementType === "mobility" ? "mobility" : (ex.focuses ?? ["pattern default"]).join("+")
    console.log(`  ${APPLY ? "created   " : "would add "} ${ex.name} [${ex.movementType}, ${focus}, ${ex.type}, ${Math.round(bytes.length / 1024)} KB image]`)
  } catch (e) {
    totals.failed++
    console.warn(`  FAILED     ${ex.name}: ${e?.message ?? e}`)
  }
}

console.log(`\n${totals.created} ${APPLY ? "created" : "to create"}, ${totals.skipped} skipped, ${totals.failed} failed`)
if (!APPLY) console.log("Dry run — nothing written. Re-run with --apply.")
