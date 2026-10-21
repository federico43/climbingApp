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
 * surfaced to the athlete/coach.
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
  }
}

/**
 * Tells the backend an athlete just finished a workout so it can push the
 * coach(es). Rides the existing aiProtocol function (Appwrite's free tier
 * caps functions at 2, and that slot already has the user-lookup plumbing
 * this needs — see its `notifyCoach` action in functions/aiProtocol/src/main.js).
 * Queued on Appwrite (`async: true`), so it returns as soon as Appwrite has
 * it. Rejects when that fails (e.g. offline) — callers go through
 * services/sessionSyncQueue.ts, which retries once the connection is back.
 */
export async function sendWorkoutCompletedNotification(protocolName: string): Promise<void> {
  await functions.createExecution({
    functionId: AI_PROTOCOL_FUNCTION_ID,
    body: JSON.stringify({ action: "notifyCoach", protocolName }),
    async: true,
    method: ExecutionMethod.POST,
  })
}
