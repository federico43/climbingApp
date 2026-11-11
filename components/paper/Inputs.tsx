import { usePaper } from "@/theme/paper/PaperThemeProvider"
import { font, radius, type } from "@/theme/paper/tokens"
import { Ionicons } from "@expo/vector-icons"
import React, { useEffect, useState } from "react"
import { Pressable, StyleProp, Text, TextInput, TextInputProps, View, ViewStyle } from "react-native"
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated"
import { Mono, PosterHeadline } from "./Type"

/** Text input: 48 high, soft fill, mintDeep border when focused. */
export function TextField({ label, style, onFocus, onBlur, ...rest }: TextInputProps & { label?: string; style?: StyleProp<ViewStyle> }) {
  const t = usePaper()
  const [focused, setFocused] = useState(false)
  return (
    <View style={style}>
      {label && <Mono style={{ marginBottom: 6 }}>{label}</Mono>}
      <TextInput
        placeholderTextColor={t.label}
        accessibilityLabel={label}
        {...rest}
        onFocus={(e) => { setFocused(true); onFocus?.(e) }}
        onBlur={(e) => { setFocused(false); onBlur?.(e) }}
        style={{
          height: 48, borderRadius: radius.input, paddingHorizontal: 14,
          backgroundColor: t.inputFill, borderWidth: 1.5,
          borderColor: focused ? t.mintDeep : t.inputBorder,
          fontFamily: font.body, fontSize: 15, color: t.ink,
        }}
      />
    </View>
  )
}

/** Borderless huge headline input (workout name) with a 2px ink underline. */
export function HeadlineInput({ value, placeholder = "Untitled", style, ...rest }: TextInputProps & { style?: StyleProp<ViewStyle> }) {
  const t = usePaper()
  return (
    <View style={[{ borderBottomWidth: 2, borderBottomColor: t.ink, paddingBottom: 6 }, style]}>
      {!value && (
        <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0 }}>
          <PosterHeadline size={58} wordPerLine={false} numberOfLines={1}>{placeholder}</PosterHeadline>
        </View>
      )}
      <TextInput
        value={value}
        accessibilityLabel={placeholder}
        autoCapitalize="characters"
        placeholderTextColor="transparent"
        placeholder={placeholder}
        {...rest}
        style={{ ...type.headlineInput, color: t.ink, padding: 0, includeFontPadding: false, textTransform: "uppercase" }}
      />
    </View>
  )
}

type StepperProps = {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  format?: (v: number) => string
  label?: string
  style?: StyleProp<ViewStyle>
}

/** Pill stepper: − left, condensed value centred, + right on mint. */
export function Stepper({ value, onChange, min = 0, max = Infinity, step = 1, format = String, label = "Value", style }: StepperProps) {
  const t = usePaper()
  const dec = () => onChange(Math.max(min, value - step))
  const inc = () => onChange(Math.min(max, value + step))
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: format(value) }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => (e.nativeEvent.actionName === "increment" ? inc() : dec())}
      style={[{ height: 52, borderRadius: 26, borderWidth: 1.5, borderColor: t.ink, flexDirection: "row", alignItems: "center", overflow: "hidden" }, style]}
    >
      <Pressable onPress={dec} disabled={value <= min} style={{ width: 56, height: "100%", alignItems: "center", justifyContent: "center", opacity: value <= min ? 0.35 : 1 }}>
        <Ionicons name="remove" size={22} color={t.ink} />
      </Pressable>
      <Text style={{ flex: 1, textAlign: "center", fontFamily: font.title, fontSize: 28, color: t.ink, includeFontPadding: false }}>{format(value)}</Text>
      <Pressable
        onPress={inc}
        disabled={value >= max}
        style={{ width: 56, height: "100%", alignItems: "center", justifyContent: "center", backgroundColor: t.mint, borderLeftWidth: 1.5, borderLeftColor: t.ink, opacity: value >= max ? 0.5 : 1 }}
      >
        <Ionicons name="add" size={22} color={t.onMint} />
      </Pressable>
    </View>
  )
}

/** 54×32 switch: ink outline, white knob, mint when on (dark adds glow). */
export function PaperSwitch({ value, onValueChange, label, disabled }: { value: boolean; onValueChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  const t = usePaper()
  const x = useSharedValue(value ? 1 : 0)
  useEffect(() => {
    x.value = withTiming(value ? 1 : 0, { duration: 160 })
  }, [value, x])
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * 22 }] }))
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      hitSlop={6}
    >
      <View
        style={[
          {
            width: 54, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: t.ink,
            backgroundColor: value ? t.mint : t.inputFill, justifyContent: "center", paddingHorizontal: 2,
            opacity: disabled ? 0.5 : 1,
          },
          value && t.glow ? { shadowColor: t.glow, shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } } : null,
        ]}
      >
        <Animated.View style={[{ width: 25, height: 25, borderRadius: 13, backgroundColor: "#FFFFFF", borderWidth: 1.5, borderColor: "#121014" }, knob]} />
      </View>
    </Pressable>
  )
}
