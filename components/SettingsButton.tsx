import { paperSheet, useC, useSheet } from "@/theme/paper/legacy"
import { IconButton } from "@/components/paper"
import { Ionicons } from "@expo/vector-icons"
import { useRouter } from "expo-router"
import { Pressable, StyleSheet } from "react-native"

// Gear in the top-right of the main tabs — Settings is no longer a tab.
// `paper`: the Paper Mint outlined icon button (redesigned screens).
export function SettingsButton({ paper }: { paper?: boolean } = {}) {
  const C = useC()
  const styles = useSheet(stylesSheet)
  const router = useRouter()
  const open = () => router.push("/(tabs)/(buttonTabs)/settings" as any)
  if (paper) return <IconButton icon="settings-outline" label="Settings" onPress={open} />
  return (
    <Pressable
      onPress={open}
      style={({ pressed }) => [styles.btn, pressed && { opacity: 0.6 }]}
      hitSlop={8}
      accessibilityLabel="Settings"
    >
      <Ionicons name="settings-outline" size={20} color={C.textSecondary} />
    </Pressable>
  )
}

const stylesSheet = paperSheet((C) => StyleSheet.create({
  btn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.surfaceHigh, alignItems: "center", justifyContent: "center",
  },
}))
