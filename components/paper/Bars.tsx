import { usePaper } from "@/theme/paper/PaperThemeProvider"
import { font, radius, space } from "@/theme/paper/tokens"
import { Ionicons } from "@expo/vector-icons"
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs"
import { LinearGradient } from "expo-linear-gradient"
import React from "react"
import { Pressable, StyleProp, Text, View, ViewStyle } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { MintButton, TextButton } from "./Buttons"
import { Mono } from "./Type"

/** Editor nav bar: Cancel · title + mono status · Save, with a rule beneath. */
export function NavBar({
  title, status, onCancel, onSave, saveLabel = "Save", saveDisabled, cancelLabel = "Cancel",
}: {
  title: string
  status?: string
  onCancel?: () => void
  onSave?: () => void
  saveLabel?: string
  saveDisabled?: boolean
  cancelLabel?: string
}) {
  const t = usePaper()
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.gutter, paddingVertical: 10, borderBottomWidth: 1.5, borderBottomColor: t.navRule }}>
      <View style={{ flex: 1, alignItems: "flex-start" }}>{onCancel && <TextButton label={cancelLabel} onPress={onCancel} />}</View>
      <View style={{ alignItems: "center", flexShrink: 1 }}>
        <Text numberOfLines={1} style={{ fontFamily: font.bold, fontSize: 16, color: t.ink }}>{title}</Text>
        {status ? <Mono color={t.mintText} size={9.5}>{status}</Mono> : null}
      </View>
      <View style={{ flex: 1, alignItems: "flex-end" }}>
        {onSave && <MintButton compact label={saveLabel} onPress={onSave} disabled={saveDisabled} />}
      </View>
    </View>
  )
}

/** Dashed "+ Add block" bar. */
export function AddBar({ label, onPress, style }: { label: string; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  const t = usePaper()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      {({ pressed }) => (
        <View
          style={[
            {
              height: 58, borderRadius: radius.addBar, borderWidth: 2, borderStyle: "dashed", borderColor: t.addBarBorder,
              backgroundColor: t.addBarFill, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
              opacity: pressed ? 0.75 : 1,
            },
            style,
          ]}
        >
          <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: t.mint, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="add" size={18} color={t.onMint} />
          </View>
          <Text style={{ fontFamily: font.bold, fontSize: 16, color: t.ink }}>{label}</Text>
        </View>
      )}
    </Pressable>
  )
}

/** Pins its children to the bottom over a paper fade (sticky add bar, CTA). */
export function StickyFooter({ children, bottom = 16 }: { children: React.ReactNode; bottom?: number }) {
  const t = usePaper()
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: space.gutter, paddingBottom: bottom }}>
      <LinearGradient pointerEvents="none" colors={[t.paper + "00", t.paper]} locations={[0, 0.55]} style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: -40 }} />
      {children}
    </View>
  )
}

/**
 * Frosted tab bar for expo-router <Tabs tabBar={(p) => <PaperTabBar {...p} />}>.
 * Active tab: ink label, icon on a mint rounded square. Hidden routes
 * (href: null) are skipped.
 */
export function PaperTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const t = usePaper()
  const insets = useSafeAreaInsets()
  return (
    <View
      style={{
        flexDirection: "row", backgroundColor: t.tabBar, borderTopWidth: 1, borderTopColor: t.hairline,
        paddingTop: 8, paddingBottom: Math.max(insets.bottom, 10), minHeight: 54 + insets.bottom,
      }}
    >
      {state.routes.map((route, i) => {
        const { options } = descriptors[route.key]
        const itemStyle = options.tabBarItemStyle as ViewStyle | undefined
        if (itemStyle?.display === "none") return null
        const focused = state.index === i
        const label = typeof options.title === "string" ? options.title : route.name
        const icon = options.tabBarIcon?.({ focused, color: focused ? "#121014" : t.label, size: 20 })
        const onPress = () => {
          const e = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true })
          if (!focused && !e.defaultPrevented) navigation.navigate(route.name, route.params)
        }
        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            style={{ flex: 1, alignItems: "center", gap: 4 }}
          >
            <View style={{ width: 40, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: focused ? t.mint : "transparent" }}>
              {icon}
            </View>
            <Text style={{ fontFamily: focused ? font.bold : font.body, fontSize: 11, color: focused ? t.ink : t.label }}>{label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}
