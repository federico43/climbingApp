import { usePaper } from "@/theme/paper/PaperThemeProvider"
import { font, radius } from "@/theme/paper/tokens"
import { Ionicons } from "@expo/vector-icons"
import React from "react"
import { Pressable, PressableProps, StyleProp, Text, View, ViewStyle } from "react-native"

type IconName = React.ComponentProps<typeof Ionicons>["name"]

type BaseProps = Omit<PressableProps, "style" | "children"> & {
  label: string
  style?: StyleProp<ViewStyle>
}

/** iOS-only coloured glow (Android can't colour shadows; it just goes without). */
function glowStyle(color: string | null, radiusPx: number, opacity: number): ViewStyle | null {
  if (!color) return null
  return { shadowColor: color, shadowOpacity: opacity, shadowRadius: radiusPx / 2, shadowOffset: { width: 0, height: 0 } }
}

/**
 * Primary CTA (Start workout): 60 high, mint, 2px border, leading ink circle
 * with a mint play triangle, hard 6px offset shadow (dark: mint glow).
 */
export function PrimaryCTA({ label, icon = "play", style, disabled, ...rest }: BaseProps & { icon?: IconName }) {
  const t = usePaper()
  const dark = t.mode === "dark"
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} {...rest} style={[{ height: 66 }, style]}>
      {({ pressed }) => (
        <View style={{ height: 60, opacity: disabled ? 0.5 : 1 }}>
          {/* Hard offset shadow, drawn as a pill so it works on Android too. */}
          <View
            style={{
              position: "absolute", left: 0, right: 0, top: 6, height: 60, borderRadius: radius.cta,
              backgroundColor: dark ? "#2F9E63" : t.ink,
            }}
          />
          <View
            style={[
              {
                height: 60, borderRadius: radius.cta, backgroundColor: t.mint, borderWidth: 2,
                borderColor: dark ? t.mint : t.ink, flexDirection: "row", alignItems: "center",
                justifyContent: "center", gap: 12, transform: [{ translateY: pressed ? 4 : 0 }],
              },
              glowStyle(t.glow, 40, 0.45),
            ]}
          >
            <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: "#121014", alignItems: "center", justifyContent: "center" }}>
              <Ionicons name={icon} size={15} color={t.mint} style={icon === "play" ? { marginLeft: 2 } : undefined} />
            </View>
            <Text style={{ fontFamily: font.bold, fontSize: 18, color: t.onMint }}>{label}</Text>
          </View>
        </View>
      )}
    </Pressable>
  )
}

/** Small mint button (Start, Save). compact = 34 high for nav bars. */
export function MintButton({ label, icon, compact, style, disabled, ...rest }: BaseProps & { icon?: IconName; compact?: boolean }) {
  const t = usePaper()
  const h = compact ? 34 : 42
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} {...rest}>
      {({ pressed }) => (
        <View
          style={[
            {
              height: h, borderRadius: h / 2, paddingHorizontal: compact ? 14 : 18, backgroundColor: t.mint,
              borderWidth: 1.5, borderColor: t.mode === "dark" ? t.mint : t.ink,
              flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
              opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
            },
            glowStyle(t.glow, 18, 0.35),
            style,
          ]}
        >
          {icon && <Ionicons name={icon} size={compact ? 14 : 16} color={t.onMint} />}
          <Text style={{ fontFamily: font.bold, fontSize: 14, color: t.onMint }}>{label}</Text>
        </View>
      )}
    </Pressable>
  )
}

/**
 * Ghost button (Pick a day, Add): transparent with an outline.
 * tone="mint": mint outline + text in dark mode (the "Add" look); ink in light.
 */
export function GhostButton({ label, icon, compact, tone = "ink", style, disabled, ...rest }: BaseProps & { icon?: IconName; compact?: boolean; tone?: "ink" | "mint" }) {
  const t = usePaper()
  const h = compact ? 34 : 42
  const mint = tone === "mint" && t.mode === "dark"
  const color = mint ? t.mint : t.ink
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} {...rest}>
      {({ pressed }) => (
        <View
          style={[
            {
              height: h, borderRadius: compact ? 16 : radius.button, paddingHorizontal: compact ? 12 : 16,
              borderWidth: 1.5, borderColor: mint ? t.mint : t.ghostBorder,
              flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
              backgroundColor: pressed ? t.inputFill : "transparent", opacity: disabled ? 0.5 : 1,
            },
            style,
          ]}
        >
          {icon && <Ionicons name={icon} size={compact ? 14 : 16} color={color} />}
          <Text style={{ fontFamily: font.bold, fontSize: 14, color }}>{label}</Text>
        </View>
      )}
    </Pressable>
  )
}

/** 40pt round icon button with an ink outline. label is read by VoiceOver. */
export function IconButton({ icon, label, size = 40, style, ...rest }: Omit<BaseProps, "label"> & { icon: IconName; label: string; size?: number }) {
  const t = usePaper()
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6} {...rest}>
      {({ pressed }) => (
        <View
          style={[
            {
              width: size, height: size, borderRadius: size / 2, borderWidth: 1.5, borderColor: t.ink,
              alignItems: "center", justifyContent: "center", backgroundColor: pressed ? t.inputFill : "transparent",
            },
            style,
          ]}
        >
          <Ionicons name={icon} size={size * 0.48} color={t.ink} />
        </View>
      )}
    </Pressable>
  )
}

/** Text-only button (nav bar "Cancel"). */
export function TextButton({ label, style, ...rest }: BaseProps) {
  const t = usePaper()
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={10} {...rest}>
      {({ pressed }) => <Text style={[{ fontFamily: font.bodyBold, fontSize: 15, color: t.ink, opacity: pressed ? 0.6 : 1 }, style as any]}>{label}</Text>}
    </Pressable>
  )
}
