import { Client, TablesDB, Account, Storage, Functions } from "appwrite";
import { forgetTable, freshReads } from "../utils/readCache";

export const APPWRITE_ENDPOINT = "https://nyc.cloud.appwrite.io/v1";

const client = new Client();
client.setEndpoint(APPWRITE_ENDPOINT);
client.setProject("689e515d000c2e1af428"); // Replace with your project ID
//client.setPlatform("com.fede.workout");


export const account = new Account(client);
export const tablesDB = new TablesDB(client);
export const storage = new Storage(client);
export const functions = new Functions(client);

// The read cache (utils/readCache.ts) forgets a table on any write to it,
// before and after (so a read that started mid-write isn't kept either)…
for (const method of ["createRow", "updateRow", "deleteRow", "upsertRow"]) {
  const original = tablesDB[method]?.bind(tablesDB);
  if (!original) continue;
  tablesDB[method] = (params, ...rest) => {
    const table = params?.tableId;
    if (table) forgetTable(table);
    return original(params, ...rest).finally(() => { if (table) forgetTable(table); });
  };
}
// …and everything after a function call, which may write any table.
{
  const original = functions.createExecution.bind(functions);
  functions.createExecution = (...args) => original(...args).finally(freshReads);
}
