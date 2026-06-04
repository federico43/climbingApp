import { PlacedHold, StartingHand } from "@/components/SprayWallBuilder"
import { C } from "@/utils/theme"
import { getDisplayRadius } from "@/utils/holdRadius"
import { wallPreviewUrl } from "@/services/BoulderGraphService"
import { useImageSize } from "@/utils/useImageSize"
import { Image } from "expo-image"
import React, { useEffect, useMemo, useState } from "react"
import { StyleSheet, Text, View, ViewStyle } from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"

const HAND_LABEL: Record<StartingHand, string> = { left: "L", right: "R", both: "LR" }

function computeDisplayNums(holds: PlacedHold[]): Map<string, { first: number; second?: number }> {
  const moves = holds
    .filter((h) => h.type === "move" && h.order != null)
    .sort((a, b) => a.order! - b.order!)
  const map = new Map<string, { first: number; second?: number }>()
  let counter = 1
  for (const h of moves) {
    map.set(h.id, { first: counter, second: h.match ? counter + 1 : undefined })
    counter += h.match ? 2 : 1
  }
  return map
}

function holdBadge(h: PlacedHold, displayNums: Map<string, { first: number; second?: number }>) {
  if (h.type === "start") return "S"
  if (h.type === "finish") return "★"
  if (h.type === "foot")   return "F"
  const dn = displayNums.get(h.id)
  if (!dn) return ""
  if (dn.second != null) {
    const handSuffix = dn.first === 1 && h.hand ? HAND_LABEL[h.hand] : ""
    return `${dn.first}${handSuffix},${dn.second}`
  }
  if (dn.first === 1 && h.hand) return `${dn.first}${HAND_LABEL[h.hand]}`
  return String(dn.first)
}

interface Props {
  imageSource: any
  holds: PlacedHold[]
  style?: ViewStyle
  freeGesture?: boolean
  // Thumbnails/previews pass interactive={false} to skip pinch/pan/double-tap
  // gestures and the animated transform — far cheaper when many are on screen.
  interactive?: boolean
  // Width (px) of the resized server preview to load. Thumbnails pass a small
  // value; full-screen viewers a larger one. Cuts download + decode hugely.
  previewWidth?: number
}

export function SprayWallViewer({ imageSource, holds, style, freeGesture, interactive = true, previewWidth = 1200 }: Props) {
  const [containerW, setContainerW] = useState(0)
  const [containerH, setContainerH] = useState(0)
  // Resize remote wall photos to a server-side preview (small, WebP). Bundled
  // requires / local files pass through unchanged.
  const source = useMemo(() => {
    if (imageSource && typeof imageSource === "object" && typeof imageSource.uri === "string") {
      return { uri: wallPreviewUrl(imageSource.uri, previewWidth) }
    }
    return imageSource
  }, [imageSource, previewWidth])
  const { nw, nh } = useImageSize(source)
  // expo-image reports the real dimensions on load (from its cache, so fast).
  // Prefer those over useImageSize's Image.getSize, which re-downloads the full
  // image — that's what made the wall briefly render at the wrong aspect ratio.
  const [loadedSize, setLoadedSize] = useState<{ w: number; h: number } | null>(null)
  const nwEff = loadedSize?.w ?? nw
  const nhEff = loadedSize?.h ?? nh
  const sourceKey = typeof source === "object" && source ? source.uri : source
  useEffect(() => { setLoadedSize(null) }, [sourceKey])

  const { imgW, imgH, imgLeft, imgTop } = useMemo(() => {
    if (!containerW || !containerH) return { imgW: 0, imgH: 0, imgLeft: 0, imgTop: 0 }
    const ia = nwEff / nhEff, ca = containerW / containerH
    let imgW: number, imgH: number
    if (ia > ca) { imgW = containerW; imgH = containerW / ia }
    else { imgH = containerH; imgW = containerH * ia }
    return { imgW, imgH, imgLeft: (containerW - imgW) / 2, imgTop: (containerH - imgH) / 2 }
  }, [containerW, containerH, nwEff, nhEff])

  const scale      = useSharedValue(1)
  const savedScale = useSharedValue(1)
  const tx         = useSharedValue(0)
  const ty         = useSharedValue(0)
  const savedTx    = useSharedValue(0)
  const savedTy    = useSharedValue(0)

  const pinch = Gesture.Pinch()
    .onUpdate((e) => { scale.value = Math.max(1, Math.min(6, savedScale.value * e.scale)) })
    .onEnd(() => { savedScale.value = scale.value })

  const pan = Gesture.Pan()
    .minPointers(freeGesture ? 1 : 2)
    .maxPointers(freeGesture ? 10 : 2)
    .onBegin(() => { savedTx.value = tx.value; savedTy.value = ty.value })
    .onUpdate((e) => { tx.value = savedTx.value + e.translationX; ty.value = savedTy.value + e.translationY })
    .onEnd(() => { savedTx.value = tx.value; savedTy.value = ty.value })

  const doubleTap = Gesture.Tap().numberOfTaps(2).onEnd(() => {
    scale.value = withTiming(1, { duration: 250 }); savedScale.value = 1
    tx.value    = withTiming(0, { duration: 250 }); savedTx.value    = 0
    ty.value    = withTiming(0, { duration: 250 }); savedTy.value    = 0
  })

  const gesture = Gesture.Race(
    doubleTap,
    Gesture.Simultaneous(pinch, pan)
  )

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }))

  const displayNums = useMemo(() => computeDisplayNums(holds), [holds])

  const BADGE_R    = 5
  const BADGE_H    = 18
  const BADGE_WRAP = 60  // fixed wrapper width so badge is centered at bx
  const BADGE_ANGLES = useMemo(
    () => [0, 180, -90, 90, -45, 45, -135, 135].map((d) => d * Math.PI / 180),
    []
  )

  const BADGE_CLEARANCE = 13  // half-size of a badge for badge-vs-badge spacing

  const badgeAngles = useMemo(() => {
    const result: Record<string, number> = {}
    const placed: Array<{ bx: number; by: number }> = []
    for (const hold of holds) {
      const cx   = hold.x * imgW + imgLeft
      const cy   = hold.y * imgH + imgTop
      const r    = getDisplayRadius(hold, imgW)
      const dist = r + BADGE_R
      let chosen   = BADGE_ANGLES[0]
      let chosenBx = cx + dist * Math.cos(chosen)
      let chosenBy = cy + dist * Math.sin(chosen)
      for (const angle of BADGE_ANGLES) {
        const bx = cx + dist * Math.cos(angle)
        const by = cy + dist * Math.sin(angle)
        const holdConflict = holds.some((other) => {
          if (other.id === hold.id) return false
          const ocx = other.x * imgW + imgLeft
          const ocy = other.y * imgH + imgTop
          const or  = getDisplayRadius(other, imgW)
          return Math.sqrt((bx - ocx) ** 2 + (by - ocy) ** 2) < or + BADGE_R
        })
        const badgeConflict = placed.some(({ bx: pbx, by: pby }) =>
          Math.sqrt((bx - pbx) ** 2 + (by - pby) ** 2) < BADGE_CLEARANCE * 2
        )
        if (!holdConflict && !badgeConflict) {
          chosen   = angle
          chosenBx = bx
          chosenBy = by
          break
        }
      }
      result[hold.id] = chosen
      placed.push({ bx: chosenBx, by: chosenBy })
    }
    return result
  }, [holds, imgW, imgH, imgLeft, imgTop, BADGE_ANGLES])

  const inner = (
    <View
      style={[styles.container, style]}
      onLayout={(e) => {
        setContainerW(e.nativeEvent.layout.width)
        setContainerH(e.nativeEvent.layout.height)
      }}
    >
      {/* Same render in both modes — static previews just skip the gesture
          detector below (its native handlers are the real per-thumbnail cost). */}
      <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]}>
        {imgW > 0 && (
            <>
              <Image
                source={source}
                style={{ position: "absolute", left: imgLeft, top: imgTop, width: imgW, height: imgH }}
                contentFit="fill"
                cachePolicy="memory-disk"
                transition={150}
                onLoad={(e) => {
                  const s: any = e?.source
                  if (s?.width && s?.height) setLoadedSize({ w: s.width, h: s.height })
                }}
              />
              <View
                pointerEvents="none"
                style={{ position: "absolute", left: imgLeft, top: imgTop, width: imgW, height: imgH, backgroundColor: "rgba(0,0,0,0.58)" }}
              />

              {holds.map((hold) => {
                const cx = hold.x * imgW + imgLeft
                const cy = hold.y * imgH + imgTop
                const r  = getDisplayRadius(hold, imgW)
                const angle = badgeAngles[hold.id] ?? (-45 * Math.PI / 180)
                const dist  = r + BADGE_R
                const bx    = cx + dist * Math.cos(angle)
                const by    = cy + dist * Math.sin(angle)
                const badgeLabel = holdBadge(hold, displayNums)
                const badgeBg =
                  hold.type === "start"  ? C.green :
                  hold.type === "finish" ? C.yellow :
                  hold.type === "foot"   ? "#4FA3E0" :
                  "rgba(0,0,0,0.75)"
                const badgeFg = hold.type === "move" ? "#fff" : C.bg
                return (
                  <React.Fragment key={hold.id}>
                    <View pointerEvents="none"
                      style={{ position: "absolute", left: cx - r, top: cy - r }}
                    >
                      <View style={[styles.revealCircle, { width: r * 2, height: r * 2, borderRadius: r }]}>
                        <Image
                          source={source}
                          style={{
                            position: "absolute",
                            left: imgLeft - cx + r,
                            top:  imgTop  - cy + r,
                            width: imgW, height: imgH,
                          }}
                          contentFit="fill"
                          cachePolicy="memory-disk"
                        />
                      </View>
                    </View>
                    <View pointerEvents="none"
                      style={{
                        position: "absolute",
                        left: bx - BADGE_WRAP / 2,
                        top: by - BADGE_H / 2,
                        width: BADGE_WRAP,
                        height: BADGE_H,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <View style={[styles.viewerBadge, { backgroundColor: badgeBg }]}>
                        <Text style={[styles.badgeText, { color: badgeFg }]}>{badgeLabel}</Text>
                      </View>
                    </View>
                  </React.Fragment>
                )
              })}
            </>
        )}
      </Animated.View>
    </View>
  )

  // Static previews skip the gesture detector entirely.
  if (!interactive) return inner
  return <GestureDetector gesture={gesture}>{inner}</GestureDetector>
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "transparent", overflow: "hidden" },

  revealCircle: { overflow: "hidden", borderColor: "rgba(255,255,255,0.5)", borderWidth: 2 },
  viewerBadge: {
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: 8, paddingHorizontal: 5, paddingVertical: 2,
  },
  badgeText: { color: "#fff", fontSize: 9, fontWeight: "800" },
})
