// Expo push with guardrails. Expo answers HTTP 200 even when a message
// failed: the real outcome is a per-message "ticket" in the response, and a
// later "receipt" once Apple/Google have answered. A token that's expired or
// uninstalled shows up as `DeviceNotRegistered` in either one, so both are
// checked here and those tokens are handed back for the caller to clear.
// No Appwrite code in here, so it can be tested with a fake fetch
// (scripts/progression-tests/expoPush.test.ts).

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
export const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts"

// Expo's limits: 100 messages per send, 1000 ids per receipts lookup.
const SEND_CHUNK = 100
const RECEIPT_CHUNK = 1000

const TOKEN_RE = /^Expo(nent)?PushToken\[[^\]]+\]$/

export const isExpoPushToken = (t) => typeof t === "string" && TOKEN_RE.test(t)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chunk = (list, n) => {
  const out = []
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n))
  return out
}

// POST JSON with one retry on a network error, 429 or 5xx (Expo's advice is
// to back off and retry those). Returns { status, json } or { status: 0 }.
async function postJson(url, payload, { fetchImpl, retryDelayMs }) {
  for (let attempt = 0; ; attempt++) {
    let status = 0
    let json = null
    let text = ""
    try {
      const r = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      })
      status = r.status
      text = await r.text().catch(() => "")
      try { json = JSON.parse(text) } catch { json = null }
    } catch (e) {
      text = e?.message ?? String(e)
    }
    const retryable = status === 0 || status === 429 || status >= 500
    if (!retryable || attempt >= 1) return { status, json, text }
    await sleep(retryDelayMs)
  }
}

/**
 * Sends Expo push messages and reads back what really happened.
 *
 * options:
 *   log, error       Appwrite's loggers (optional).
 *   receiptWaitMs    > 0 → wait that long, then look up receipts once. Only
 *                    worth it when nobody is waiting on the response (async
 *                    executions); receipts not ready by then are skipped.
 *   fetchImpl        for tests; defaults to global fetch.
 *   retryDelayMs     wait before the single retry (default 1000).
 *
 * Returns { sent, failed, invalidTokens }: `sent` counts tickets Expo
 * accepted, `failed` everything else (bad tokens, ticket or receipt errors,
 * request failures), `invalidTokens` the tokens that will never work again
 * (malformed or DeviceNotRegistered). Never throws.
 */
export async function sendExpoPush(messages, options = {}) {
  const { log, error, receiptWaitMs = 0, retryDelayMs = 1000 } = options
  const fetchImpl = options.fetchImpl ?? fetch
  const result = { sent: 0, failed: 0, invalidTokens: [] }
  const dead = new Set()

  // A malformed token makes Expo reject the whole request, so it never goes
  // out. The same token twice (one device on two accounts) is sent once.
  const seen = new Set()
  const valid = []
  for (const m of messages) {
    if (!m || typeof m.to !== "string" || !m.to) continue
    if (!isExpoPushToken(m.to)) {
      error?.(`Expo push: skipped malformed token ${m.to.slice(0, 40)}`)
      dead.add(m.to)
      result.failed++
      continue
    }
    if (seen.has(m.to)) continue
    seen.add(m.to)
    valid.push(m)
  }

  const receiptTokens = new Map() // ticket id → token

  const handleTickets = (batch, tickets) => {
    batch.forEach((m, i) => {
      const t = tickets[i]
      if (t?.status === "ok") {
        result.sent++
        if (typeof t.id === "string") receiptTokens.set(t.id, m.to)
        return
      }
      result.failed++
      const code = t?.details?.error
      error?.(`Expo push ticket error for ${m.to}: ${code ?? "unknown"} ${t?.message ?? ""}`.trim())
      if (code === "DeviceNotRegistered") dead.add(m.to)
    })
  }

  for (const batch of chunk(valid, SEND_CHUNK)) {
    const r = await postJson(EXPO_PUSH_URL, batch, { fetchImpl, retryDelayMs })
    const tickets = Array.isArray(r.json?.data) ? r.json.data : null
    if (r.status >= 200 && r.status < 300 && tickets) {
      handleTickets(batch, tickets)
      continue
    }
    // A 4xx on a batch can come from one bad message (e.g. tokens from two
    // Expo projects mixed together). Send the rest one by one instead of
    // losing them all.
    if (r.status >= 400 && r.status < 500 && r.status !== 429 && batch.length > 1) {
      error?.(`Expo push batch rejected (${r.status} ${r.text.slice(0, 300)}), retrying one by one`)
      for (const m of batch) {
        const one = await postJson(EXPO_PUSH_URL, [m], { fetchImpl, retryDelayMs })
        const t = Array.isArray(one.json?.data) ? one.json.data : null
        if (one.status >= 200 && one.status < 300 && t) handleTickets([m], t)
        else {
          result.failed++
          error?.(`Expo push send failed for ${m.to}: ${one.status} ${one.text.slice(0, 300)}`)
        }
      }
      continue
    }
    result.failed += batch.length
    error?.(`Expo push send failed: ${r.status} ${r.text.slice(0, 300)}`)
  }

  if (receiptWaitMs > 0 && receiptTokens.size > 0) {
    await sleep(receiptWaitMs)
    for (const ids of chunk([...receiptTokens.keys()], RECEIPT_CHUNK)) {
      const r = await postJson(EXPO_RECEIPTS_URL, { ids }, { fetchImpl, retryDelayMs })
      const receipts = r.json?.data
      if (!(r.status >= 200 && r.status < 300) || !receipts || typeof receipts !== "object") {
        error?.(`Expo receipts lookup failed: ${r.status} ${r.text.slice(0, 300)}`)
        continue
      }
      for (const [id, rec] of Object.entries(receipts)) {
        if (rec?.status !== "error") continue
        const token = receiptTokens.get(id)
        const code = rec?.details?.error
        result.sent--
        result.failed++
        error?.(`Expo push receipt error for ${token}: ${code ?? "unknown"} ${rec?.message ?? ""}`.trim())
        if (code === "DeviceNotRegistered" && token) dead.add(token)
      }
    }
  }

  result.invalidTokens = [...dead]
  if (result.sent > 0 || result.failed > 0) {
    log?.(`Expo push: ${result.sent} sent, ${result.failed} failed${dead.size ? `, ${dead.size} token(s) to clear` : ""}`)
  }
  return result
}
