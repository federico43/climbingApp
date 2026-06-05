# videoPresign — Cloudflare R2 upload URLs

Mints a short-lived **presigned PUT URL** so the app uploads a video **directly
to Cloudflare R2** (the bytes never pass through Appwrite — keeps you inside the
free tier). Returns the public playback URL the app stores in the `videos` table.

## 1. Cloudflare R2 setup

1. Cloudflare dashboard → **R2** → **Create bucket** (e.g. `climbing-videos`).
2. Bucket → **Settings** → **Public access**: enable the **r2.dev** subdomain
   (or connect a custom domain). Copy the public base URL, e.g.
   `https://pub-xxxxxxxx.r2.dev` — this is `R2_PUBLIC_BASE`.
3. R2 → **Manage R2 API Tokens** → **Create API token** (Object Read & Write).
   Copy the **Access Key ID**, **Secret Access Key**, and your **Account ID**.

## 2. Appwrite Function

1. Functions → **Create function** → Node 18+ runtime, name `videoPresign`.
   (This is your 2nd function — the other slot is `aiProtocol`.)
2. Deploy this folder (`functions/videoPresign`). Build installs the AWS SDK.
3. Set the execution scope so signed-in users can call it (Users, not just Coaches).
4. **Variables** (Settings → Variables):
   - `R2_ACCOUNT_ID`
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
   - `R2_BUCKET`         (e.g. `climbing-videos`)
   - `R2_PUBLIC_BASE`    (e.g. `https://pub-xxxxxxxx.r2.dev`)
5. Copy the **Function ID** into `services/videoStorage.ts` →
   `VIDEO_PRESIGN_FUNCTION_ID`.

## 3. CORS on the R2 bucket

The app PUTs directly to R2 from the device, so allow it. R2 bucket → **Settings
→ CORS policy**:

```json
[
  { "AllowedOrigins": ["*"], "AllowedMethods": ["PUT"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 3600 }
]
```

## 4. Appwrite `videos` table

Database (`68bd9dd7003c15f7147e`) → **Create table** `videos` with columns:

| key         | type    | required |
|-------------|---------|----------|
| userId      | String  | yes      |
| url         | String  | yes      |
| key         | String  | yes      |
| blockType   | String  | no       |
| projectId   | String  | no       |
| projectName | String  | no       |
| grade       | String  | no       |
| durationSec | Integer | no       |

Permissions: same as `sessions` (so a coach can query an athlete's clips by
`userId`).

## Request / response

Request body: `{ "ext": "mp4" }`
Response: `{ uploadUrl, publicUrl, key, contentType }`
