import { functions, tablesDB } from "@/components/AppWrite"
import { AI_PROTOCOL_FUNCTION_ID } from "@/services/aiProtocol"
import { DATABASE_ID, USERS_TABLE } from "@/services/BoulderGraphService"
import { ExecutionMethod } from "appwrite"
import Constants from "expo-constants"
import * as Device from "expo-device"
import * as Notifications from "expo-notifications"
import { Platform } from "react-native"

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

/**
 * Requests notification permission and returns this device's Expo push
 * token, or null if permission was denied or this isn't a physical device
 * (simulators/emulators can't receive pushes). Best-effort — never throws.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  try {
    if (!Device.isDevice) return null

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.DEFAULT,
      })
    }

    const existing = await Notifications.getPermissionsAsync()
    let status = existing.status
    if (status !== "granted") {
      const requested = await Notifications.requestPermissionsAsync()
      status = requested.status
    }
    if (status !== "granted") return null

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    )
    return tokenResponse.data
  } catch (e) {
    console.log("Push registration failed", e)
    return null
  }
}

/**
 * Saves this device's push token on the signed-in user's row. Best-effort —
 * the `pushToken` column may not exist in Appwrite yet (add it manually, see
 * functions/notifyCoach/README.md), so failures are swallowed rather than
 * surfaced to the athlete/coach. Then asks the backend to drop the same token
 * from any other account's row (someone else used this phone before and
 * couldn't sign out cleanly, e.g. offline), so their pushes stop landing here.
 */
export async function savePushToken(userId: string, token: string): Promise<void> {
  try {
    await tablesDB.updateRow({
      databaseId: DATABASE_ID,
      tableId: USERS_TABLE,
      rowId: userId,
      data: { pushToken: token },
    })
  } catch (e) {
    console.log("Could not save push token (does `users` have a `pushToken` column?)", e)
    return
  }
  functions
    .createExecution({
      functionId: AI_PROTOCOL_FUNCTION_ID,
      body: JSON.stringify({ action: "claimPushToken" }),
      async: true,
      method: ExecutionMethod.POST,
    })
    .catch((e) => console.log("claimPushToken failed", e))
}

/**
 * On sign-out: removes this device's token from the user's row, so whoever
 * signs in next on this phone doesn't get the previous user's pushes. Only
 * clears it if the row still holds this device's token — the user may have
 * moved to another phone since. Must run while the session still exists.
 * Best-effort, never throws; if it fails (offline), the next account to sign
 * in here takes the token over via claimPushToken.
 */
export async function clearPushToken(userId: string): Promise<void> {
  // Getting the token talks to Expo; never hold sign-out up for long.
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 4000))
  await Promise.race([clearPushTokenNow(userId), timeout])
}

async function clearPushTokenNow(userId: string): Promise<void> {
  try {
    if (!Device.isDevice) return
    const { status } = await Notifications.getPermissionsAsync()
    if (status !== "granted") return
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    )
    const row = await tablesDB.getRow({ databaseId: DATABASE_ID, tableId: USERS_TABLE, rowId: userId })
    if ((row as { pushToken?: string | null }).pushToken !== token) return
    await tablesDB.updateRow({
      databaseId: DATABASE_ID,
      tableId: USERS_TABLE,
      rowId: userId,
      data: { pushToken: null },
    })
  } catch (e) {
    console.log("Could not clear push token on sign-out", e)
  }
}

/**
 * Tells the backend an athlete just finished a workout so it can push the
 * coach(es). Rides the existing aiProtocol function (Appwrite's free tier
 * caps functions at 2, and that slot already has the user-lookup plumbing
 * this needs — see its `notifyCoach` action in functions/aiProtocol/src/main.js).
 * Fire-and-forget — queued on Appwrite (`async: true`), so this never blocks
 * or can fail the athlete's flow.
 */
export function notifyCoachOfWorkoutCompletion(protocolName: string): void {
  functions
    .createExecution({
      functionId: AI_PROTOCOL_FUNCTION_ID,
      body: JSON.stringify({ action: "notifyCoach", protocolName }),
      async: true,
      method: ExecutionMethod.POST,
    })
    .catch((e) => console.log("Coach notification failed", e))
}
