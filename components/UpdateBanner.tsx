import { C } from "@/utils/theme"
import { Ionicons } from "@expo/vector-icons"
import Constants from "expo-constants"
import * as Updates from "expo-updates"
import { useUpdates } from "expo-updates"
import { useCallback, useEffect, useState } from "react"
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native"
import { AppState } from "react-native"

// Floating banner that appears when an EAS update has been downloaded and is
// ready to apply. Checks for updates on launch and whenever the app returns to
// the foreground, downloads them in the background, then prompts the user to
// restart. No-ops in dev / Expo Go (Updates.isEnabled === false).
export function UpdateBanner() {
  const { isUpdatePending } = useUpdates()
  const [dismissed, setDismissed] = useState(false)
  const [restarting, setRestarting] = useState(false)

  const check = useCallback(async () => {
    if (!Updates.isEnabled) return
    try {
      const res = await Updates.checkForUpdateAsync()
      if (res.isAvailable) await Updates.fetchUpdateAsync()
    } catch {
      /* offline / no update — ignore */
    }
  }, [])

  // Check on launch, then every time the app becomes active again.
  useEffect(() => {
    check()
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") check()
    })
    return () => sub.remove()
  }, [check])

  // A freshly downloaded update re-shows the banner even if a previous one was
  // dismissed.
  useEffect(() => {
    if (isUpdatePending) setDismissed(false)
  }, [isUpdatePending])

  async function restart() {
    setRestarting(true)
    try {
      await Updates.reloadAsync()
    } catch {
      setRestarting(false)
    }
  }

  if (!isUpdatePending || dismissed) return null

  return (
    <View style={[styles.wrap, { top: Constants.statusBarHeight + 8 }]} pointerEvents="box-none">
      <Pressable style={styles.banner} onPress={restart} disabled={restarting}>
        <Ionicons name="arrow-down-circle" size={22} color={C.bg} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Update ready</Text>
          <Text style={styles.sub}>{restarting ? "Restarting…" : "Tap to restart and apply"}</Text>
        </View>
        {restarting ? (
          <ActivityIndicator color={C.bg} />
        ) : (
          <Pressable onPress={() => setDismissed(true)} hitSlop={10}>
            <Ionicons name="close" size={20} color={C.bg} />
          </Pressable>
        )}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 12, right: 12, zIndex: 2000 },
  banner: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: C.green, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12,
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  title: { fontSize: 15, fontWeight: "800", color: C.bg },
  sub: { fontSize: 12, fontWeight: "600", color: C.bg, opacity: 0.8, marginTop: 1 },
})
