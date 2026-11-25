import { paperSheet, useC, useSheet } from "@/theme/paper/legacy"
import { setUserActive, type AppUser } from "@/services/BoulderGraphService"
import { isAccountActive } from "@/utils/coachRoster"
import { Ionicons } from "@expo/vector-icons"
import { useEffect, useState } from "react"
import { Alert, Pressable, StyleSheet, Text } from "react-native"

// Next to the role pill on the coach dashboard: turns the athlete's account
// off or on. A deactivated athlete sees "talk to your coach" instead of the
// app (components/InactiveAccount.tsx) and leaves the roster's main list.
export function ActivePill({ athlete, onChanged }: { athlete: AppUser; onChanged?: () => void }) {
  const C = useC()
  const styles = useSheet(stylesSheet)
  const [active, setActive] = useState(isAccountActive(athlete))
  const [saving, setSaving] = useState(false)
  useEffect(() => { setActive(isAccountActive(athlete)) }, [athlete])

  async function save(next: boolean) {
    setActive(next)
    setSaving(true)
    try {
      await setUserActive(athlete.$id, next)
      onChanged?.()
    } catch (e) {
      console.log(e)
      setActive(!next)
      Alert.alert("Couldn't save", e instanceof Error ? e.message : "Try again.")
    } finally {
      setSaving(false)
    }
  }

  function choose() {
    const name = athlete.username || "this athlete"
    Alert.alert(
      active ? `Deactivate ${name}?` : `Reactivate ${name}?`,
      active
        ? "They'll see a message to talk to you and can't use the app until you reactivate them. Their history stays."
        : "They'll get the app back the next time they open it.",
      [
        { text: "Cancel", style: "cancel" },
        active
          ? { text: "Deactivate", style: "destructive", onPress: () => save(false) }
          : { text: "Reactivate", onPress: () => save(true) },
      ],
    )
  }

  return (
    <Pressable
      onPress={choose}
      disabled={saving}
      hitSlop={6}
      style={[styles.pill, !active && styles.pillOff]}
      accessibilityLabel={`${active ? "Active" : "Deactivated"}. Tap to change`}
    >
      <Ionicons name={active ? "checkmark-circle" : "pause-circle"} size={12} color={active ? C.green : C.yellow} />
      <Text style={[styles.text, !active && styles.textOff]}>{active ? "Active" : "Deactivated"}</Text>
    </Pressable>
  )
}

const stylesSheet = paperSheet((C) => StyleSheet.create({
  pill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
    backgroundColor: C.surfaceHigh, borderWidth: 1, borderColor: C.border,
  },
  pillOff: { borderColor: C.yellow },
  text: { fontSize: 12, fontWeight: "700", color: C.textSecondary },
  textOff: { color: C.yellow },
}))
