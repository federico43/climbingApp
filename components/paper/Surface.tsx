import { usePaper } from "@/theme/paper/PaperThemeProvider"
import { space } from "@/theme/paper/tokens"
import React from "react"
import { Image, ScrollView, ScrollViewProps, StyleProp, StyleSheet, View, ViewStyle } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg"

const GRAIN = require("@/assets/images/paper/grain.png")
const MELT = require("@/assets/images/paper/melt.png")

/** Film grain over everything (cards included). Never takes touches. */
export function Grain() {
  const t = usePaper()
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: t.grainOpacity }]}>
      <Image source={GRAIN} resizeMode="repeat" style={StyleSheet.absoluteFill} />
    </View>
  )
}

/**
 * The blurred liquid gradient melting out of the poster headline. One per
 * screen, top area only. Place it as the first child of the scroll content,
 * `top` = where the headline starts; it renders behind what follows.
 */
export function Melt({ top = 0, height = 460 }: { top?: number; height?: number }) {
  const t = usePaper()
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: -16, right: -16, top, height, opacity: t.meltOpacity }}>
      <Image source={MELT} resizeMode="stretch" style={StyleSheet.absoluteFill} />
    </View>
  )
}

/** Paper background (+ the dark mode glow at the top) with grain on top of the children. */
export function PaperBackground({ children, style }: { children?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = usePaper()
  return (
    <View style={[{ flex: 1, backgroundColor: t.paper }, style]}>
      {t.paperGlow && (
        <Svg pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Defs>
            <RadialGradient id="glow" cx="50%" cy="0%" rx="90%" ry="45%">
              <Stop offset="0" stopColor={t.paperGlow} stopOpacity={1} />
              <Stop offset="1" stopColor={t.paperGlow} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#glow)" />
        </Svg>
      )}
      {children}
      <Grain />
    </View>
  )
}

type ScreenProps = {
  children: React.ReactNode
  /** Fixed header above the scroll (greeting row, nav bar). */
  header?: React.ReactNode
  /** Fixed footer over the bottom of the scroll (CTA, sticky add bar). */
  footer?: React.ReactNode
  scrollProps?: Omit<ScrollViewProps, "children">
  /** Extra bottom padding so content clears a fixed tab bar / footer. */
  bottomPad?: number
  /** false = no ScrollView (the screen manages its own list). */
  scroll?: boolean
}

/** A full Paper Mint screen: paper, safe area, scrolling content, grain on top. */
export function PaperScreen({ children, header, footer, scrollProps, bottomPad = space.bottomPad, scroll = true }: ScreenProps) {
  return (
    <PaperBackground>
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        {header}
        {scroll ? (
          <ScrollView
            showsVerticalScrollIndicator={false}
            {...scrollProps}
            contentContainerStyle={[{ paddingHorizontal: space.gutter, paddingBottom: bottomPad }, scrollProps?.contentContainerStyle]}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={{ flex: 1 }}>{children}</View>
        )}
        {footer}
      </SafeAreaView>
    </PaperBackground>
  )
}
