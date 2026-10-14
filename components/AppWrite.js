import { Client, TablesDB, Account, Storage, Functions } from "appwrite";

export const APPWRITE_ENDPOINT = "https://nyc.cloud.appwrite.io/v1";

const client = new Client();
client.setEndpoint(APPWRITE_ENDPOINT);
client.setProject("689e515d000c2e1af428"); // Replace with your project ID
//client.setPlatform("com.fede.workout");


export const account = new Account(client);
export const tablesDB = new TablesDB(client);
export const storage = new Storage(client);
export const functions = new Functions(client);
