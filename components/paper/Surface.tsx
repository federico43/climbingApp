import { usePaper } from "@/theme/paper/PaperThemeProvider"
import { space } from "@/theme/paper/tokens"
import { useFocusEffect } from "@react-navigation/native"
import { setStatusBarStyle } from "expo-status-bar"
import React, { useCallback, useMemo } from "react"
import { Image, ScrollView, ScrollViewProps, StyleProp, StyleSheet, useWindowDimensions, View, ViewStyle } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { RailProvider, ScrollRail, useScrollRail } from "./ScrollRail"
import Svg, { Defs, Ellipse, RadialGradient, Rect, Stop } from "react-native-svg"

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

// Soft glows behind a title, drawn to an exact box (mock-ups 2026-11-25:
// the phone builder's header and the block sheet). Unlike the melt PNG it
// never spills over the content under the title: the box is its limit.
// "header": blue-violet at the top right, mint under it. "sheet": mint in
// the middle, blue at the right edge.
type Glow = { cx: number; cy: number; rx: number; ry: number; color: string; a: number }
const GLOWS: Record<"header" | "sheet", Glow[]> = {
  header: [
    { cx: 0.92, cy: 0.2, rx: 0.42, ry: 0.75, color: "#3A46FF", a: 0.55 },
    { cx: 1.0, cy: 0.05, rx: 0.2, ry: 0.4, color: "#7A2BD8", a: 0.35 },
    { cx: 0.6, cy: 0.62, rx: 0.42, ry: 0.5, color: "#6FDC98", a: 0.5 },
  ],
  sheet: [
    { cx: 0.5, cy: 0.5, rx: 0.42, ry: 0.42, color: "#6FDC98", a: 0.55 },
    { cx: 0.98, cy: 0.55, rx: 0.28, ry: 0.55, color: "#3A46FF", a: 0.5 },
  ],
}

export function TitleGlow({ width, height, variant = "header", top = 0 }: { width: number; height: number; variant?: "header" | "sheet"; top?: number }) {
  const t = usePaper()
  const boost = t.mode === "dark" ? 1.25 : 1
  return (
    <Svg pointerEvents="none" width={width} height={height} style={{ position: "absolute", left: 0, top }}>
      <Defs>
        {GLOWS[variant].map((g, i) => (
          <RadialGradient key={i} id={`tg-${variant}-${i}`} cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor={g.color} stopOpacity={Math.min(1, g.a * boost)} />
            <Stop offset="0.55" stopColor={g.color} stopOpacity={Math.min(1, g.a * boost * 0.45)} />
            <Stop offset="1" stopColor={g.color} stopOpacity={0} />
          </RadialGradient>
        ))}
      </Defs>
      {GLOWS[variant].map((g, i) => (
        <Ellipse key={i} cx={g.cx * width} cy={g.cy * height} rx={g.rx * width} ry={g.ry * height} fill={`url(#tg-${variant}-${i})`} />
      ))}
    </Svg>
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
 * Status bar text that reads on this screen's paper while it's focused.
 * `dark` = the screen is dark whatever the theme (the class calendar).
 * On blur it goes back to the app's paper, which every other screen uses.
 */
export function usePaperStatusBar(opts?: { dark?: boolean }) {
  const t = usePaper()
  const dark = opts?.dark
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle(dark || t.mode === "dark" ? "light" : "dark", true)
      return () => setStatusBarStyle(t.mode === "dark" ? "light" : "dark", true)
    }, [t.mode, dark])
  )
}
