import { functions } from "@/components/AppWrite"
import { AI_PROTOCOL_FUNCTION_ID } from "@/services/aiProtocol"
import { USERS_TABLE, listAllRows } from "@/services/BoulderGraphService"
import type { BlockedTime, ClassRequestRow, GymClass } from "@/utils/classSchedule"
import type { PlanPause } from "@/utils/planPauses"
import { ExecutionMethod, Query } from "appwrite"

// Weekly classes on the server: tables read straight from Appwrite, every
// write through the climbingApp function (functions/aiProtocol/src/classes.js),
// which checks the rules and sends the pushes.

const CLASSES_TABLE = "classes"
const WEEKS_TABLE = "class_weeks"
const REQUESTS_TABLE = "class_requests"
const PACKAGES_TABLE = "packages"

export interface ClassWeek { weekStart: string; classes: GymClass[]; published: boolean; blocks: BlockedTime[] }
export interface ClassUser { id: string; name: string; role: string | null; defaultClasses: string[] }
export interface ClassPackage { $id: string; $createdAt?: string; athleteId: string; total: number; startsOn: string; useBy: string }

const toClass = (r: any): GymClass => ({ id: r.$id, day: r.day, start: r.start, roster: r.roster ?? [] })

export async function loadWeek(weekStart: string): Promise<ClassWeek> {
  const [rows, week] = await Promise.all([
    listAllRows<any>(CLASSES_TABLE, [Query.equal("weekStart", weekStart)]),
    listAllRows<any>(WEEKS_TABLE, [Query.equal("$id", weekStart)]),
  ])
  let blocks: BlockedTime[] = []
  try { blocks = JSON.parse(week[0]?.blocks || "[]") } catch {}
  return { weekStart, classes: rows.map(toClass), published: !!week[0]?.published, blocks }
}

// Requests for these weeks: all of them for a coach, only their own for an athlete.
export async function loadRequests(weekStarts: string[], athleteId?: string): Promise<ClassRequestRow[]> {
  const q = [Query.equal("weekStart", weekStarts)]
  if (athleteId) q.push(Query.equal("athleteId", athleteId))
  return listAllRows<ClassRequestRow>(REQUESTS_TABLE, q)
}

export async function loadUsers(): Promise<ClassUser[]> {
  const rows = await listAllRows<any>(USERS_TABLE)
  return rows.map((u) => ({ id: u.$id, name: u.username || "athlete", role: u.role ?? null, defaultClasses: u.defaultClasses ?? [] }))
}

export async function loadPackages(athleteId?: string): Promise<ClassPackage[]> {
  return listAllRows<ClassPackage>(PACKAGES_TABLE, athleteId ? [Query.equal("athleteId", athleteId)] : [])
}

// The athlete's classes and skips since `weekStart`, to count sessions used.
export async function loadHistory(athleteId: string, weekStart: string): Promise<{ classes: (GymClass & { weekStart: string })[]; requests: (ClassRequestRow & { $createdAt?: string })[] }> {
  const [classes, requests] = await Promise.all([
    listAllRows<any>(CLASSES_TABLE, [Query.contains("roster", athleteId), Query.greaterThanEqual("weekStart", weekStart)]),
    listAllRows<ClassRequestRow & { $createdAt?: string }>(REQUESTS_TABLE, [Query.equal("athleteId", athleteId), Query.greaterThanEqual("weekStart", weekStart)]),
  ])
  return { classes: classes.map((r) => ({ ...toClass(r), weekStart: r.weekStart })), requests }
}

async function call(action: string, body: Record<string, any>): Promise<any> {
  const execution = await functions.createExecution({
    functionId: AI_PROTOCOL_FUNCTION_ID,
    body: JSON.stringify({ action, ...body }),
    async: false,
    method: ExecutionMethod.POST,
  })
  let payload: any = {}
  try { payload = execution.responseBody ? JSON.parse(execution.responseBody) : {} } catch {}
  if (execution.responseStatusCode < 200 || execution.responseStatusCode >= 300) {
    throw new Error(payload?.error ?? "Couldn't reach the server.")
  }
  return payload
}

export type RequestBody =
  | { kind: "skip"; classId: string }
  | { kind: "move"; classId: string; toClassId: string }
  | { kind: "propose"; classId: string; day: number; start: number }
  | { kind: "extra"; toClassId: string }

export const sendRequest = (body: RequestBody) => call("classRequest", body)
export const cancelRequest = (requestId: string) => call("classCancel", { requestId })
export const answerRequest = (requestId: string, accept: boolean) => call("classAnswer", { requestId, accept })
export const saveDefaults = (slots: string[]) => call("classDefaults", { slots })
export const publishWeek = (weekStart: string, classes: { id?: string; day: number; start: number }[], blocks: BlockedTime[]) =>
  call("classPublish", { weekStart, classes, blocks })
export const addPackage = (athleteId: string, total: number, startsOn: string, useBy: string) =>
  call("classPackage", { athleteId, total, startsOn, useBy })
// The plan's whole list of pauses (utils/planPauses.ts); the server moves the
// plan's end date and the package's use-by date, and the athlete's classes.
export const savePlanPauses = (planId: string, pauses: PlanPause[]) => call("classPause", { planId, pauses })
