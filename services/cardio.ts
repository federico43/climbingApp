import { tablesDB } from "@/components/AppWrite"
import { ID, Query } from "appwrite"
import { DATABASE_ID, listAllRows, SESSION_TABLE, USERS_TABLE } from "@/services/BoulderGraphService"
import { parseCardioPlan, type CardioPlan } from "@/utils/cardio"

// Jump rope cardio data (docs/cardio-rope.md): the plan lives as JSON on the
// athlete's users row (users.cardioPlan) next to the coach's switch
// (users.cardioEnabled); every session is a row of cardio_sessions.
// Columns and table: scripts/cardio/create-tables.mjs.

export const CARDIO_SESSIONS_TABLE = "cardio_sessions"

export interface CardioSessionRow {
  $id: string
  $createdAt: string
  userId: string
  date: string
  kind: "test" | "session" | "deload"
  step: number | null
  cycle: number | null
  protocol: string | null
  answers: string | null
  outcome: string | null
  rule: number | null
  nextStep: number | null
  nextCycle: number | null
  climbedHard: boolean | null
}

export interface CardioUserFields {
  cardioEnabled?: boolean | null
  cardioPlan?: string | null
}

export function cardioPlanOf(user: CardioUserFields | null | undefined): CardioPlan | null {
  return parseCardioPlan(user?.cardioPlan)
}

export async function getCardioUser(userId: string): Promise<{ enabled: boolean; plan: CardioPlan | null }> {
  const row = await tablesDB.getRow({ databaseId: DATABASE_ID, tableId: USERS_TABLE, rowId: userId }) as unknown as CardioUserFields
  return { enabled: row.cardioEnabled === true, plan: cardioPlanOf(row) }
}

export async function saveCardioPlan(userId: string, plan: CardioPlan | null) {
  return tablesDB.updateRow({
    databaseId: DATABASE_ID, tableId: USERS_TABLE, rowId: userId,
    data: { cardioPlan: plan ? JSON.stringify(plan) : null },
  })
}

/** The coach's switch. */
export async function setCardioEnabled(userId: string, cardioEnabled: boolean) {
  return tablesDB.updateRow({ databaseId: DATABASE_ID, tableId: USERS_TABLE, rowId: userId, data: { cardioEnabled } })
}

export async function listCardioSessions(userId: string): Promise<CardioSessionRow[]> {
  return listAllRows<CardioSessionRow>(CARDIO_SESSIONS_TABLE, [Query.equal("userId", userId), Query.orderDesc("date")])
}

export type CardioSessionInput = Omit<CardioSessionRow, "$id" | "$createdAt">

export async function saveCardioSession(data: CardioSessionInput): Promise<CardioSessionRow> {
  return tablesDB.createRow({
    databaseId: DATABASE_ID, tableId: CARDIO_SESSIONS_TABLE, rowId: ID.unique(), data,
  }) as unknown as Promise<CardioSessionRow>
}

/** Did the athlete log a climbing workout today (local day)? Then cardio drops a step. */
export async function hasWorkoutToday(userId: string): Promise<boolean> {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  try {
    const res = await tablesDB.listRows({
      databaseId: DATABASE_ID, tableId: SESSION_TABLE,
      queries: [Query.equal("userId", userId), Query.greaterThanEqual("$createdAt", start.toISOString()), Query.limit(1)],
    })
    return res.rows.length > 0
  } catch {
    return false
  }
}

/**
 * The coach deletes the athlete's cardio plan: switch off, plan cleared and
 * its sessions removed, so turning it on again starts from the intro and the
 * starting test.
 */
export async function deleteCardioPlan(userId: string): Promise<void> {
  await tablesDB.updateRow({
    databaseId: DATABASE_ID, tableId: USERS_TABLE, rowId: userId,
    data: { cardioEnabled: false, cardioPlan: null },
  })
  const rows = await listCardioSessions(userId).catch(() => [])
  await Promise.all(rows.map((r) => tablesDB.deleteRow({ databaseId: DATABASE_ID, tableId: CARDIO_SESSIONS_TABLE, rowId: r.$id })))
}
