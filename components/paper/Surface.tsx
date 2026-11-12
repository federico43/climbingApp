import { usePaper } from "@/theme/paper/PaperThemeProvider"
import { space } from "@/theme/paper/tokens"
import { useFocusEffect } from "@react-navigation/native"
import { setStatusBarStyle } from "expo-status-bar"
import React, { useCallback, useMemo } from "react"
import { Image, ScrollView, ScrollViewProps, StyleProp, StyleSheet, useWindowDimensions, View, ViewStyle } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { RailProvider, ScrollRail, useScrollRail } from "./ScrollRail"
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg"

const GRAIN = require("@/assets/images/paper/grain.png")
const MELT = require("@/assets/images/paper/melt.png")

/** Film grain over everything (cards included). Never takes touches. */
const TILE = 220

export function Grain() {
  const t = usePaper()
  const { width, height } = useWindowDimensions()
  const tiles = useMemo(() => {
    const out: [number, number][] = []
    for (let y = 0; y < height + 100; y += TILE) for (let x = 0; x < width; x += TILE) out.push([x, y])
    return out
  }, [width, height])
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: t.grainOpacity, overflow: "hidden" }]}>
      {/* Tiled by hand: resizeMode="repeat" drew a single tile on iOS. */}
      {tiles.map(([x, y]) => (
        <Image key={`${x}-${y}`} source={GRAIN} style={{ position: "absolute", left: x, top: y, width: TILE, height: TILE }} />
      ))}
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
  /** Scroll rail on the right edge; top = where it starts, just below the headline. */
  rail?: { top?: number }
}

/** A full Paper Mint screen: paper, safe area, scrolling content, grain on top. */
export function PaperScreen({ children, header, footer, scrollProps, bottomPad = space.bottomPad, scroll = true, rail }: ScreenProps) {
  usePaperStatusBar()
  const r = useScrollRail()
  return (
    <PaperBackground>
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        {header}
        {scroll ? (
          <View style={{ flex: 1 }} onLayout={(e) => r.setViewportH(e.nativeEvent.layout.height)}>
            <RailProvider value={r.ctx}>
              <ScrollView
                ref={r.scrollRef}
                showsVerticalScrollIndicator={!rail}
                scrollEventThrottle={16}
                {...scrollProps}
                onScroll={(e) => {
                  r.onScroll(e.nativeEvent.contentOffset.y)
                  scrollProps?.onScroll?.(e)
                }}
                onContentSizeChange={(w, h) => {
                  r.setContentH(h)
                  scrollProps?.onContentSizeChange?.(w, h)
                }}
                contentContainerStyle={[{ paddingHorizontal: space.gutter, paddingBottom: bottomPad }, scrollProps?.contentContainerStyle]}
              >
                <View ref={r.contentRef} collapsable={false}>{children}</View>
              </ScrollView>
            </RailProvider>
            {rail && (
              <ScrollRail
                scrollY={r.scrollY}
                contentH={r.contentH}
                viewportH={r.viewportH}
                anchors={r.anchors}
                seen={r.seen}
                top={rail.top ?? 220}
                bottom={footer ? 96 : 16}
                onJump={(y) => r.scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true })}
              />
            )}
          </View>
        ) : (
          <View style={{ flex: 1 }}>{children}</View>
        )}
        {footer}
      </SafeAreaView>
    </PaperBackground>
  )
}

/**
 * Status bar text that reads on this screen's paper while it's focused;
 * back to light text (the old dark screens) when it loses focus.
 */
export function usePaperStatusBar() {
  const t = usePaper()
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle(t.mode === "dark" ? "light" : "dark", true)
      return () => setStatusBarStyle("light", true)
    }, [t.mode])
  )
}
