import { C } from "@/utils/theme"
import { Ionicons } from "@expo/vector-icons"
import { useRouter } from "expo-router"
import { Pressable, StyleSheet } from "react-native"

// The one back button: a round chevron, the same on every screen.
// Defaults to router.back(); pass onPress for screens that go somewhere fixed.
export function BackButton({ onPress, label = "Back" }: { onPress?: () => void; label?: string }) {
  const router = useRouter()
  return (
    <Pressable
      onPress={onPress ?? (() => router.back())}
      style={({ pressed }) => [styles.btn, pressed && { opacity: 0.6 }]}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name="chevron-back" size={20} color={C.textSecondary} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  btn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.surfaceHigh, alignItems: "center", justifyContent: "center",
  },
})
