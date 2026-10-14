import { C } from "@/utils/theme"
import { LinearGradient } from "expo-linear-gradient"
import { useEffect } from "react"
import { StyleSheet, useWindowDimensions } from "react-native"
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated"

// Full-screen first-launch hero: the name appears large and centered, holds for
// a beat, then shrinks + flies up toward the header and fades out, revealing the
// home screen behind it. Calls onDone when the exit finishes.
const APPEAR = 480
const HOLD = 650
const EXIT = 600

export function HeroIntro({ name, onDone }: { name: string; onDone: () => void }) {
  const { height } = useWindowDimensions()
  const opacity = useSharedValue(0)
  const scale = useSharedValue(0.8)
  const translateY = useSharedValue(0)
  const bg = useSharedValue(1)

  useEffect(() => {
    opacity.value = withSequence(
      withTiming(1, { duration: APPEAR }),
      withDelay(HOLD, withTiming(0, { duration: EXIT }))
    )
    scale.value = withSequence(
      withTiming(1, { duration: APPEAR, easing: Easing.out(Easing.back(1.5)) }),
      withDelay(HOLD, withTiming(0.4, { duration: EXIT, easing: Easing.in(Easing.cubic) }))
    )
    translateY.value = withDelay(
      APPEAR + HOLD,
      withTiming(-height * 0.34, { duration: EXIT, easing: Easing.in(Easing.cubic) })
    )
    bg.value = withDelay(APPEAR + HOLD + 120, withTiming(0, { duration: EXIT - 60 }))

    const t = setTimeout(onDone, APPEAR + HOLD + EXIT)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const bgStyle = useAnimatedStyle(() => ({ opacity: bg.value }))
  const textStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }))

  return (
    <Animated.View pointerEvents="none" style={styles.overlay}>
      <Animated.View style={[StyleSheet.absoluteFill, bgStyle]}>
        <LinearGradient colors={["#1B2420", "#242325", "#242325"]} style={{ flex: 1 }} />
      </Animated.View>
      <Animated.Text style={[styles.name, textStyle]}>Hi,{"\n"}{name}</Animated.Text>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    alignItems: "center",
    justifyContent: "center",
  },
  name: {
    fontSize: 44,
    fontWeight: "800",
    color: C.textPrimary,
    textAlign: "center",
    lineHeight: 50,
  },
})
