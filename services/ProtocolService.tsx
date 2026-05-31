import { tablesDB } from "@/components/AppWrite"
import { ID, Query } from "appwrite"

// ─── Constants ────────────────────────────────────────────────────────────────

const DATABASE_ID = "68bd9dd7003c15f7147e"
const TABLE_ID = "protocol" // fill in later

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProtocolRow {
  $id: string
  $createdAt: string  // 👈 $ prefix
  name: string
  blocks: string
}

export interface ProtocolInput {
  name: string
  blocks: any[]
}

// ─── Service ──────────────────────────────────────────────────────────────────

export async function listProtocols(): Promise<ProtocolRow[]> {
  const response = await tablesDB.listRows({
    databaseId: DATABASE_ID,
    tableId: TABLE_ID,
    queries: [Query.orderDesc("$createdAt")],  // 👈 $ prefix
  })
  return response.rows as unknown as ProtocolRow[]
}


export async function getProtocol(id: string): Promise<ProtocolRow> {
  const response = await tablesDB.getRow({
    databaseId: DATABASE_ID,
    tableId: TABLE_ID,
    rowId: id,
  })
  return response as unknown as ProtocolRow
}

export async function createProtocol(input: ProtocolInput): Promise<ProtocolRow> {
  const response = await tablesDB.createRow({
    databaseId: DATABASE_ID,
    tableId: TABLE_ID,
    rowId: ID.unique(),
    data: {
      name: input.name,
      blocks: JSON.stringify(input.blocks),
      // ❌ remove createdAt — Appwrite sets $createdAt automatically
    },
  })
  return response as unknown as ProtocolRow
}

export async function updateProtocol(
  id: string,
  input: ProtocolInput
): Promise<ProtocolRow> {
  const response = await tablesDB.updateRow({
    databaseId: DATABASE_ID,
    tableId: TABLE_ID,
    rowId: id,
    data: {
      name: input.name,
      blocks: JSON.stringify(input.blocks),
    },
  })
  return response as unknown as ProtocolRow
}

export async function deleteProtocol(id: string): Promise<void> {
  await tablesDB.deleteRow({
    databaseId: DATABASE_ID,
    tableId: TABLE_ID,
    rowId: id,
  })
}