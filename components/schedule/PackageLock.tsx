import { useAuth } from "@/components/auth-context"
import { refreshClassSchedule, useClassSchedule } from "@/utils/classScheduleStore"
import { C } from "@/utils/theme"
import { Ionicons } from "@expo/vector-icons"
import * as Notifications from "expo-notifications"
import { useEffect, useState } from "react"
import { ActivityIndicator, AppState, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native"

// Athletes whose package is used up or past its use-by date can't use the
// app until the coach renews it. The package is checked again whenever the
// app comes back to the front and when the "Package ready" push arrives, so
// the lock goes away on its own once the coach adds a new one.
export function PackageLock() {
  const { role } = useAuth()
  if (role === "coach") return null
  return <Lock />
}

function Lock() {
  const { signOut } = useAuth()
  const st = useClassSchedule()
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") refreshClassSchedule() })
    const push = Platform.OS === "web" ? null : Notifications.addNotificationReceivedListener((n) => {
      if (n.request.content.data?.type === "class_package") refreshClassSchedule()
    })
    return () => { sub.remove(); push?.remove() }
  }, [])

  const pkg = st.pkg
  if (!pkg?.locked) return null
  const usedUp = pkg.left <= 0
  return (
    <Modal visible animationType="fade" statusBarTranslucent>
      <View style={s.wrap}>
        <Ionicons name="lock-closed" size={44} color={C.yellow} />
        <Text style={s.title}>{usedUp ? "No sessions left" : "Your package expired"}</Text>
        <Text style={s.body}>
          {usedUp
            ? `You used all ${pkg.total} sessions of your package.`
            : `It had to be used by ${pkg.useBy}.`}{" "}
          Ask your coach to renew it. The app opens again as soon as they do.
        </Text>
        <Pressable
          style={s.button}
          disabled={checking}
          onPress={() => { setChecking(true); refreshClassSchedule().finally(() => setChecking(false)) }}
        >
          {checking ? <ActivityIndicator color={C.bg} /> : <Text style={s.buttonText}>Check again</Text>}
        </Pressable>
        <Pressable hitSlop={10} onPress={signOut}>
          <Text style={s.link}>Sign out</Text>
        </Pressable>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center", padding: 32, gap: 16 },
  title: { color: C.textPrimary, fontSize: 24, fontWeight: "800", textAlign: "center" },
  body: { color: C.textSecondary, fontSize: 15, lineHeight: 22, textAlign: "center" },
  button: {
    marginTop: 8, backgroundColor: C.green, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32, minWidth: 180, alignItems: "center",
  },
  buttonText: { color: C.bg, fontSize: 16, fontWeight: "800" },
  link: { color: C.textMuted, fontSize: 14, fontWeight: "700", marginTop: 8 },
})
