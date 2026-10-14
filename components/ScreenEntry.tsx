import { useFocusEffect } from "@react-navigation/native"
import React, { useCallback } from "react"
import { StyleProp, ViewStyle } from "react-native"
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated"

interface Props {
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
}

/**
 * Wraps screen content in a fade + slide-up animation that replays
 * each time the screen gains focus (tab switch or navigator push).
 */
export function ScreenEntry({ children, style }: Props) {
  const opacity = useSharedValue(0)
  const translateY = useSharedValue(10)

  useFocusEffect(
    useCallback(() => {
      opacity.value = withTiming(1, { duration: 220 })
      translateY.value = withSpring(0, { damping: 22, stiffness: 220 })

      return () => {
        opacity.value = 0
        translateY.value = 10
      }
    }, [opacity, translateY])
  )

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }))

  return (
    <Animated.View style={[{ flex: 1 }, style, animStyle]}>
      {children}
    </Animated.View>
  )
}
