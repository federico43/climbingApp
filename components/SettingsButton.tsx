import { C } from "@/utils/theme"
import { Ionicons } from "@expo/vector-icons"
import { useRouter } from "expo-router"
import { Pressable, StyleSheet } from "react-native"

// Gear in the top-right of the main tabs — Settings is no longer a tab.
export function SettingsButton() {
  const router = useRouter()
  return (
    <Pressable
      onPress={() => router.push("/(tabs)/(buttonTabs)/settings" as any)}
      style={({ pressed }) => [styles.btn, pressed && { opacity: 0.6 }]}
      hitSlop={8}
      accessibilityLabel="Settings"
    >
      <Ionicons name="settings-outline" size={20} color={C.textSecondary} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  btn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.surfaceHigh, alignItems: "center", justifyContent: "center",
  },
})
