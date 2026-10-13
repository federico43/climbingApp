import { C } from "@/utils/theme"
import { useUpdateHeld } from "@/utils/updateHold"
import Constants from "expo-constants"
import * as Updates from "expo-updates"
import { useUpdates } from "expo-updates"
import { useCallback, useEffect, useState } from "react"
import { ActivityIndicator, AppState, AppStateStatus, StyleSheet, Text, View } from "react-native"

// While open, how often to look for a new update.
const CHECK_INTERVAL_MS = 10 * 60 * 1000
// How long the "Updating…" banner shows before the reload, so the restart
// doesn't look like a crash.
const RESTART_NOTICE_MS = 1500

// Checks for EAS updates on launch, on returning to the foreground, and
// every few minutes while the app is open, downloading them in the
// background. A downloaded update is applied right away — including while
// the person is using the app — unless something holds updates (a running
// workout, a recording, an unsaved editor; see utils/updateHold.ts), in
// which case it's applied the moment that finishes. No-ops in dev / Expo Go
// (Updates.isEnabled === false).
export function UpdateBanner() {
  const { isUpdatePending } = useUpdates()
  const held = useUpdateHeld()
  const [restarting, setRestarting] = useState(false)
  const [appActive, setAppActive] = useState(AppState.currentState === "active")

  const check = useCallback(async () => {
    if (!Updates.isEnabled) return
    try {
      const res = await Updates.checkForUpdateAsync()
      if (res.isAvailable) await Updates.fetchUpdateAsync()
    } catch {
      /* offline / no update — ignore */
    }
  }, [])

  const restart = useCallback(async () => {
    try {
      await Updates.reloadAsync()
    } catch {
      setRestarting(false)
    }
  }, [])

  // Launch + foreground checks.
  useEffect(() => {
    check()
    const sub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      setAppActive(nextState === "active")
      if (nextState === "active") check()
    })
    return () => sub.remove()
  }, [check])

  // Periodic checks while the app stays open.
  useEffect(() => {
    if (!appActive) return
    const id = setInterval(check, CHECK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [appActive, check])

  // Apply as soon as an update is downloaded, the app is in front, and
  // nothing is holding updates. If a hold starts (or the app leaves the
  // foreground) during the notice, the restart is called off until later.
  useEffect(() => {
    if (!isUpdatePending || held || !appActive) return
    setRestarting(true)
    const id = setTimeout(restart, RESTART_NOTICE_MS)
    return () => { clearTimeout(id); setRestarting(false) }
  }, [isUpdatePending, held, appActive, restart])

  if (!restarting) return null

  return (
    <View style={[styles.wrap, { top: Constants.statusBarHeight + 8 }]} pointerEvents="none">
      <View style={styles.banner}>
        <ActivityIndicator color={C.bg} />
        <Text style={styles.title}>Updating…</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 12, right: 12, zIndex: 2000, alignItems: "center" },
  banner: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: C.green, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 10,
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  title: { fontSize: 14, fontWeight: "800", color: C.bg },
})
