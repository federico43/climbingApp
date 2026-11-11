import { usePaper } from "@/theme/paper/PaperThemeProvider"
import { font } from "@/theme/paper/tokens"
import { Ionicons } from "@expo/vector-icons"
import React from "react"
import { Pressable, Text, View } from "react-native"
import { Body, Mono } from "./Type"

type IconName = React.ComponentProps<typeof Ionicons>["name"]

/** 34pt circle (ink / dark green) with a mint icon. */
export function IconCircle({ icon, size = 34 }: { icon: IconName; size?: number }) {
  const t = usePaper()
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.iconCircle, alignItems: "center", justifyContent: "center" }}>
      <Ionicons name={icon} size={size * 0.5} color={t.mint} />
    </View>
  )
}

type ListRowProps = {
  icon: IconName
  label: string
  /** Short secondary text under the label. */
  detail?: string
  /** 1-based; shown as 01, 02… */
  index?: number
  trailing?: React.ReactNode
  /** Hides the hairline under the row. */
  last?: boolean
  onPress?: () => void
}

/** List row: mono index, icon circle, 16/700 label, hairline divider. */
export function ListRow({ icon, label, detail, index, trailing, last, onPress }: ListRowProps) {
  const t = usePaper()
  const content = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: last ? 0 : 1, borderBottomColor: t.hairline }}>
      {index != null && <Mono style={{ width: 20 }}>{String(index).padStart(2, "0")}</Mono>}
      <IconCircle icon={icon} />
      <View style={{ flex: 1 }}>
        <Body weight={700} size={16} numberOfLines={1}>{label}</Body>
        {detail ? <Body muted size={13} numberOfLines={1}>{detail}</Body> : null}
      </View>
      {trailing}
    </View>
  )
  if (!onPress) return content
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      {({ pressed }) => <View style={{ opacity: pressed ? 0.6 : 1 }}>{content}</View>}
    </Pressable>
  )
}

type SettingsRowProps = {
  icon: IconName
  title: string
  description?: string
  /** Trailing control: a SelectValue, a GhostButton, a PaperSwitch… */
  trailing?: React.ReactNode
  last?: boolean
  onPress?: () => void
}

/** Settings row: icon circle, bold title + muted one-liner, trailing control. */
export function SettingsRow({ icon, title, description, trailing, last, onPress }: SettingsRowProps) {
  const t = usePaper()
  const content = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: t.hairline }}>
      <IconCircle icon={icon} />
      <View style={{ flex: 1 }}>
        <Body weight={800} size={15}>{title}</Body>
        {description ? <Body muted size={13} numberOfLines={1}>{description}</Body> : null}
      </View>
      {trailing}
    </View>
  )
  if (!onPress) return content
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
      {({ pressed }) => <View style={{ opacity: pressed ? 0.6 : 1 }}>{content}</View>}
    </Pressable>
  )
}

/** Trailing "value ⌄" for a select-style settings row. */
export function SelectValue({ value }: { value: string }) {
  const t = usePaper()
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Text style={{ fontFamily: font.bodyBold, fontSize: 14, color: t.ink }}>{value}</Text>
      <Ionicons name="chevron-down" size={14} color={t.ink} />
    </View>
  )
}
