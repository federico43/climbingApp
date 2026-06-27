import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import crypto from "node:crypto"

// Env (set as Function variables in Appwrite):
//   R2_ACCOUNT_ID         Cloudflare account id
//   R2_ACCESS_KEY_ID      R2 S3 API token access key
//   R2_SECRET_ACCESS_KEY  R2 S3 API token secret
//   R2_BUCKET             bucket name (e.g. climbing-videos)
//   R2_PUBLIC_BASE        public base URL with no trailing slash
//                         (r2.dev subdomain or a custom domain)
//
// Actions (POST body):
//   { ext }                 → presign an upload (default)
//   { action: "delete", key } → delete an object from R2
const EXT_TYPES = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
}

export default async ({ req, res, log, error }) => {
  // ── Auth: any signed-in user may call this ──────────────────────────────────
  const userId = req.headers["x-appwrite-user-id"]
  if (!userId) return res.json({ error: "Not authenticated." }, 401)

  const {
    R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE,
  } = process.env
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET || !R2_PUBLIC_BASE) {
    error("R2 environment variables are not fully configured")
    return res.json({ error: "Server is not configured." }, 500)
  }

  // ── Input ───────────────────────────────────────────────────────────────────
  let body = {}
  try {
    body = req.bodyJson ?? (req.body ? JSON.parse(req.body) : {})
  } catch {
    return res.json({ error: "Invalid JSON body." }, 400)
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  })

  // ── Delete an object ──────────────────────────────────────────────────────────
  if (body.action === "delete") {
    const objectKey = typeof body.key === "string" ? body.key : ""
    // Only ever delete inside our own namespace — never an arbitrary bucket path.
    if (!objectKey.startsWith("videos/")) {
      return res.json({ error: "Invalid key." }, 400)
    }
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: objectKey }))
      log(`Deleted ${objectKey}`)
      return res.json({ ok: true }, 200)
    } catch (e) {
      error(`Delete failed: ${e?.message ?? e}`)
      return res.json({ error: "Could not delete object." }, 502)
    }
  }

  // ── Presign an upload (default) ─────────────────────────────────────────────
  const ext = (typeof body.ext === "string" ? body.ext : "mp4").toLowerCase().replace(/[^a-z0-9]/g, "")
  const contentType = EXT_TYPES[ext] || "application/octet-stream"

  // Namespace keys by user so one athlete can't overwrite another's clips.
  const key = `videos/${userId}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`

  try {
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: contentType }),
      { expiresIn: 600 } // 10 minutes to complete the upload
    )
    const publicUrl = `${R2_PUBLIC_BASE.replace(/\/$/, "")}/${key}`
    log(`Presigned upload for ${key}`)
    return res.json({ uploadUrl, publicUrl, key, contentType }, 200)
  } catch (e) {
    error(`Presign failed: ${e?.message ?? e}`)
    return res.json({ error: "Could not prepare upload." }, 502)
  }
}
