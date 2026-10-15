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
//   { ext, kind }                     → presign an upload (default). kind is
//                                       "video" (default) or "image".
//   { action: "delete", key }         → delete a video object (key already
//                                       known — the `videos` table stores it)
//   { action: "delete", kind, url }   → delete an image object. Photo tables
//                                       (spray_walls/projects/exercises) only
//                                       store the public URL, so the key is
//                                       derived here from R2_PUBLIC_BASE.
const VIDEO_EXT_TYPES = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  // Coach voice-note feedback (expo-av Audio.Recording output).
  m4a: "audio/m4a",
  wav: "audio/wav",
}
const IMAGE_EXT_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
}

// Coach status comes from an Appwrite account label ("coach"), which only an
// admin can set (console or server SDK) — unlike the `users.role` column,
// which any signed-in client can write. Read with the caller's own JWT, so
// the function needs no API key.
async function callerIsCoach(req) {
  const jwt = req.headers["x-appwrite-user-jwt"]
  const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT
  const projectId = process.env.APPWRITE_FUNCTION_PROJECT_ID
  if (!jwt || !endpoint || !projectId) return false
  try {
    const response = await fetch(`${endpoint.replace(/\/$/, "")}/account`, {
      headers: { "X-Appwrite-Project": projectId, "X-Appwrite-JWT": jwt },
    })
    if (!response.ok) return false
    const account = await response.json()
    return Array.isArray(account.labels) && account.labels.includes("coach")
  } catch {
    return false
  }
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
    let objectKey = typeof body.key === "string" ? body.key : ""
    if (!objectKey && typeof body.url === "string") {
      const base = R2_PUBLIC_BASE.replace(/\/$/, "") + "/"
      if (body.url.startsWith(base)) objectKey = body.url.slice(base.length)
    }
    // Only ever delete inside our own namespaces — never an arbitrary bucket path.
    if (!objectKey.startsWith("videos/") && !objectKey.startsWith("images/")) {
      return res.json({ error: "Invalid key." }, 400)
    }
    // Keys and public URLs are visible to other users, so knowing one isn't
    // enough: callers may delete their own uploads, and only a coach anyone
    // else's (e.g. removing an athlete's clip).
    const ownsObject = objectKey.startsWith(`videos/${userId}/`) || objectKey.startsWith(`images/${userId}/`)
    if (!ownsObject && !(await callerIsCoach(req))) {
      log(`Refused delete of ${objectKey} by ${userId}`)
      return res.json({ error: "Not allowed to delete this object." }, 403)
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
  const kind = body.kind === "image" ? "image" : "video"
  const EXT_TYPES = kind === "image" ? IMAGE_EXT_TYPES : VIDEO_EXT_TYPES
  const ext = (typeof body.ext === "string" ? body.ext : (kind === "image" ? "jpg" : "mp4")).toLowerCase().replace(/[^a-z0-9]/g, "")
  const contentType = EXT_TYPES[ext] || "application/octet-stream"

  // Namespace keys by kind + user so one athlete can't overwrite another's files.
  const key = `${kind === "image" ? "images" : "videos"}/${userId}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`

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
