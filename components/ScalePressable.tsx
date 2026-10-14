import React from "react"
import { Pressable, PressableProps, StyleProp, ViewStyle } from "react-native"
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated"

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

interface Props extends Omit<PressableProps, "style"> {
  style?: StyleProp<ViewStyle>
  children?: React.ReactNode
}

export function ScalePressable({ style, children, onPress, onLongPress, ...rest }: Props) {
  const scale = useSharedValue(1)

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }))

  return (
    <AnimatedPressable
      style={[style, animStyle] as any}
      onPressIn={() => {
        scale.value = withSpring(0.96, { damping: 15, stiffness: 380 })
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 12, stiffness: 380 })
      }}
      onPress={onPress}
      onLongPress={onLongPress}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  )
}
