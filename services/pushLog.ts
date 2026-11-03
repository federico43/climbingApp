import { functions } from "@/components/AppWrite"
import { AI_PROTOCOL_FUNCTION_ID } from "@/services/aiProtocol"
import { ExecutionMethod } from "appwrite"

// Settings › Notifications sent (coach only): every push the climbingApp
// function sent, read through its pushLog action (functions/aiProtocol/src/pushLog.js).

export type PushStatus = "sent" | "failed" | "no_token"

export interface PushLogEntry {
  id: string
  at: string
  userId: string
  userName: string | null
  type: string | null
  title: string | null
  body: string | null
  // sent = Expo accepted it (Apple/Google may still drop it later);
  // failed = see `error`; no_token = the person has no device registered.
  status: PushStatus
  error: string | null
  // what sent it: an action ("notifyCoach", "classPublish", …) or "classCron"
  source: string | null
}

export async function loadPushLog(opts: { userId?: string; problemsOnly?: boolean } = {}): Promise<PushLogEntry[]> {
  const execution = await functions.createExecution({
    functionId: AI_PROTOCOL_FUNCTION_ID,
    body: JSON.stringify({ action: "pushLog", ...opts }),
    async: false,
    method: ExecutionMethod.POST,
  })
  let payload: any = {}
  try { payload = execution.responseBody ? JSON.parse(execution.responseBody) : {} } catch {}
  if (execution.responseStatusCode < 200 || execution.responseStatusCode >= 300) {
    throw new Error(payload?.error ?? "Couldn't reach the server.")
  }
  return Array.isArray(payload.entries) ? payload.entries : []
}
