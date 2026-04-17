//Does everything related to the dataBase. 

import { tablesDB, account } from "@/components/AppWrite"
import { ID,Query } from "appwrite"
export const DATABASE_ID = "68bd9dd7003c15f7147e"
export const BOULDER_TABLE = "boulders_realizados"
export const LEVEL_TABLE = "niveles_boulder"
export const USERS_TABLE = "users"
export const SESSION_TABLE = "workoutsession"

export async function getBoulderLogs() {
  const userID = await account.get()

  let allRows: any[] = []
  let offset = 0
  const limit = 100

  while (true) {
    const result = await tablesDB.listRows({
      databaseId: DATABASE_ID,
      tableId: BOULDER_TABLE,
      queries: [
        Query.equal('userID', userID.$id),
        Query.limit(limit),
        Query.offset(offset)
      ]
    })

    allRows = [...allRows, ...result.rows]

    if (result.rows.length < limit) break

    offset += limit
  }

  

  return allRows
}

export async function getBoulderLevels() {
  const result = await tablesDB.listRows({
    databaseId: DATABASE_ID,
    tableId: LEVEL_TABLE,
  })
  
  return result.rows
  //returns an array. each item on the arrya is a dictionary (a row)
}

export async function logRecord(table_id:string, data: any, rowID?: string) {
  if (!rowID){
    rowID = ID.unique()
  }
  try {
    const response = await tablesDB.createRow({
      databaseId: DATABASE_ID,
      tableId: table_id,
      rowId: rowID,
      data: data
    });

    return response;

  } catch (error) {
    console.log(error);
    throw error; // ← VERY IMPORTANT
  }
}

export async function useDeleteRow(table_id:string, rowID?: string) {
  if (!rowID){
    rowID = ID.unique()
  }
  try {
    const response = await tablesDB.deleteRow({
      databaseId: DATABASE_ID,
      tableId: table_id,
      rowId: rowID
    });

    return response;

  } catch (error) {
    console.log(error);
    throw error; // ← VERY IMPORTANT
  }
}


export async function getUsers(ID: string) {
  try{
    const result = await tablesDB.listRows({
      databaseId: DATABASE_ID,
      tableId: USERS_TABLE,
      queries: [
          Query.equal('$id', ID)
      ]
    })
    return result.rows[0]
    //returns an array. each item on the arrya is a dictionary (a row)
  }
  catch(error){
    console.log(error)
  }
}


export async function saveSession(data: any) {
  try {
    const user = await account.get()

    const rowID = ID.unique()

    const response = await tablesDB.createRow({
      databaseId: DATABASE_ID,
      tableId: SESSION_TABLE,
      rowId: rowID,
      data: {
        ...data,
        userId: user.$id, // ✅ correct
      },
    })

    return response
  } catch (error) {
    console.error("Failed to save session", error)
  }
}