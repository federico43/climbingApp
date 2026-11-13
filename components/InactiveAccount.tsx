import { ConsumeAuth } from "@/components/auth-context"
import { paperSheet, useC, useSheet } from "@/theme/paper/legacy"
import { Ionicons } from "@expo/vector-icons"
import { useState } from "react"
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

// Shown instead of the app when the coach deactivated this account
// (users.active = false, see components/coach/ActivePill). The athlete can
// check again after talking to the coach, or sign out to log in with — or
// create — another account.
export function InactiveAccount() {
  const C = useC()
  const styles = useSheet(stylesSheet)
  const { userName, refreshUser, signOut } = ConsumeAuth()
  const [checking, setChecking] = useState(false)

  async function checkAgain() {
    setChecking(true)
    try { await refreshUser() } finally { setChecking(false) }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <Ionicons name="pause-circle-outline" size={56} color={C.yellow} />
        <Text style={styles.title}>Your account is inactive</Text>
        <Text style={styles.text}>
          {userName ? `${userName}, talk` : "Talk"} to your coach to change it.
        </Text>
        <Pressable style={styles.primary} onPress={checkAgain} disabled={checking}>
          {checking
            ? <ActivityIndicator color={C.bg} />
            : <Text style={styles.primaryText}>Check again</Text>}
        </Pressable>
        <Pressable style={styles.secondary} onPress={signOut} hitSlop={6}>
          <Text style={styles.secondaryText}>Log in or create another account</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const stylesSheet = paperSheet((C) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, paddingHorizontal: 32 },
  title: { fontSize: 22, fontWeight: "800", color: C.textPrimary, textAlign: "center" },
  text: { fontSize: 15, color: C.textSecondary, textAlign: "center", lineHeight: 21 },
  primary: {
    marginTop: 12, alignSelf: "stretch", height: 48, borderRadius: 14,
    backgroundColor: C.green, alignItems: "center", justifyContent: "center",
  },
  primaryText: { fontSize: 15, fontWeight: "800", color: C.bg },
  secondary: { paddingVertical: 10 },
  secondaryText: { fontSize: 14, fontWeight: "700", color: C.green },
}))
