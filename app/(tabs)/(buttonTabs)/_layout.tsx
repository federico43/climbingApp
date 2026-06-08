import { ConsumeAuth } from "@/components/auth-context"
import { WorkOutState } from "@/components/workOutState"
import { WorkoutProvider, useWorkoutContext } from "@/contexts/WorkoutContext"
import { BottomTabBar } from "@react-navigation/bottom-tabs"
import { Ionicons } from "@expo/vector-icons"
import { LinearGradient } from "expo-linear-gradient"
import { Tabs } from "expo-router"
import { useEffect } from "react"
import { Alert, Pressable, StyleSheet, Text, View } from "react-native"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated"
import { C } from "@/utils/theme"

export default function TabsLayout() {
  const { role, isLoadingUser } = ConsumeAuth()
  // Inset folded into the bar's own height/padding so icons sit just above the
  // home indicator / nav bar — no dead space below them.
  const insets = useSafeAreaInsets()

  if (isLoadingUser) return null

  return (
    <WorkoutProvider>
      <Tabs
        tabBar={(props) => <CustomTabBar tabBarProps={props} />}
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: C.bg },
          tabBarStyle: {
            backgroundColor: C.bg,
            borderTopColor: C.border,
            borderTopWidth: 1,
            height: 60 + insets.bottom,
            paddingBottom: insets.bottom,
            paddingTop: 8,
          },
          tabBarActiveTintColor: C.green,
          tabBarInactiveTintColor: "#4F5C56",
        }}
      >
        {/* ── Visible tabs ───────────────────────────────────────────── */}
        <Tabs.Screen
          name="index"
          options={{
            title: "Home",
            tabBarIcon: ({ focused, color }) => (
              <Ionicons name={focused ? "home" : "home-outline"} size={22} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="library"
          options={{
            title: "Library",
            tabBarIcon: ({ focused, color }) => (
              <Ionicons name={focused ? "videocam" : "videocam-outline"} size={22} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="design"
          options={{
            title: "Design",
            href: role === "coach" ? undefined : null,
            tabBarIcon: ({ focused, color }) => (
              <Ionicons name={focused ? "create" : "create-outline"} size={22} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: "Settings",
            tabBarIcon: ({ focused, color }) => (
              <Ionicons name={focused ? "settings" : "settings-outline"} size={22} color={color} />
            ),
          }}
        />

        {/* ── Hidden screens (pushed via router.push) ────────────────── */}
        <Tabs.Screen name="workout" options={{ href: null }} />
        <Tabs.Screen name="protocolDesigner" options={{ href: null }} />
        <Tabs.Screen name="calendarScreen" options={{ href: null }} />
        <Tabs.Screen name="savedVideos" options={{ href: null }} />
        <Tabs.Screen name="exerciseProgress" options={{ href: null }} />
        <Tabs.Screen name="exercises" options={{ href: null }} />
        <Tabs.Screen name="dashboard" options={{ href: null }} />
        <Tabs.Screen name="sprayWall" options={{ href: null }} />
        <Tabs.Screen name="sprayWallBuilder" options={{ href: null }} />
        <Tabs.Screen name="past-projects" options={{ href: null }} />
      </Tabs>

      {/* Workout modal lives at the layout level so it overlays everything */}
      <WorkoutModalHost />
    </WorkoutProvider>
  )
}

// ─── Custom tab bar — adds MinimizedWorkoutBar above the default ──────────────

function CustomTabBar({ tabBarProps }: { tabBarProps: any }) {
  const ctx = useWorkoutContext()
  const showMiniBar = ctx.workoutActive && ctx.workoutMinimized
  // The safe-area inset is folded into the tab bar's own height/padding
  // (see tabBarStyle), so no extra padding is needed here.
  return (
    <View style={{ backgroundColor: C.bg }}>
      {showMiniBar && (
        <MinimizedWorkoutBar
          protocolName={ctx.protocolName}
          currentIndex={ctx.workout.currentBlockIndex}
          totalBlocks={ctx.workout.totalBlocks}
          onExpand={ctx.expand}
          onEnd={() => {
            Alert.alert("Exit workout", "Are you sure you want to cancel this workout?", [
              { text: "Keep going", style: "cancel" },
              { text: "Exit", style: "destructive", onPress: ctx.endWorkout },
            ])
          }}
        />
      )}
      <BottomTabBar {...tabBarProps} />
    </View>
  )
}

// ─── Workout overlay — stays mounted while a workout is active ────────────────
// We use an absolute overlay (not a Modal) so the WorkOutState component is
// never unmounted while the workout is running. That preserves all internal
// block state (current phase, notes, selected project, etc.) when the user
// minimizes the workout and comes back later.

function WorkoutModalHost() {
  const ctx = useWorkoutContext()
  if (!ctx.modalVisible) return null
  return (
    <View
      pointerEvents={ctx.workoutMinimized ? "none" : "auto"}
      style={[
        StyleSheet.absoluteFillObject,
        { zIndex: 1000, elevation: 1000 },
        ctx.workoutMinimized && { opacity: 0, transform: [{ translateX: 10000 }] },
      ]}
    >
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: C.bg }}>
        <WorkOutState
          workout={ctx.workout}
          protocol={ctx.protocol}
          protocolName={ctx.protocolName}
          autoStart
          onWorkoutStart={() => ctx.setWorkoutActive(true)}
          onWorkoutEnd={ctx.endWorkout}
          onClose={ctx.closeModal}
          onMinimize={ctx.minimize}
        />
      </GestureHandlerRootView>
    </View>
  )
}

// ─── Mini bar ─────────────────────────────────────────────────────────────────

function MinimizedWorkoutBar({
  protocolName,
  currentIndex,
  totalBlocks,
  onExpand,
  onEnd,
}: {
  protocolName: string
  currentIndex: number
  totalBlocks: number
  onExpand: () => void
  onEnd: () => void
}) {
  const pulse = useSharedValue(1)
  const barPulse = useSharedValue(1)

  useEffect(() => {
    // Dot — sharper pulse
    pulse.value = withRepeat(
      withTiming(0.4, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    )
    // Whole-bar — strong breathing of the gradient bloom
    barPulse.value = withRepeat(
      withTiming(0.05, { duration: 1600, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    )
  }, [])

  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }))
  const barOverlayStyle = useAnimatedStyle(() => ({ opacity: barPulse.value }))

  return (
    <Pressable onPress={onExpand}>
      <View>
        <LinearGradient
          colors={["#1B2420", "#2E5C4A", "#62C99A"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={miniBarStyles.bar}
        >
          {/* Live dot */}
          <Animated.View style={[miniBarStyles.liveDot, pulseStyle]} />
          <View style={{ flex: 1 }}>
            <Text style={miniBarStyles.title} numberOfLines={1}>{protocolName}</Text>
            <Text style={miniBarStyles.sub}>
              Block {currentIndex + 1} of {totalBlocks}
            </Text>
          </View>
          <Pressable onPress={onExpand} style={miniBarStyles.iconBtn} hitSlop={6}>
            <Ionicons name="chevron-up" size={18} color="#fff" />
          </Pressable>
          <Pressable onPress={onEnd} style={miniBarStyles.iconBtn} hitSlop={6}>
            <Ionicons name="close" size={18} color="#fff" />
          </Pressable>
        </LinearGradient>

        {/* Whole-bar breathing overlay — strong bright bloom fading in/out */}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, barOverlayStyle]}>
          <LinearGradient
            colors={["transparent", "rgba(125,255,184,0.95)", "transparent"]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{ flex: 1 }}
          />
        </Animated.View>
      </View>
    </Pressable>
  )
}

const miniBarStyles = StyleSheet.create({
  bar: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 12, gap: 12,
  },
  liveDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: "#fff",
    shadowColor: "#fff", shadowOpacity: 0.9, shadowRadius: 4,
  },
  title: { fontSize: 15, fontWeight: "700", color: "#fff" },
  sub: { fontSize: 11, color: "rgba(255,255,255,0.75)", marginTop: 2 },
  iconBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: "rgba(0,0,0,0.25)",
    alignItems: "center", justifyContent: "center",
  },
  iconText: { color: "#fff", fontSize: 18, fontWeight: "700", lineHeight: 20 },
})
