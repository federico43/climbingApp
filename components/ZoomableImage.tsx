// Fullscreen photo with pinch-to-zoom, pan while zoomed, double-tap to zoom
// in / reset, and (at 1×) a single tap or a swipe down to dismiss. Built on
// gesture-handler + reanimated so it works on Android too — ScrollView's
// maximumZoomScale, used before, is iOS-only.
//
// Meant to be rendered inside a RN <Modal>: on Android a Modal sits outside
// the app's GestureHandlerRootView, so this brings its own.

import React from "react"
import { StyleSheet, useWindowDimensions } from "react-native"
import { Image } from "expo-image"
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler"
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated"

const MAX_SCALE = 4
const DOUBLE_TAP_SCALE = 2.5
const DISMISS_DRAG = 120

export function ZoomableImage({ uri, onTap, onDismiss }: {
  uri: string
  onTap?: () => void       // single tap at 1× (e.g. back to the notes sheet)
  onDismiss?: () => void   // swipe down at 1×
}) {
  const { width, height } = useWindowDimensions()
  const scale = useSharedValue(1)
  const savedScale = useSharedValue(1)
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const savedTx = useSharedValue(0)
  const savedTy = useSharedValue(0)

  // Keep the zoomed image covering the screen: it can't be panned past its
  // own edges.
  function clamp(v: number, s: number, size: number) {
    "worklet"
    const max = Math.max(0, (size * s - size) / 2)
    return Math.min(max, Math.max(-max, v))
  }

  function reset() {
    "worklet"
    scale.value = withTiming(1)
    savedScale.value = 1
    tx.value = withTiming(0)
    ty.value = withTiming(0)
    savedTx.value = 0
    savedTy.value = 0
  }

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE * 1.2, Math.max(0.8, savedScale.value * e.scale))
    })
    .onEnd(() => {
      if (scale.value <= 1) { reset(); return }
      const s = Math.min(MAX_SCALE, scale.value)
      scale.value = withTiming(s)
      savedScale.value = s
      tx.value = withTiming(clamp(tx.value, s, width))
      ty.value = withTiming(clamp(ty.value, s, height))
      savedTx.value = clamp(tx.value, s, width)
      savedTy.value = clamp(ty.value, s, height)
    })

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((e) => {
      if (savedScale.value > 1) {
        tx.value = clamp(savedTx.value + e.translationX, scale.value, width)
        ty.value = clamp(savedTy.value + e.translationY, scale.value, height)
      } else {
        // At 1×: follow a downward drag, to dismiss.
        ty.value = Math.max(0, e.translationY)
      }
    })
    .onEnd((e) => {
      if (savedScale.value > 1) {
        savedTx.value = tx.value
        savedTy.value = ty.value
      } else if (e.translationY > DISMISS_DRAG && onDismiss) {
        runOnJS(onDismiss)()
      } else {
        ty.value = withTiming(0)
      }
    })

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      if (savedScale.value > 1) { reset(); return }
      // Zoom in around the tapped point (it stays under the finger).
      const s = DOUBLE_TAP_SCALE
      const x = clamp((width / 2 - e.x) * (s - 1), s, width)
      const y = clamp((height / 2 - e.y) * (s - 1), s, height)
      scale.value = withTiming(s)
      savedScale.value = s
      tx.value = withTiming(x)
      ty.value = withTiming(y)
      savedTx.value = x
      savedTy.value = y
    })

  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .requireExternalGestureToFail(doubleTap)
    .onEnd(() => {
      if (savedScale.value <= 1 && onTap) runOnJS(onTap)()
    })

  const gesture = Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, singleTap))

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }))

  return (
    <GestureHandlerRootView style={styles.root}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[{ width, height }, animatedStyle]}>
          <Image source={{ uri }} style={{ width, height }} contentFit="contain" />
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
})
