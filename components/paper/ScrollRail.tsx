import { usePaper } from "@/theme/paper/PaperThemeProvider"
import { font } from "@/theme/paper/tokens"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { Ionicons } from "@expo/vector-icons"
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import Animated, {
  Easing,
  SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated"

// Scroll rail (docs/design-system.md §5): a hint on long screens that turns
// into a position indicator after the first scroll, with ticks that jump to
// the screen's main sections.

const SEEN_KEY = "paper-scroll-hint-seen"
const THUMB_H = 24
const LOOP_MS = 2400

type Anchor = { label: string; y: number }

type RailCtx = {
  register: (label: string, y: number | null) => void
  contentRef: React.RefObject<View | null>
}

const RailContext = createContext<RailCtx | null>(null)

/** Marks a section the rail can jump to ("Jump to homework"). */
export function RailAnchor({ label, children }: { label: string; children: React.ReactNode }) {
  const ctx = useContext(RailContext)
  const ref = useRef<View>(null)
  useEffect(() => () => ctx?.register(label, null), [ctx, label])
  const onLayout = () => {
    const content = ctx?.contentRef.current
    if (!ctx || !content || !ref.current) return
    ref.current.measureLayout(content, (_x, y) => ctx.register(label, y), () => {})
  }
  return (
    <View ref={ref} onLayout={onLayout} collapsable={false}>
      {children}
    </View>
  )
}

/** State + handlers PaperScreen wires into its ScrollView. */
export function useScrollRail() {
  const scrollRef = useRef<ScrollView>(null)
  const contentRef = useRef<View>(null)
  const scrollY = useSharedValue(0)
  const [contentH, setContentH] = useState(0)
  const [viewportH, setViewportH] = useState(0)
  const [anchors, setAnchors] = useState<Record<string, number>>({})
  const [seen, setSeen] = useState<boolean | null>(null)

  useEffect(() => {
    AsyncStorage.getItem(SEEN_KEY).then((v) => setSeen(v === "1")).catch(() => setSeen(false))
  }, [])

  const register = useCallback((label: string, y: number | null) => {
    setAnchors((cur) => {
      if (y == null) {
        if (!(label in cur)) return cur
        const { [label]: _gone, ...rest } = cur
        return rest
      }
      return cur[label] === y ? cur : { ...cur, [label]: y }
    })
  }, [])

  const onScroll = useCallback(
    (y: number) => {
      scrollY.value = y
      if (y > 8 && seen === false) {
        setSeen(true)
        AsyncStorage.setItem(SEEN_KEY, "1").catch(() => {})
      }
    },
    [scrollY, seen]
  )

  return {
    scrollRef, contentRef, scrollY, contentH, setContentH, viewportH, setViewportH,
    anchors: Object.entries(anchors).map(([label, y]) => ({ label, y })).sort((a, b) => a.y - b.y),
    seen, onScroll, ctx: { register, contentRef } as RailCtx,
  }
}

export function RailProvider({ value, children }: { value: RailCtx; children: React.ReactNode }) {
  return <RailContext.Provider value={value}>{children}</RailContext.Provider>
}

type RailProps = {
  scrollY: SharedValue<number>
  contentH: number
  viewportH: number
  anchors: Anchor[]
  /** null while the stored flag loads. */
  seen: boolean | null
  onJump: (y: number) => void
  /** Distance from the top of the scroll area (just below the headline). */
  top: number
  bottom: number
}

/** The rail itself, absolutely placed on the right edge, inside the gutter. */
export function ScrollRail({ scrollY, contentH, viewportH, anchors, seen, onJump, top, bottom }: RailProps) {
  const t = usePaper()
  const reduced = useReducedMotion()
  const [trackH, setTrackH] = useState(0)
  const hint = seen === false
  const drip = useSharedValue(0)
  const chrome = useSharedValue(1)

  useEffect(() => {
    if (hint && !reduced) {
      drip.value = 0
      drip.value = withRepeat(withTiming(1, { duration: LOOP_MS, easing: Easing.in(Easing.quad) }), -1, false)
    } else {
      drip.value = 0
    }
  }, [hint, reduced, drip])

  useEffect(() => {
    chrome.value = withTiming(hint ? 1 : 0, { duration: 400 })
  }, [hint, chrome])

  const maxScroll = Math.max(1, contentH - viewportH)
  const travel = Math.max(0, trackH - THUMB_H)

  const thumbStyle = useAnimatedStyle(() => {
    if (hint && !reduced) {
      // Falls down the track and fades, then starts again.
      return { transform: [{ translateY: drip.value * travel }], opacity: 1 - drip.value * drip.value }
    }
    const p = Math.min(1, Math.max(0, scrollY.value / maxScroll))
    return { transform: [{ translateY: hint ? 0 : p * travel }], opacity: 1 }
  })
  const chromeStyle = useAnimatedStyle(() => ({ opacity: chrome.value }))
  const bobStyle = useAnimatedStyle(() => ({
    opacity: chrome.value,
    // Bobs in time with the drip: down while it falls, back up at the end.
    transform: [{ translateY: hint && !reduced ? Math.sin(drip.value * Math.PI) * 3 : 0 }],
  }))

  // Only on screens taller than the viewport.
  if (!viewportH || contentH <= viewportH + 4 || seen === null) return null

  const trackColor = t.mode === "dark" ? "rgba(255,255,255,0.25)" : "rgba(18,16,20,0.28)"
  const thumbGlow = t.glow ? { shadowColor: t.glow, shadowOpacity: 0.6, shadowRadius: 5, shadowOffset: { width: 0, height: 0 } } : null

  return (
    <View pointerEvents="box-none" style={{ position: "absolute", right: 3, top, bottom, width: 12, alignItems: "center" }}>
      {/* Vertical mono "SCROLL" */}
      <Animated.View style={[{ height: 52, width: 12, alignItems: "center", justifyContent: "center" }, chromeStyle]} pointerEvents="none">
        <Text
          style={{
            width: 52, textAlign: "center", fontFamily: font.mono, fontSize: 9, letterSpacing: 9 * 0.32,
            color: t.label, transform: [{ rotate: "90deg" }],
          }}
          numberOfLines={1}
        >
          SCROLL
        </Text>
      </Animated.View>

      <View style={{ flex: 1, width: 12, alignItems: "center", marginTop: 6 }} onLayout={(e) => setTrackH(e.nativeEvent.layout.height)}>
        <View style={{ position: "absolute", top: 0, bottom: 0, width: 1.5, backgroundColor: trackColor }} />
        {trackH > 0 &&
          anchors.map((a) => (
            <Pressable
              key={a.label}
              onPress={() => onJump(a.y)}
              hitSlop={{ top: 8, bottom: 8, left: 14, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel={`Jump to ${a.label.toLowerCase()}`}
              style={{ position: "absolute", top: Math.min(trackH - 2, (a.y / contentH) * trackH), width: 8, height: 1.5, backgroundColor: t.ink }}
            />
          ))}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute", top: 0, width: 6, height: THUMB_H, borderRadius: 3, backgroundColor: t.mint,
              borderWidth: 1.5, borderColor: t.mode === "dark" ? t.mint : t.ink,
            },
            thumbGlow,
            thumbStyle,
          ]}
        />
      </View>

      <Animated.View style={[{ marginTop: 6 }, bobStyle]} pointerEvents="none">
        <Ionicons name="chevron-down" size={12} color={t.ink} />
      </Animated.View>
    </View>
  )
}
