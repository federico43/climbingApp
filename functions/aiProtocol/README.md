# AI Protocol Function

Appwrite Function that turns a coach's plain-language session description into a
structured training protocol (array of typed blocks), via the Anthropic Messages
API with forced tool use. Phase 1 of the AI integration.

It also carries an unrelated second job — **notifying the coach when an
athlete finishes a workout** — bolted on as another `action` rather than its
own function, because the Appwrite free tier caps you at 2 functions and this
one already has the user-lookup plumbing that needs (see `functions/videoPresign`
for the other slot).

## What it does

`POST` with body `{ "prompt": "45 min, silent-feet warmup then a hard project, 5 attempts..." }`
→ returns `{ "name": "...", "blocks": [ ... ] }` where each block is one of:
`project_bouldering`, `constraint_warmup`, `exploration_session`, `free_session`.

The model is **forced** to answer through the `propose_protocol` tool, so the
output is always valid structured JSON. The client validates/normalizes it before
dropping it into the protocol editor.

`POST` with body `{ "action": "notifyCoach", "protocolName": "Power endurance day" }`,
authenticated as the athlete who just finished a workout, sends every coach
account an Expo push notification. See "Coach push notifications" below.

## Deploy

1. **Create the function** in the Appwrite console (or CLI):
   - Runtime: **Node 18+**
   - Entrypoint: `src/main.js`
   - Build command: `npm install`
   - Root: this folder (`functions/aiProtocol`)
   - Execute access: **Users** (so authenticated coaches can call it)

2. **Set environment variables** on the function:

   | Variable | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | Your Anthropic API key (secret) |
   | `APPWRITE_API_KEY` | An Appwrite API key with **`databases.read`** scope (used only to verify the caller's coach role) |

   `APPWRITE_FUNCTION_API_ENDPOINT` and `APPWRITE_FUNCTION_PROJECT_ID` are injected
   automatically by Appwrite. `DATABASE_ID` / `USERS_TABLE` default to this app's
   values but can be overridden via env vars.

3. Deploy, then copy the **Function ID** into the app at
   `services/aiProtocol.ts` (`AI_PROTOCOL_FUNCTION_ID`).

## Coach push notifications

The `notifyCoach` action needs one more thing: a `pushToken` column (String,
optional) on the `users` table. The app writes to it after the athlete/coach
grants notification permission — see `registerForPushNotificationsAsync` /
`savePushToken` in `services/notifications.ts`. Called from
`contexts/WorkoutContext.tsx` the moment a workout finishes.

Behavior:
- Only a caller whose own `role` is `athlete` triggers anything — a coach
  logging their own session is a silent no-op.
- Every `users` row with `role == "coach"` and a non-empty `pushToken` gets
  pushed (this app assumes a small, flat coach roster, not per-athlete coach
  assignment).
- A coach with no saved `pushToken` is silently skipped, not an error.
- Delivery is best-effort via `https://exp.host/--/api/v2/push/send` — no
  retry, no delivery receipts checked. Fine for a "heads up" ping.
- Called with `async: true` (queued on Appwrite) — the client never waits on
  or depends on the result.

## Notes

- **Model**: defaults to `claude-opus-4-8` (`MODEL` in `src/main.js`). Switch to
  `claude-sonnet-4-6` to roughly halve cost.
- **Prompt caching**: the static knowledge pack is marked cacheable. It only
  actually caches once it exceeds the model's minimum cacheable prefix
  (~4096 tokens for Opus); below that it's a harmless no-op.
- **Auth**: the function reads the caller's `role` from the `users` table via the
  Databases REST endpoint. If your project exposes rows only through the newer
  `/tablesdb/...` path, change the URL in `isCoach()` accordingly.
- **Out of scope (later phases)**: `sequence` (needs a spray-wall route) and
  `strength_conditioning` (needs the exercise library) blocks; athlete pairing
  and assignment; history-based personalization.
