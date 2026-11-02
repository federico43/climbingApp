import { C } from "@/utils/theme"
import { BackButton } from "@/components/BackButton"
import React from "react"
import { StyleSheet, Text, View } from "react-native"

// Back button + title for screens opened from Settings.
export function SubScreenHeader({
  title,
  subtitle,
  right,
}: {
  title: string
  subtitle?: string
  right?: React.ReactNode
}) {
  return (
    <View style={styles.header}>
      <BackButton />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 12,
  },
  title: { fontSize: 24, fontWeight: "800", color: C.textPrimary, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: C.textSecondary, fontWeight: "500" },
})
