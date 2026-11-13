import { PaperBackground } from "@/components/paper/Surface"
import { usePaperScope } from "@/theme/paper/legacy"
import { LinearGradient } from "expo-linear-gradient"
import React from "react"
import { StyleProp, ViewStyle } from "react-native"

// The screen background. Inside <PaperScope>: Paper Mint (paper, dark-mode
// glow, grain over everything). Outside: the old dark gradient.
export function ScreenGradient({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const P = usePaperScope()
  if (P) return <PaperBackground style={style}>{children}</PaperBackground>
  return (
    <LinearGradient colors={["#1B2420", "#242325", "#242325"]} style={[{ flex: 1 }, style]}>
      {children}
    </LinearGradient>
  )
}
