import { C } from "@/utils/theme"
import Constants from "expo-constants"
import * as Updates from "expo-updates"
import { useUpdates } from "expo-updates"
import { useState } from "react"
import { Pressable, StyleSheet, Text } from "react-native"

// "Version x.y.z · <status>" footer. The status reflects the EAS update state;
// when an update is ready it's tappable to restart and apply.
export function VersionFooter() {
  const { isChecking, isDownloading, isUpdatePending, isUpdateAvailable } = useUpdates()
  const [restarting, setRestarting] = useState(false)
  const version = Constants.expoConfig?.version ?? "—"

  let status = "up to date"
  const ready = isUpdatePending
  if (restarting) status = "restarting…"
  else if (isUpdatePending) status = "update ready · tap to restart"
  else if (isDownloading) status = "downloading update…"
  else if (isChecking) status = "checking for updates…"
  else if (isUpdateAvailable) status = "update available"

  async function onPress() {
    if (!ready) return
    setRestarting(true)
    try { await Updates.reloadAsync() } catch { setRestarting(false) }
  }

  return (
    <Pressable onPress={onPress} disabled={!ready}>
      <Text style={[styles.text, ready && styles.textReady]}>
        Version {version} · {status}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  text: { textAlign: "center", fontSize: 12, color: C.textMuted, marginTop: 4 },
  textReady: { color: C.green, fontWeight: "700" },
})
