import { C } from "@/utils/theme"
import { getUsers, setUserRole, type AppUser, type UserRole } from "@/services/BoulderGraphService"
import { Ionicons } from "@expo/vector-icons"
import { useEffect, useState } from "react"
import { Alert, Pressable, StyleSheet, Text } from "react-native"

// The `users.role` column drives push notifications: the coach only hears
// about workouts from users with role "athlete", and only users with role
// "coach" receive those pushes. Sign-up never set it, so this pill (next to
// the athlete's name on the coach dashboard) lets the coach assign it.
export function RolePill({ athlete, onChanged }: { athlete: AppUser; onChanged?: () => void }) {
  const [role, setRole] = useState<UserRole | null>(athlete.role ?? null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setRole(athlete.role ?? null)
    getUsers(athlete.$id).then((row: any) => { if (!cancelled && row) setRole(row.role ?? null) })
    return () => { cancelled = true }
  }, [athlete.$id, athlete.role])

  async function save(next: UserRole) {
    if (next === role) return
    const prev = role
    setRole(next)
    setSaving(true)
    try {
      await setUserRole(athlete.$id, next)
      onChanged?.()
    } catch (e) {
      console.log(e)
      setRole(prev)
      Alert.alert("Couldn't save role", e instanceof Error ? e.message : "Try again.")
    } finally {
      setSaving(false)
    }
  }

  function choose() {
    Alert.alert(
      `Role for ${athlete.username || "this user"}`,
      "Athletes notify their coach when they finish a workout. Coaches receive those notifications.",
      [
        { text: "Athlete", onPress: () => save("athlete") },
        { text: "Coach", onPress: () => save("coach") },
        { text: "Cancel", style: "cancel" },
      ],
    )
  }

  const missing = !role
  return (
    <Pressable
      onPress={choose}
      disabled={saving}
      hitSlop={6}
      style={[styles.pill, missing && styles.pillMissing]}
      accessibilityLabel={`Role: ${role ?? "not set"}. Tap to change`}
    >
      {missing && <Ionicons name="warning-outline" size={12} color={C.yellow} />}
      <Text style={[styles.text, missing && styles.textMissing]}>
        {role ?? "No role"}
      </Text>
      <Ionicons name="chevron-down" size={12} color={missing ? C.yellow : C.textSecondary} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
    backgroundColor: C.surfaceHigh, borderWidth: 1, borderColor: C.border,
  },
  pillMissing: { borderColor: C.yellow },
  text: { fontSize: 12, fontWeight: "700", color: C.textSecondary, textTransform: "capitalize" },
  textMissing: { color: C.yellow, textTransform: "none" },
})
