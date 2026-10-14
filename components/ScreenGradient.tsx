import { LinearGradient } from "expo-linear-gradient"
import React from "react"
import { StyleProp, ViewStyle } from "react-native"

// The home-screen background gradient, reused across tabs for a consistent look.
export function ScreenGradient({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <LinearGradient colors={["#1B2420", "#242325", "#242325"]} style={[{ flex: 1 }, style]}>
      {children}
    </LinearGradient>
  )
}
