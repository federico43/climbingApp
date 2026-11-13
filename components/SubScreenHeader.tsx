import { IconButton } from "@/components/paper/Buttons"
import { Melt } from "@/components/paper/Surface"
import { Mono, PosterHeadline, posterSize } from "@/components/paper/Type"
import { paperSheet, useC, usePaperScope, useSheet } from "@/theme/paper/legacy"
import { Ionicons } from "@expo/vector-icons"
import { useRouter } from "expo-router"
import React from "react"
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native"

// Back button + title for screens opened from Settings, the coach tools…
// In Paper Mint the title is the screen's poster headline (with the melt
// behind it) and the subtitle its mono eyebrow. The parent handles the top
// safe area (SafeAreaView edges top), so nothing here touches the iOS bar.
export function SubScreenHeader({
  title,
  subtitle,
  right,
  onBack,
}: {
  title: string
  subtitle?: string
  right?: React.ReactNode
  /** Default: router.back(). */
  onBack?: () => void
}) {
  const C = useC()
  const styles = useSheet(stylesSheet)
  const P = usePaperScope()
  const router = useRouter()
  const { width } = useWindowDimensions()
  const back = onBack ?? (() => router.back())

  if (P) {
    // Long titles (an exercise's name, "Log a session for …") wrap instead of shrinking forever.
    const size = Math.max(40, posterSize(title, 60, width))
    return (
      <View style={styles.paperWrap}>
        <Melt top={44} height={240} />
        <View style={styles.paperBar}>
          <IconButton icon="chevron-back" label="Back" onPress={back} />
          <View style={styles.paperRight}>{right}</View>
        </View>
        {subtitle ? <Mono style={{ marginTop: 14 }}>{subtitle}</Mono> : null}
        <PosterHeadline size={size} wordPerLine={false} numberOfLines={3} style={{ marginTop: subtitle ? 6 : 14 }}>
          {title}
        </PosterHeadline>
      </View>
    )
  }

  return (
    <View style={styles.header}>
      <Pressable onPress={back} style={styles.backBtn} hitSlop={10}>
        <Ionicons name="chevron-back" size={20} color={C.textSecondary} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  )
}

const stylesSheet = paperSheet((C) => StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 12,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.surfaceHigh, alignItems: "center", justifyContent: "center",
  },
  title: { fontSize: 24, fontWeight: "800", color: C.textPrimary, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: C.textSecondary, fontWeight: "500" },
  paperWrap: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20 },
  paperBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  paperRight: { flexDirection: "row", alignItems: "center", gap: 8 },
}))
