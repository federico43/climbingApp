import { C } from "@/utils/theme"
import { getDisplayRadius, pixelsToFractionRadius } from "@/utils/holdRadius"
import { useImageSize } from "@/utils/useImageSize"
import {
  VARIATION_KEYS,
  VARIATION_LABEL,
  ROUTE_TYPES,
  ROUTE_TYPE_LABEL,
  clampLevel,
  type VariationKey,
  type RouteVariations,
} from "@/utils/sequenceVariations"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"
import React, { useMemo, useRef, useState } from "react"
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from "react-native"
import { Image } from "expo-image"
import { useSafeAreaInsets } from "react-native-safe-area-context"

// ─── Resize slider ────────────────────────────────────────────────────────────

const RADIUS_MIN = 5
const RADIUS_MAX = 60

function ResizeSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [trackW, setTrackW] = useState(1)
  const fraction = (value - RADIUS_MIN) / (RADIUS_MAX - RADIUS_MIN)

  const sliderPan = Gesture.Pan()
    .runOnJS(true)
    .onUpdate((e) => {
      const frac = Math.max(0, Math.min(1, e.x / trackW))
      onChange(Math.round(RADIUS_MIN + frac * (RADIUS_MAX - RADIUS_MIN)))
    })

  return (
    <GestureDetector gesture={sliderPan}>
      <View style={sliderStyles.track} onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}>
        <View style={[sliderStyles.fill, { width: `${fraction * 100}%` }]} />
        <View style={[sliderStyles.thumb, { left: `${fraction * 100}%` }]} />
      </View>
    </GestureDetector>
  )
}

const sliderStyles = StyleSheet.create({
  track: { flex: 1, height: 4, backgroundColor: "#333", borderRadius: 2, justifyContent: "center" },
  fill:  { height: 4, backgroundColor: C.green, borderRadius: 2 },
  thumb: {
    position: "absolute", width: 22, height: 22, borderRadius: 11,
    backgroundColor: "#fff", marginLeft: -11, top: -9,
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 4, elevation: 4,
  },
})

// ─── Types ────────────────────────────────────────────────────────────────────

export type HoldType = "start" | "move" | "finish" | "foot"

export type StartingHand = "left" | "right" | "both"

export interface PlacedHold {
  id: string
  x: number       // 0–1 fraction of rendered image width
  y: number       // 0–1 fraction of rendered image height
  radius: number
  type: HoldType
  order?: number
  hand?: StartingHand  // move hold #1 only
  match?: boolean      // move holds: both hands match on this hold
}

// Default hold radius as a fraction of the image width (~5%). Stored as a
// fraction so routes look identical across screen sizes (phone vs desktop).
const DEFAULT_RADIUS_FRACTION = 0.05

const TYPE_CONFIG: Record<HoldType, { label: string; symbol: string }> = {
  start:  { label: "Start",  symbol: "S" },
  move:   { label: "Move",   symbol: "①" },
  finish: { label: "Finish", symbol: "★" },
  foot:   { label: "Foot",   symbol: "F" },
}

const FOOT_COLOR = "#4FA3E0"

const HAND_LABEL: Record<StartingHand, string> = { left: "L", right: "R", both: "LR" }

// Display numbers account for match holds occupying two move slots.
// e.g. holds [1, 2, 3(match), 4] → display [1, 2, "3,4", 5]
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
  if (h.type === "start")  return "S"
  if (h.type === "finish") return "★"
  if (h.type === "foot")   return "F"
  const dn = displayNums.get(h.id)
  if (!dn) return ""
  if (dn.second != null) {
    // match hold — show both numbers, hand suffix on first if applicable
    const handSuffix = dn.first === 1 && h.hand ? HAND_LABEL[h.hand] : ""
    return `${dn.first}${handSuffix},${dn.second}`
  }
  if (dn.first === 1 && h.hand) return `${dn.first}${HAND_LABEL[h.hand]}`
  return String(dn.first)
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  imageSource: any
  initialHolds?: PlacedHold[]
  initialName?: string
  initialVariations?: RouteVariations
  initialLevel?: number
  initialType?: string
  saving?: boolean
  onBack?: () => void
  onSave?: (name: string, data: { variations: RouteVariations; level: number; type: string }) => void
}

export function SprayWallBuilder({ imageSource, initialHolds = [], initialName = "", initialVariations, initialLevel, initialType, saving = false, onBack, onSave }: Props) {
  const insets = useSafeAreaInsets()
  // The three variations of this route; `holds` always mirrors the active one.
  const initialVars: RouteVariations = initialVariations ?? { original: initialHolds }
  const [variations, setVariations] = useState<RouteVariations>(initialVars)
  const [activeVariation, setActiveVariation] = useState<VariationKey>("original")
  const [routeLevel, setRouteLevel] = useState<number>(clampLevel(initialLevel ?? 4))
  const [routeType, setRouteType] = useState<string>(initialType ?? "base")

  const [containerW, setContainerW] = useState(0)
  const [containerH, setContainerH] = useState(0)
  const [holds, setHolds] = useState<PlacedHold[]>(initialVars.original ?? [])
  const [activeType, setActiveType] = useState<HoldType>("move")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [routeName, setRouteName] = useState(initialName)
  const [ghostHold, setGhostHold] = useState<{ x: number; y: number; radius: number } | null>(null)
  const moveCount    = useRef((initialVars.original ?? []).filter(h => h.type === "move").length)
  const isDragging   = useRef(false)
  const isDrawing    = useRef(false)
  const dragStart    = useRef({ x: 0, y: 0 })
  const dragHoldId   = useRef<string | null>(null)
  const drawOrigin   = useRef({ x: 0, y: 0 })   // image-fraction coords of draw start
  const ghostRef     = useRef<{ x: number; y: number; radius: number } | null>(null)
  const { nw, nh } = useImageSize(imageSource)
  // expo-image reports the real dimensions on load (from its cache, reliable on
  // iPad where Image.getSize can fail and fall back to 1×1 → a square render).
  const [loadedSize, setLoadedSize] = useState<{ w: number; h: number } | null>(null)
  const nwEff = loadedSize?.w || nw
  const nhEff = loadedSize?.h || nh

  // ── Image rect ─────────────────────────────────────────────────────────────
  const { imgW, imgH, imgLeft, imgTop } = useMemo(() => {
    if (!containerW || !containerH) return { imgW: 0, imgH: 0, imgLeft: 0, imgTop: 0 }
    const ia = nwEff / nhEff, ca = containerW / containerH
    let imgW: number, imgH: number
    if (ia > ca) { imgW = containerW;  imgH = containerW / ia  }
    else         { imgH = containerH;  imgW = containerH * ia  }
    return { imgW, imgH, imgLeft: (containerW - imgW) / 2, imgTop: (containerH - imgH) / 2 }
  }, [containerW, containerH, nwEff, nhEff])

  // ── Zoom shared values ─────────────────────────────────────────────────────
  const scale      = useSharedValue(1)
  const savedScale = useSharedValue(1)
  const tx         = useSharedValue(0)
  const ty         = useSharedValue(0)
  const savedTx    = useSharedValue(0)
  const savedTy    = useSharedValue(0)

  // Container size on the UI thread (needed for focal-point zoom math)
  const containerWS = useSharedValue(0)
  const containerHS = useSharedValue(0)

  // Snapshot of transform at the START of each pinch (so focal math uses stable origin)
  const pinchStartScale = useSharedValue(1)
  const pinchStartTx    = useSharedValue(0)
  const pinchStartTy    = useSharedValue(0)

  // ── Undo / Redo ────────────────────────────────────────────────────────────
  const holdsHistory = useRef<PlacedHold[][]>([initialVars.original ?? []])
  const historyIdx   = useRef(0)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  /** Push a new holds snapshot and mark undo available. */
  function pushToHistory(newHolds: PlacedHold[]) {
    holdsHistory.current = holdsHistory.current.slice(0, historyIdx.current + 1)
    holdsHistory.current.push(newHolds)
    historyIdx.current = holdsHistory.current.length - 1
  }

  function undo() {
    if (historyIdx.current <= 0) return
    historyIdx.current--
    const snapshot = holdsHistory.current[historyIdx.current]
    setHolds(snapshot)
    moveCount.current = snapshot.filter((h) => h.type === "move").length
    setSelectedId(null)
    setCanUndo(historyIdx.current > 0)
    setCanRedo(true)
  }

  function redo() {
    if (historyIdx.current >= holdsHistory.current.length - 1) return
    historyIdx.current++
    const snapshot = holdsHistory.current[historyIdx.current]
    setHolds(snapshot)
    moveCount.current = snapshot.filter((h) => h.type === "move").length
    setSelectedId(null)
    setCanUndo(true)
    setCanRedo(historyIdx.current < holdsHistory.current.length - 1)
  }

  // Switch which variation we're editing. Stash the current holds into the
  // active slot, load the target slot, and reset undo history to that slot.
  // An empty Easier/Harder slot is seeded with a copy of the Original (fresh
  // hold ids), so the coach just nudges the circles instead of redrawing.
  function switchVariation(key: VariationKey) {
    if (key === activeVariation) return
    setVariations((prev) => ({ ...prev, [activeVariation]: holds }))

    const existing = (variations[key] ?? []) as PlacedHold[]
    let nextHolds: PlacedHold[]
    if (existing.length > 0) {
      nextHolds = existing
    } else if (key !== "original") {
      const originalHolds = activeVariation === "original" ? holds : (variations.original ?? [])
      nextHolds = originalHolds.map((h) => ({ ...h, id: Math.random().toString(36).slice(2) }))
    } else {
      nextHolds = variations.original ?? []
    }

    setActiveVariation(key)
    setHolds(nextHolds)
    holdsHistory.current = [nextHolds]
    historyIdx.current = 0
    setCanUndo(false)
    setCanRedo(false)
    moveCount.current = nextHolds.filter((h) => h.type === "move").length
    setSelectedId(null)
  }

  function handleSave() {
    if (saving) return
    const finalVariations: RouteVariations = { ...variations, [activeVariation]: holds }
    if (!finalVariations.original) finalVariations.original = []
    onSave?.(routeName, { variations: finalVariations, level: routeLevel, type: routeType })
  }

  // Convert container-space point to image-space (undoing current transform)
  function toImageSpace(px: number, py: number) {
    const s  = scale.value
    const cw = containerW, ch = containerH
    const ux = (px - tx.value - cw / 2) / s + cw / 2
    const uy = (py - ty.value - ch / 2) / s + ch / 2
    return { ux, uy }
  }

  // ── Gestures ───────────────────────────────────────────────────────────────

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      // Snapshot the transform at the start of this pinch so focal math
      // stays consistent even if the user keeps zooming without lifting fingers
      pinchStartScale.value = scale.value
      pinchStartTx.value    = tx.value
      pinchStartTy.value    = ty.value
    })
    .onUpdate((e) => {
      const newScale = Math.max(1, Math.min(6, pinchStartScale.value * e.scale))
      const cx = containerWS.value / 2
      const cy = containerHS.value / 2
      // Keep the focal point (midpoint between the two fingers) fixed on screen:
      // newTx = focalX - cx - (focalX - startTx - cx) / startScale * newScale
      tx.value = e.focalX - cx - (e.focalX - pinchStartTx.value - cx) / pinchStartScale.value * newScale
      ty.value = e.focalY - cy - (e.focalY - pinchStartTy.value - cy) / pinchStartScale.value * newScale
      scale.value = newScale
    })
    .onEnd(() => {
      savedScale.value = scale.value
      savedTx.value    = tx.value
      savedTy.value    = ty.value
    })

  // Two-finger pan — moves the image. Runs on UI thread (only touches shared values).
  const imagePan = Gesture.Pan()
    .minPointers(2)
    .onBegin(() => {
      savedTx.value = tx.value
      savedTy.value = ty.value
    })
    .onUpdate((e) => {
      tx.value = savedTx.value + e.translationX
      ty.value = savedTy.value + e.translationY
    })
    .onEnd(() => {
      savedTx.value = tx.value
      savedTy.value = ty.value
    })

  // Single-finger pan — only draws new holds on empty space.
  // Touching an existing hold does nothing here; holdDragPan handles that.
  const drawPan = Gesture.Pan()
    .minPointers(1)
    .maxPointers(1)
    .runOnJS(true)
    .onBegin((e) => {
      isDrawing.current = false
      const { ux, uy } = toImageSpace(e.x, e.y)

      // If the finger landed on any hold, skip — long-press drag will handle it
      if (imgW > 0) {
        const onAnyHold = holds.some((h) => {
          const cx = h.x * imgW + imgLeft
          const cy = h.y * imgH + imgTop
          return Math.sqrt((ux - cx) ** 2 + (uy - cy) ** 2) <= getDisplayRadius(h, imgW) + 12
        })
        if (onAnyHold) return
      }

      // Draw on empty image space
      if (imgW > 0 && ux >= imgLeft && ux <= imgLeft + imgW && uy >= imgTop && uy <= imgTop + imgH) {
        isDrawing.current = true
        const fx = (ux - imgLeft) / imgW
        const fy = (uy - imgTop)  / imgH
        drawOrigin.current = { x: fx, y: fy }
        const g = { x: fx, y: fy, radius: 0 }
        ghostRef.current = g
        setGhostHold(g)
      }
    })
    .onUpdate((e) => {
      if (!isDrawing.current) return
      const dx = e.translationX / scale.value
      const dy = e.translationY / scale.value
      const r  = Math.round(Math.min(RADIUS_MAX, Math.sqrt(dx * dx + dy * dy)))
      const g  = { ...drawOrigin.current, radius: r }
      ghostRef.current = g
      setGhostHold(g)
    })
    .onEnd(() => {
      if (isDrawing.current) {
        const g = ghostRef.current
        if (g && g.radius >= RADIUS_MIN) {
          const newId    = Math.random().toString(36).slice(2)
          const newOrder = activeType === "move" ? ++moveCount.current : undefined
          // Store radius as a fraction of image width so it scales across devices
          const radiusFraction = pixelsToFractionRadius(g.radius, imgW)
          setHolds((prev) => {
            const newHolds = [...prev, {
              id: newId, x: g.x, y: g.y, radius: radiusFraction,
              type: activeType, order: newOrder,
            }]
            pushToHistory(newHolds)
            return newHolds
          })
          setCanUndo(true)
          setCanRedo(false)
        }
        ghostRef.current = null
        setGhostHold(null)
        isDrawing.current = false
      }
    })
    .onFinalize(() => {
      if (isDrawing.current) {
        ghostRef.current = null
        setGhostHold(null)
        isDrawing.current = false
      }
    })

  // Press-and-drag — touch a hold, move your finger to reposition, release to drop.
  const holdDragPan = Gesture.Pan()
    .minPointers(1)
    .maxPointers(1)
    .runOnJS(true)
    .onBegin((e) => {
      dragHoldId.current = null
      isDragging.current = false
      if (!imgW) return
      const { ux, uy } = toImageSpace(e.x, e.y)
      // Find the topmost hold under the finger
      for (const hold of [...holds].reverse()) {
        const cx = hold.x * imgW + imgLeft
        const cy = hold.y * imgH + imgTop
        if (Math.sqrt((ux - cx) ** 2 + (uy - cy) ** 2) <= getDisplayRadius(hold, imgW) + 12) {
          dragHoldId.current = hold.id
          dragStart.current  = { x: hold.x, y: hold.y }
          break
        }
      }
    })
    .onStart(() => {
      // Long-press threshold reached — drag is now live
      if (!dragHoldId.current) return
      isDragging.current = true
    })
    .onUpdate((e) => {
      if (!isDragging.current || !dragHoldId.current || !imgW) return
      const dx = e.translationX / (scale.value * imgW)
      const dy = e.translationY / (scale.value * imgH)
      const nx = Math.max(0, Math.min(1, dragStart.current.x + dx))
      const ny = Math.max(0, Math.min(1, dragStart.current.y + dy))
      const snapId = dragHoldId.current
      setHolds((prev) => prev.map((h) => h.id === snapId ? { ...h, x: nx, y: ny } : h))
    })
    .onEnd((e) => {
      if (isDragging.current && dragHoldId.current && imgW) {
        const dx = e.translationX / (scale.value * imgW)
        const dy = e.translationY / (scale.value * imgH)
        const nx = Math.max(0, Math.min(1, dragStart.current.x + dx))
        const ny = Math.max(0, Math.min(1, dragStart.current.y + dy))
        const snapId = dragHoldId.current
        setHolds((prev) => {
          const newHolds = prev.map((h) => h.id === snapId ? { ...h, x: nx, y: ny } : h)
          pushToHistory(newHolds)
          return newHolds
        })
        setCanUndo(true)
        setCanRedo(false)
      }
      isDragging.current = false
      dragHoldId.current = null
    })
    .onFinalize(() => {
      isDragging.current = false
      dragHoldId.current = null
    })

  const doubleTap = Gesture.Tap().numberOfTaps(2).onEnd(() => {
    scale.value = withTiming(1, { duration: 250 }); savedScale.value = 1
    tx.value    = withTiming(0, { duration: 250 }); savedTx.value    = 0
    ty.value    = withTiming(0, { duration: 250 }); savedTy.value    = 0
  })

  function handleTap(tapX: number, tapY: number) {
    // The route-name field's keyboard only dismisses via its own "Done" key
    // (onSubmitEditing) — the screen is a plain View, not a ScrollView, so
    // there's no default tap-outside-to-dismiss the way ProjectPickerModal's
    // form gets for free. Tapping the wall (to place/select a hold or just
    // tap away) is the natural place to also close the keyboard, since
    // otherwise it can get stuck open with no way to put it away on iOS.
    Keyboard.dismiss()
    if (!imgW) return
    const { ux, uy } = toImageSpace(tapX, tapY)
    for (const hold of [...holds].reverse()) {
      const cx = hold.x * imgW + imgLeft
      const cy = hold.y * imgH + imgTop
      const hr = getDisplayRadius(hold, imgW)
      if (Math.sqrt((ux - cx) ** 2 + (uy - cy) ** 2) <= hr + 8) {
        setSelectedId((prev) => (prev === hold.id ? null : hold.id))
        return
      }
    }
    setSelectedId(null)
  }

  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .requireExternalGestureToFail(doubleTap)
    .runOnJS(true)
    .onEnd((e) => handleTap(e.x, e.y))

  const gesture = Gesture.Simultaneous(
    Gesture.Exclusive(doubleTap, singleTap),
    pinch,
    imagePan,
    holdDragPan,
    drawPan,
  )

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }))

  // ── Hold management ────────────────────────────────────────────────────────

  function deleteSelected() {
    const snapId = selectedId
    setHolds((prev) => {
      let i = 1
      const newHolds = prev
        .filter((h) => h.id !== snapId)
        .map((h) => h.type === "move" ? { ...h, order: i++ } : h)
      moveCount.current = newHolds.filter((h) => h.type === "move").length
      pushToHistory(newHolds)
      return newHolds
    })
    setSelectedId(null)
    setCanUndo(true)
    setCanRedo(false)
  }

  // The slider operates in PIXEL space (5–60px on the current display) so
  // resizing feels consistent. We convert to a fraction of imgW for storage.
  function updateRadius(pixelRadius: number) {
    const fraction = pixelsToFractionRadius(pixelRadius, imgW)
    setHolds((prev) => prev.map((h) => h.id === selectedId ? { ...h, radius: fraction } : h))
  }

  function updateHand(hand: StartingHand) {
    const snapId = selectedId
    setHolds((prev) => {
      const newHolds = prev.map((h) => h.id === snapId ? { ...h, hand } : h)
      pushToHistory(newHolds)
      return newHolds
    })
    setCanUndo(true)
    setCanRedo(false)
  }

  function toggleMatch() {
    const snapId = selectedId
    setHolds((prev) => {
      const newHolds = prev.map((h) => h.id === snapId ? { ...h, match: !h.match } : h)
      pushToHistory(newHolds)
      return newHolds
    })
    setCanUndo(true)
    setCanRedo(false)
  }

  const selectedHold = holds.find((h) => h.id === selectedId)

  const displayNums = useMemo(() => computeDisplayNums(holds), [holds])

  // For each hold, pick the first angle (top-right first) where the badge
  // doesn't overlap any other hold's circle. Stores the angle, not pixel coords —
  // pixel position is computed inline in render using the same cx/cy as the circle.
  const BADGE_R = 5, BADGE_GAP = 0, BADGE_H = 18, BADGE_WRAP = 60
  const BADGE_ANGLES = useMemo(
    () => [0, 180, -90, 90, -45, 45, -135, 135].map(d => d * Math.PI / 180),
    []
  )
  const BADGE_CLEARANCE = 13

  const badgeAnglesRef = useRef<Record<string, number>>({})
  const badgeAngles = useMemo(() => {
    // Dragging a hold calls setHolds every frame; recomputing this O(n²) layout
    // each frame causes lag. Reuse the last layout mid-drag — badges resettle
    // on drop, when the final setHolds re-runs this with isDragging cleared.
    if (isDragging.current) return badgeAnglesRef.current
    const result: Record<string, number> = {}
    const placed: Array<{ bx: number; by: number }> = []
    for (const hold of holds) {
      const cx = hold.x * imgW + imgLeft
      const cy = hold.y * imgH + imgTop
      const r  = getDisplayRadius(hold, imgW)
      const dist = r + BADGE_R + BADGE_GAP
      let chosen   = BADGE_ANGLES[0]
      let chosenBx = cx + dist * Math.cos(chosen)
      let chosenBy = cy + dist * Math.sin(chosen)
      for (const angle of BADGE_ANGLES) {
        const bx = cx + dist * Math.cos(angle)
        const by = cy + dist * Math.sin(angle)
        const holdConflict = holds.some(other => {
          if (other.id === hold.id) return false
          const ocx = other.x * imgW + imgLeft
          const ocy = other.y * imgH + imgTop
          const or  = getDisplayRadius(other, imgW)
          return Math.sqrt((bx - ocx) ** 2 + (by - ocy) ** 2) < or + BADGE_R + BADGE_GAP
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
    badgeAnglesRef.current = result
    return result
  }, [holds, imgW, imgH, imgLeft, imgTop, BADGE_ANGLES])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={styles.screen}>
      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 12 }]}>
        {/* Left: back + undo + redo */}
        <View style={styles.topBarLeft}>
          {onBack && (
            <Pressable onPress={onBack} hitSlop={10} style={styles.topBarIconBtn}>
              <Text style={styles.topBarBack}>←</Text>
            </Pressable>
          )}
          <Pressable onPress={undo} disabled={!canUndo} hitSlop={10} style={styles.topBarIconBtn}>
            <Text style={[styles.topBarAction, !canUndo && styles.topBarActionDisabled]}>↩</Text>
          </Pressable>
          <Pressable onPress={redo} disabled={!canRedo} hitSlop={10} style={styles.topBarIconBtn}>
            <Text style={[styles.topBarAction, !canRedo && styles.topBarActionDisabled]}>↪</Text>
          </Pressable>
        </View>

        <TextInput value={routeName} onChangeText={setRouteName}
          placeholder="Route name..." placeholderTextColor="#555"
          style={styles.topBarInput} returnKeyType="done"
          onSubmitEditing={() => Keyboard.dismiss()} />

        {/* Right: save */}
        <View style={[styles.topBarRight]}>
          <Pressable onPress={handleSave}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={[styles.saveText, saving && { opacity: 0.4 }]}>
              {saving ? "Saving…" : "Save"}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Meta bar — variations / level / type */}
      <View style={styles.metaBar}>
        <View style={styles.varTabs}>
          {VARIATION_KEYS.map((k) => {
            const isActive = activeVariation === k
            const hasHolds = isActive ? holds.length > 0 : (variations[k]?.length ?? 0) > 0
            return (
              <Pressable
                key={k}
                style={[styles.varTab, isActive && styles.varTabActive]}
                onPress={() => switchVariation(k)}
              >
                <Text style={[styles.varTabText, isActive && styles.varTabTextActive]}>
                  {VARIATION_LABEL[k]}
                </Text>
                {k !== "original" && hasHolds && <View style={styles.varDot} />}
              </Pressable>
            )
          })}
        </View>
        <View style={styles.metaRow}>
          <View style={styles.levelCtrl}>
            <Text style={styles.metaLabel}>Lvl</Text>
            <Pressable style={styles.stepBtn} onPress={() => setRouteLevel((l) => clampLevel(l - 1))}>
              <Text style={styles.stepTxt}>−</Text>
            </Pressable>
            <Text style={styles.levelVal}>{routeLevel}</Text>
            <Pressable style={styles.stepBtn} onPress={() => setRouteLevel((l) => clampLevel(l + 1))}>
              <Text style={styles.stepTxt}>+</Text>
            </Pressable>
          </View>
          <View style={styles.typeCtrl}>
            {ROUTE_TYPES.map((t) => (
              <Pressable
                key={t}
                style={[styles.typePill, routeType === t && styles.typePillActive]}
                onPress={() => setRouteType(t)}
              >
                <Text style={[styles.typePillTxt, routeType === t && styles.typePillTxtActive]}>
                  {ROUTE_TYPE_LABEL[t]}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      {/* Wall */}
      <GestureDetector gesture={gesture}>
        <View style={styles.imageContainer}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width
            const h = e.nativeEvent.layout.height
            setContainerW(w)
            setContainerH(h)
            containerWS.value = w
            containerHS.value = h
          }}
        >
          <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]}>
            {imgW > 0 && (
              <>
                <Image source={imageSource}
                  style={{ position: "absolute", left: imgLeft, top: imgTop, width: imgW, height: imgH }}
                  contentFit="fill"
                  cachePolicy="memory-disk"
                  onLoad={(e) => {
                    const s: any = e?.source
                    if (s?.width && s?.height) setLoadedSize({ w: s.width, h: s.height })
                  }}
                />
                <View style={styles.darkOverlay} pointerEvents="none" />

                {holds.map((hold) => {
                  const cx = hold.x * imgW + imgLeft
                  const cy = hold.y * imgH + imgTop
                  const r  = getDisplayRadius(hold, imgW)
                  const isSelected = hold.id === selectedId

                  return (
                    <React.Fragment key={hold.id}>
                      {/* Reveal circle */}
                      <View pointerEvents="none"
                        style={{ position: "absolute", left: cx - r, top: cy - r }}
                      >
                        <View style={[styles.revealCircle, {
                          width: r * 2, height: r * 2, borderRadius: r,
                          borderColor: isSelected ? "#FFD700" : "rgba(255,255,255,0.5)",
                          borderWidth: isSelected ? 3 : 2,
                        }]}>
                          <Image source={imageSource}
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

                      {/* Badge — fixed-width wrapper centered at bx/by so the badge
                           is always visually centered regardless of its text width */}
                      {(() => {
                        const angle = badgeAngles[hold.id] ?? BADGE_ANGLES[0]
                        const dist  = r + BADGE_R + BADGE_GAP
                        const bx    = cx + dist * Math.cos(angle)
                        const by    = cy + dist * Math.sin(angle)
                        const badgeLabel = holdBadge(hold, displayNums)
                        const badgeBg =
                          hold.type === "start"  ? C.green :
                          hold.type === "finish" ? C.yellow :
                          hold.type === "foot"   ? FOOT_COLOR :
                          "rgba(0,0,0,0.75)"
                        const badgeFg = hold.type === "move" ? "#fff" : C.bg
                        // Scale the badge with the circle so small holds get small numbers.
                        const badgeFont = Math.max(6, Math.min(12, r * 0.5))
                        return (
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
                            <View style={[styles.badge, {
                              backgroundColor: badgeBg,
                              paddingHorizontal: badgeFont * 0.55,
                              paddingVertical: badgeFont * 0.22,
                              borderRadius: badgeFont,
                            }]}>
                              <Text style={[styles.badgeText, { color: badgeFg, fontSize: badgeFont }]}>{badgeLabel}</Text>
                            </View>
                          </View>
                        )
                      })()}
                    </React.Fragment>
                  )
                })}

                {/* Ghost hold — shown while drag-drawing a new hold */}
                {ghostHold && (() => {
                  const r  = Math.max(1, ghostHold.radius)
                  const cx = ghostHold.x * imgW + imgLeft
                  const cy = ghostHold.y * imgH + imgTop
                  return (
                    <View pointerEvents="none"
                      style={{ position: "absolute", left: cx - r, top: cy - r }}
                    >
                      <View style={[styles.revealCircle, {
                        width: r * 2, height: r * 2, borderRadius: r,
                        borderColor: "rgba(255,255,255,0.85)",
                        borderWidth: 2,
                        opacity: 0.7,
                      }]}>
                        <Image source={imageSource}
                          style={{ position: "absolute", left: imgLeft - cx + r, top: imgTop - cy + r, width: imgW, height: imgH }}
                          contentFit="fill"
                          cachePolicy="memory-disk"
                        />
                      </View>
                    </View>
                  )
                })()}
              </>
            )}
          </Animated.View>
        </View>
      </GestureDetector>

      {/* Bottom controls — typePicker always stays in flow */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.typePicker}>
          {(["start", "move", "finish", "foot"] as HoldType[]).map((t) => {
            const isActive = activeType === t
            return (
              <Pressable key={t}
                style={[styles.typeBtn, isActive && styles.typeBtnActive]}
                onPress={() => setActiveType(t)}>
                <Text style={styles.typeSymbol}>{TYPE_CONFIG[t].symbol}</Text>
                <Text style={[styles.typeLabel, isActive && styles.typeLabelActive]}>
                  {TYPE_CONFIG[t].label}
                </Text>
              </Pressable>
            )
          })}
        </View>
      </View>

      {/* Selected hold menu — absolute overlay so the wall doesn't shift */}
      {selectedHold && (
        <View style={[styles.selectedOverlay, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.selectedControls}>
            <View style={styles.sliderRow}>
              <Text style={styles.sliderLabel}>Size</Text>
              <ResizeSlider value={getDisplayRadius(selectedHold, imgW)} onChange={updateRadius} />
            </View>

            {selectedHold.type === "move" && selectedHold.order === 1 && (
              <View style={styles.handRow}>
                <Text style={styles.sliderLabel}>Hand</Text>
                <View style={styles.handPicker}>
                  {(["left", "right"] as StartingHand[]).map((h) => {
                    const isActive = selectedHold.hand === h
                    return (
                      <Pressable
                        key={h}
                        style={[styles.handBtn, isActive && styles.handBtnActive]}
                        onPress={() => updateHand(h)}
                      >
                        <Text style={[styles.handBtnText, isActive && styles.handBtnTextActive]}>
                          {h === "left" ? "Left" : "Right"}
                        </Text>
                      </Pressable>
                    )
                  })}
                </View>
              </View>
            )}

            {selectedHold.type === "move" && (
              <Pressable
                style={[styles.matchBtn, selectedHold.match && styles.matchBtnActive]}
                onPress={toggleMatch}
              >
                <Text style={[styles.matchBtnText, selectedHold.match && styles.matchBtnTextActive]}>
                  {selectedHold.match ? "Match ✓" : "Match"}
                </Text>
              </Pressable>
            )}

            <Pressable style={styles.removeBtn} onPress={deleteSelected}>
              <Text style={styles.removeBtnText}>Remove hold</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },

  topBar: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingVertical: 12,
    backgroundColor: "#0a0a0a",
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#2a2a2a",
  },
  topBarLeft:  { flexDirection: "row", alignItems: "center", width: 88 },
  topBarRight: { width: 48, alignItems: "flex-end" },
  topBarIconBtn: { paddingHorizontal: 4 },
  topBarBack:   { fontSize: 22, color: "#fff", opacity: 0.55 },
  topBarAction: { fontSize: 20, color: "#fff", opacity: 0.7 },
  topBarActionDisabled: { opacity: 0.2 },
  topBarInput: {
    flex: 1, textAlign: "center",
    fontSize: 15, fontWeight: "600", color: "#fff", paddingVertical: 4,
  },
  saveText: { fontSize: 15, fontWeight: "700", color: C.green },

  // Meta bar
  metaBar: {
    backgroundColor: "#0a0a0a", paddingHorizontal: 12, paddingBottom: 10, gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#2a2a2a",
  },
  varTabs: { flexDirection: "row", gap: 8 },
  varTab: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 9, borderRadius: 12, backgroundColor: "#1c1c1c",
  },
  varTabActive: { backgroundColor: C.green },
  varTabText: { fontSize: 13, fontWeight: "700", color: "#888" },
  varTabTextActive: { color: C.bg },
  varDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.green },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  levelCtrl: { flexDirection: "row", alignItems: "center", gap: 8 },
  metaLabel: { fontSize: 12, fontWeight: "700", color: "#666", textTransform: "uppercase" },
  stepBtn: {
    width: 30, height: 30, borderRadius: 8, backgroundColor: "#1c1c1c",
    alignItems: "center", justifyContent: "center",
  },
  stepTxt: { fontSize: 18, fontWeight: "700", color: "#fff" },
  levelVal: { fontSize: 16, fontWeight: "800", color: "#fff", minWidth: 20, textAlign: "center" },
  typeCtrl: { flexDirection: "row", gap: 6 },
  typePill: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: "#1c1c1c",
  },
  typePillActive: { backgroundColor: C.greenDeep, borderWidth: 1, borderColor: C.green },
  typePillTxt: { fontSize: 12, fontWeight: "600", color: "#888" },
  typePillTxtActive: { color: C.green },

  imageContainer: { flex: 1, overflow: "hidden" },
  darkOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.58)" },

  revealCircle: { overflow: "hidden" },
  badge: {
    position: "absolute",
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: 8, paddingHorizontal: 5, paddingVertical: 2,
  },
  badgeText: { color: "#fff", fontSize: 9, fontWeight: "800" },

  controls: {
    backgroundColor: "#0f0f0f",
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16,
  },
  selectedOverlay: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: "#0f0f0f",
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16,
  },
  typePicker: { flexDirection: "row", gap: 10 },
  typeBtn: {
    flex: 1, flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 7, paddingVertical: 14,
    borderRadius: 14, backgroundColor: "#1c1c1c",
  },
  typeBtnActive: { backgroundColor: C.green },
  typeSymbol: { fontSize: 16, color: "#fff" },
  typeLabel: { fontSize: 14, fontWeight: "600", color: "#666" },
  typeLabelActive: { color: C.bg },

  selectedControls: { gap: 14 },
  sliderRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  sliderLabel: { fontSize: 13, fontWeight: "600", color: "#666", width: 36 },
  handRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  handPicker: { flex: 1, flexDirection: "row", gap: 8 },
  handBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    backgroundColor: "#1c1c1c", alignItems: "center",
  },
  handBtnActive: { backgroundColor: C.green },
  handBtnText: { fontSize: 13, fontWeight: "600", color: "#666" },
  handBtnTextActive: { color: C.bg },
  matchBtn: {
    paddingVertical: 12, borderRadius: 12, alignItems: "center",
    borderWidth: 1.5, borderColor: "#333", backgroundColor: "#1c1c1c",
  },
  matchBtnActive: { backgroundColor: C.greenDeep, borderColor: C.green },
  matchBtnText: { fontSize: 14, fontWeight: "600", color: "#555" },
  matchBtnTextActive: { color: C.green },
  removeBtn: {
    backgroundColor: C.red, borderRadius: 12,
    paddingHorizontal: 20, paddingVertical: 12, alignItems: "center",
  },
  removeBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
})
