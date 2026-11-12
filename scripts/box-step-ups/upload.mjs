// One-off script: adds "Box Step-Ups" to the exercise library (Appwrite
// `exercises` table). The demo image in images/ goes to Cloudflare R2 and
// its public URL becomes the row's `photoUri` (same as trx-exercises).
//
// Choices (Federico can change any of them later in Exercise library › edit):
//   - movementType "squat": single-leg, knee-dominant, the same pattern as
//     "TRX Bulgarian Split Squat". A row has one pattern, and step-ups aren't
//     a joint exercise, so no joint pattern (ankle etc.).
//   - type "both_sides", unit "reps": all reps on one leg, then the other.
//   - loadMode "weight" with dumbbells, loadStep 2 kg.
//   - focuses max force + hypertrophy (explosive step-ups / box jumps are a
//     different exercise).
//   - settingHarder / settingEasier = box height, which the app doesn't measure.
//   - no defaultReps: the plan sets reps from the focus.
//
// Skips if any library exercise already looks like a step-up, so it's safe
// to re-run. The image is for the personal demo only; replace it with your
// own photo before a store release.
//
// Usage (dry run by default: prints what it would create, writes nothing):
//   node --env-file=.env.local scripts/box-step-ups/upload.mjs [--apply]
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

const EXERCISE = {
  name: "Box Step-Ups",
  type: "both_sides",
  unit: "reps",
  movementType: "squat",
  loadMode: "weight",
  loadStep: 2,
  focuses: JSON.stringify(["max_force", "hypertrophy"]),
  notes:
    "Stand facing a box with a dumbbell in each hand (or none to start). Put one whole foot on the box. " +
    "Lean the chest slightly forward and push through that heel to stand up tall on the box; " +
    "don't push off the floor with the back foot. Step down slowly with the same back foot, " +
    "keeping the front knee in line with the toes. Finish all reps, then switch legs.",
  settingHarder: "Higher box (thigh above parallel); heavier dumbbells",
  settingEasier: "Lower box; no weight; hold on to a wall for balance",
}
const IMAGE = "images/box-step-up.jpg"
// Source: https://www.lyfta.app/exercise/dumbbell-step-up-6lf (demo only)

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
const dupe = rows.find((r) => /step[\s-]?ups?\b/i.test(r.name ?? ""))

console.log(APPLY ? "── LIVE — uploading image and creating row ──" : "── DRY RUN — nothing will be written ──")
if (dupe) {
  console.log(`  skip       ${EXERCISE.name}: "${dupe.name}" (${dupe.$id}) is already in the library`)
  process.exit(0)
}

const bytes = readFileSync(join(here, IMAGE))
const key = `images/library/exercises/box-step-up-${crypto.randomBytes(4).toString("hex")}.jpg`
const data = { ...EXERCISE, photoUri: `${env.R2_PUBLIC_BASE.replace(/\/$/, "")}/${key}` }

if (APPLY) {
  await putR2(key, bytes, "image/jpeg")
  const row = await call(base, { method: "POST", body: JSON.stringify({ rowId: "unique()", data }) })
  console.log(`  created    ${EXERCISE.name} (${row.$id})`)
} else {
  console.log(`  would add  ${EXERCISE.name} [squat, max_force+hypertrophy, both_sides, ${Math.round(bytes.length / 1024)} KB image]`)
  console.log(data)
  console.log("Dry run — nothing written. Re-run with --apply.")
}
