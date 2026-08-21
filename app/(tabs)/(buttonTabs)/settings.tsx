import { C } from "@/utils/theme"
import { ScreenEntry } from "@/components/ScreenEntry"
import { ScreenGradient } from "@/components/ScreenGradient"
import { ConsumeAuth } from "@/components/auth-context"
import { DailyCheckInModal } from "@/components/DailyCheckInModal"
import { CheckinRow, getCheckinForToday } from "@/services/BoulderGraphService"
import { useRouter } from "expo-router"
import { useEffect, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

export default function SettingsScreen() {
  const { User, signOut, role } = ConsumeAuth()
  const router = useRouter()

  const [todayCheckin, setTodayCheckin] = useState<CheckinRow | null>(null)
  const [checkinVisible, setCheckinVisible] = useState(false)

  useEffect(() => {
    if (!User) return
    getCheckinForToday(User.$id).then(setTodayCheckin)
  }, [User])

  return (
    <ScreenGradient>
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenEntry>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>Account & preferences</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Profile section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Account</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Email</Text>
              <Text style={styles.rowValue} numberOfLines={1}>{User?.email ?? "—"}</Text>
            </View>
            <View style={[styles.row, styles.rowLast]}>
              <Text style={styles.rowLabel}>Role</Text>
              <View style={styles.roleBadge}>
                <Text style={styles.roleBadgeText}>{role ?? "athlete"}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Today */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Today</Text>
          <View style={styles.card}>
            <Pressable
              style={({ pressed }) => [styles.row, styles.rowLast, pressed && { opacity: 0.6 }]}
              onPress={() => setCheckinVisible(true)}
            >
              <Text style={styles.rowLabel}>Daily check-in</Text>
              <Text style={styles.rowValue}>{todayCheckin ? "Done ✓" : "Not done yet"}</Text>
            </Pressable>
          </View>
        </View>

        {/* About / debug */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>About</Text>
          <View style={styles.card}>
            <Pressable
              style={({ pressed }) => [styles.row, styles.rowLast, pressed && { opacity: 0.6 }]}
              onPress={() => router.push("/OnBoarding")}
            >
              <Text style={styles.rowLabel}>Welcome page</Text>
              <Text style={styles.rowValue}>›</Text>
            </Pressable>
          </View>
        </View>

        {/* Sign out */}
        <View style={styles.section}>
          <Pressable
            style={({ pressed }) => [styles.signOutButton, pressed && { opacity: 0.7 }]}
            onPress={async () => {
              await signOut()
              router.replace("/auth")
            }}
          >
            <Text style={styles.signOutText}>Sign Out</Text>
          </Pressable>
        </View>
      </ScrollView>
      </ScreenEntry>

      <DailyCheckInModal
        visible={checkinVisible}
        initial={todayCheckin}
        onClose={() => setCheckinVisible(false)}
        onDone={() => {
          setCheckinVisible(false)
          if (User) getCheckinForToday(User.$id).then(setTodayCheckin)
        }}
      />
    </SafeAreaView>
    </ScreenGradient>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "transparent" },

  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
    gap: 2,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: C.textPrimary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    color: C.textSecondary,
    fontWeight: "500",
  },

  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 40,
    gap: 24,
  },

  section: { gap: 8 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: C.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    paddingHorizontal: 4,
  },

  card: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { fontSize: 15, color: C.textPrimary, fontWeight: "500" },
  rowValue: { fontSize: 15, color: C.textSecondary, maxWidth: "60%" },

  roleBadge: {
    backgroundColor: C.surfaceHigh,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
  },
  roleBadgeText: {
    fontSize: 13,
    fontWeight: "600",
    color: C.green,
    textTransform: "capitalize",
  },

  signOutButton: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.red,
    paddingVertical: 16,
    alignItems: "center",
  },
  signOutText: {
    fontSize: 16,
    fontWeight: "600",
    color: C.red,
  },
})
