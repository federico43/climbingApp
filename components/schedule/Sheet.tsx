import { K as C, KF, WIDE } from "@/components/schedule/calTheme"
import React from "react"
import { Ionicons } from "@expo/vector-icons"
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

// Bottom sheet for the class screens. Hidden when `visible` is false.
export function Sheet({
  visible,
  title,
  subtitle,
  eyebrow,
  poster,
  onClose,
  children,
}: {
  visible: boolean
  title: string
  subtitle?: string
  eyebrow?: string  // small mono line above, e.g. "YOUR FIXED CLASS"
  poster?: string   // big condensed headline, e.g. "WED 7:00"
  onClose: () => void
  children?: React.ReactNode
}) {
  const insets = useSafeAreaInsets()
  // Big screens: a panel on the right, so the calendar stays in view.
  const wide = useWindowDimensions().width >= WIDE
  return (
    <Modal visible={visible} animationType={wide ? "fade" : "slide"} transparent onRequestClose={onClose}>
      <Pressable style={[s.scrim, wide && s.scrimWide]} onPress={onClose} />
      <View style={wide
        ? [s.sheet, s.side, { paddingTop: 20 + insets.top, paddingBottom: 20 + insets.bottom }]
        : [s.sheet, { paddingBottom: 20 + insets.bottom }]}>
        {!wide && <View style={s.grab} />}
        {eyebrow ? <Text style={s.eyebrow}>{eyebrow.toUpperCase()}</Text> : null}
        {poster ? <Text style={s.poster}>{poster}</Text> : null}
        <View style={s.head}>
          <Text style={[s.title, { flex: 1 }, poster ? s.titleSmall : null]}>{title}</Text>
          <Pressable hitSlop={10} onPress={onClose} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={C.textSecondary} />
          </Pressable>
        </View>
        {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
        {/* Long lists (e.g. every athlete's package) scroll inside the sheet. */}
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 12 }} showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  )
}

// A tall option button with a title and a line below.
export function SheetOption({
  title,
  detail,
  disabled,
  onPress,
}: {
  title: string
  detail?: string
  disabled?: boolean
  onPress: () => void
}) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [s.opt, disabled && { opacity: 0.35 }, pressed && { opacity: 0.8 }]}>
      <Text style={s.optTitle}>{title}</Text>
      {detail ? <Text style={s.optDetail}>{detail}</Text> : null}
    </Pressable>
  )
}

export function SheetButton({
  label,
  kind = "green",
  disabled,
  onPress,
}: {
  label: string
  kind?: "green" | "line" | "red"
  disabled?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [s.btn, btn[kind], disabled && { opacity: 0.35 }, pressed && { opacity: 0.85 }]}
    >
      <Text style={[s.btnText, btnText[kind]]}>{label}</Text>
    </Pressable>
  )
}

const btn = StyleSheet.create({
  green: { backgroundColor: C.green },
  line: { borderWidth: 1, borderColor: C.border },
  red: { borderWidth: 1, borderColor: "rgba(219,80,74,0.4)" },
})
const btnText = StyleSheet.create({
  green: { color: C.onMint },
  line: { color: C.textPrimary },
  red: { color: C.red },
})

const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 10, gap: 12, maxHeight: "85%",
  },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  scrimWide: { backgroundColor: "rgba(0,0,0,0.3)" },
  side: {
    position: "absolute", right: 0, top: 0, bottom: 0, width: 420, maxHeight: "100%",
    borderTopRightRadius: 0, borderBottomLeftRadius: 28, borderLeftWidth: 1, borderLeftColor: C.border,
  },
  grab: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.surfaceHigh, alignSelf: "center", marginBottom: 4 },
  title: { fontFamily: KF.title, fontSize: 22, color: C.textPrimary, letterSpacing: -0.2 },
  titleSmall: { fontFamily: KF.bodyBold, fontSize: 15, color: C.textSecondary },
  eyebrow: { fontFamily: KF.mono, fontSize: 10.5, color: C.green, letterSpacing: 0.8 },
  poster: { fontFamily: KF.poster, fontSize: 48, lineHeight: 48, color: C.textPrimary, letterSpacing: -0.8, marginTop: -6 },
  subtitle: { fontSize: 13, color: C.textSecondary, marginTop: -6 },
  opt: { backgroundColor: C.surfaceHigh, borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 14 },
  optTitle: { fontSize: 15, fontWeight: "700", color: C.textPrimary },
  optDetail: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  btn: { borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  btnText: { fontSize: 14, fontWeight: "800" },
})
