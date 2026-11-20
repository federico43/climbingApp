import { Client, TablesDB, Account, Storage, Functions } from "appwrite";
import { freshReads, tableChanged } from "../utils/readCache";

export const APPWRITE_ENDPOINT = "https://nyc.cloud.appwrite.io/v1";

const client = new Client();
client.setEndpoint(APPWRITE_ENDPOINT);
client.setProject("689e515d000c2e1af428"); // Replace with your project ID
//client.setPlatform("com.fede.workout");


export const account = new Account(client);
export const tablesDB = new TablesDB(client);
export const storage = new Storage(client);
export const functions = new Functions(client);

// The read cache (utils/readCache.ts) checks a table's lists again after any
// write to it, marked before and after (so a read that started mid-write
// isn't trusted either)…
for (const method of ["createRow", "updateRow", "deleteRow", "upsertRow", "incrementRowColumn", "decrementRowColumn"]) {
  const original = tablesDB[method]?.bind(tablesDB);
  if (!original) continue;
  tablesDB[method] = (params, ...rest) => {
    // { databaseId, tableId, … }, or the older (databaseId, tableId, …)
    const table = typeof params === "string" ? rest[0] : params?.tableId;
    if (table) tableChanged(table);
    return original(params, ...rest).finally(() => { if (table) tableChanged(table); });
  };
}
// …and after a function call, which may write any table, every list checks
// with Appwrite (one row) before it's used again.
{
  const original = functions.createExecution.bind(functions);
  functions.createExecution = (...args) => original(...args).finally(freshReads);
}
