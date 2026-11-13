import { useAuth } from "@/components/auth-context"
import { HomeworkNotificationRouter } from "@/components/HomeworkNotificationRouter"
import { ClassNotificationRouter } from "@/components/schedule/ClassNotificationRouter"
import { PackageLock } from "@/components/schedule/PackageLock"
import { WorkOutState } from "@/components/workOutState"
import { PaperScope } from "@/theme/paper/legacy"
import { StatusBar } from "expo-status-bar"
import { ActivePlanProvider, useActivePlan } from "@/contexts/ActivePlanContext"
import { WorkoutProvider, useWorkoutContext } from "@/contexts/WorkoutContext"
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs"
import { PaperBackground, PaperTabBar, PaperThemeOverride, usePaper as usePaperTheme } from "@/components/paper"
import { Ionicons } from "@expo/vector-icons"
import { font } from "@/theme/paper/tokens"
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

export default function TabsLayout() {
  const { isLoadingUser } = useAuth()
  if (isLoadingUser) return null
  return (
    <ActivePlanProvider>
      <TabsWithPlan />
    </ActivePlanProvider>
  )
}

function TabsWithPlan() {
  const { role } = useAuth()
  const { plan, loading: loadingPlan } = useActivePlan()
  // Inset folded into the bar's own height/padding so icons sit just above the
  // home indicator / nav bar — no dead space below them.
  const insets = useSafeAreaInsets()
  const paper = usePaperTheme()

  // Wait for the plan so Home doesn't flash before redirecting to Plan.
  if (loadingPlan) return null

  // With a plan, Plan is home: no Home tab — and athletes, left with one
  // tab, get no tab bar at all (docs/redesign.md §9).
  const hasPlan = !!plan
  const hideBar = hasPlan && role !== "coach"

  return (
    <WorkoutProvider>
      {/* Paper Mint everywhere (theme/paper/legacy.tsx): every old screen,
          sheet and modal under the tabs follows the Paper light/dark theme. */}
      <PaperScope>
      <TabsStatusBar />
      <Tabs
        tabBar={(props) => <CustomTabBar tabBarProps={props} hideBar={hideBar} />}
        // Hidden screens (Settings, Videos, …) are pushed like a stack, so
        // back should return to where they were opened from, not to Home.
        backBehavior="history"
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: paper.paper },
          tabBarStyle: {
            backgroundColor: paper.paper,
            borderTopColor: paper.hairline,
            borderTopWidth: 1,
            height: 60 + insets.bottom,
            paddingBottom: insets.bottom,
            paddingTop: 8,
          },
          tabBarActiveTintColor: paper.mintText,
          tabBarInactiveTintColor: paper.label,
        }}
      >
        {/* ── Visible tabs ───────────────────────────────────────────── */}
        <Tabs.Screen
          name="index"
          options={{
            title: "Home",
            href: hasPlan ? null : undefined,
            tabBarIcon: ({ focused, color }) => (
              <Ionicons name={focused ? "home" : "home-outline"} size={22} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="plan"
          options={{
            title: "Plan",
            tabBarIcon: ({ focused, color }) => (
              <Ionicons name={focused ? "calendar" : "calendar-outline"} size={22} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="classes"
          options={{
            title: "Classes",
            href: role === "coach" ? undefined : null,
            tabBarIcon: ({ focused, color }) => (
              <Ionicons name={focused ? "people" : "people-outline"} size={22} color={color} />
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

        {/* ── Hidden screens (pushed via router.push) ────────────────── */}
        {/* Settings opens from the gear top-right (SettingsButton); Videos from Settings. */}
        <Tabs.Screen name="settings" options={{ href: null }} />
        <Tabs.Screen name="library" options={{ href: null }} />
        <Tabs.Screen name="my-workouts" options={{ href: null }} />
        <Tabs.Screen name="my-sequences" options={{ href: null }} />
        <Tabs.Screen name="past-workouts" options={{ href: null }} />
        <Tabs.Screen name="exerciseProgress" options={{ href: null }} />
        <Tabs.Screen name="exercises" options={{ href: null }} />
        <Tabs.Screen name="sprayWall" options={{ href: null }} />
        <Tabs.Screen name="sprayWallBuilder" options={{ href: null }} />
        <Tabs.Screen name="past-projects" options={{ href: null }} />
        <Tabs.Screen name="workout-log" options={{ href: null }} />
        <Tabs.Screen name="workout-library" options={{ href: null }} />
        <Tabs.Screen name="schedule" options={{ href: null }} />
        <Tabs.Screen name="push-log" options={{ href: null }} />
      </Tabs>

      {/* Workout modal lives at the layout level so it overlays everything */}
      <WorkoutModalHost />
      {/* Tapped homework notifications → the homework card on home */}
      <HomeworkNotificationRouter hasPlan={hasPlan} />
      {/* Class pushes: reload the calendar, and open it when tapped */}
      <ClassNotificationRouter role={role} />
      <PackageLock />
      </PaperScope>
    </WorkoutProvider>
  )
}

// ─── Custom tab bar — adds MinimizedWorkoutBar above the default ──────────────

// Every screen is Paper Mint now, so the bar follows the Paper light/dark
// everywhere — except the class calendar, which is dark-only (calTheme).
const DARK_ROUTES = new Set(["classes", "schedule"])

function CustomTabBar({ tabBarProps, hideBar }: { tabBarProps: BottomTabBarProps; hideBar: boolean }) {
  const route = tabBarProps.state.routes[tabBarProps.state.index]?.name
  if (!DARK_ROUTES.has(route)) return <TabBarBody tabBarProps={tabBarProps} hideBar={hideBar} />
  return (
    <PaperThemeOverride mode="dark">
      <TabBarBody tabBarProps={tabBarProps} hideBar={hideBar} />
    </PaperThemeOverride>
  )
}

// Status bar text that reads on the paper (screens that need another style,
// like the dark class calendar or the workout, set their own on top).
function TabsStatusBar() {
  const t = usePaperTheme()
  return <StatusBar style={t.mode === "dark" ? "light" : "dark"} />
}

function TabBarBody({ tabBarProps, hideBar }: { tabBarProps: BottomTabBarProps; hideBar: boolean }) {
  const ctx = useWorkoutContext()
  const insets = useSafeAreaInsets()
  const t = usePaperTheme()
  const showMiniBar = ctx.workoutActive && ctx.workoutMinimized
  return (
    <View style={{ backgroundColor: t.paper }}>
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
      {hideBar ? (
        // No tabs to show — keep only the safe-area spacing (under the mini bar, if any).
        <View style={{ height: insets.bottom }} />
      ) : (
        <PaperTabBar {...tabBarProps} />
      )}
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
      <GestureHandlerRootView style={{ flex: 1 }}>
        {/* Paper Mint for the whole workout flow (theme/paper/legacy.tsx). */}
        <PaperScope>
          <PaperBackground>
            {!ctx.workoutMinimized && <WorkoutStatusBar />}
            <WorkOutState
              workout={ctx.workout}
              protocol={ctx.protocol}
              protocolName={ctx.protocolName}
              autoStart
              onWorkoutStart={() => ctx.setWorkoutActive(true)}
              onWorkoutEnd={ctx.endWorkout}
              onClose={ctx.closeModal}
              onMinimize={ctx.minimize}
              onSetCoached={ctx.setBlockCoached}
              onSwapMain={ctx.link?.planId ? ctx.swapMainBlock : undefined}
            />
          </PaperBackground>
        </PaperScope>
      </GestureHandlerRootView>
    </View>
  )
}

// Status bar text that reads on the workout's paper while it's open.
function WorkoutStatusBar() {
  const t = usePaperTheme()
  return <StatusBar style={t.mode === "dark" ? "light" : "dark"} />
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
  const t = usePaperTheme()
  const dark = t.mode === "dark"
  const pulse = useSharedValue(1)

  useEffect(() => {
    // Live dot: mint, breathing while the workout runs in the background.
    pulse.value = withRepeat(
      withTiming(0.35, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    )
  }, [pulse])

  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }))

  return (
    <Pressable onPress={onExpand} accessibilityRole="button" accessibilityLabel={`Back to ${protocolName}`}>
      <View style={[miniBarStyles.bar, { backgroundColor: t.tabBar, borderTopColor: t.hairline, borderBottomColor: t.hairline }]}>
        <Animated.View
          style={[
            miniBarStyles.liveDot,
            { backgroundColor: t.mint, borderColor: dark ? t.mint : t.ink },
            dark && { shadowColor: t.mint, shadowOpacity: 0.8, shadowRadius: 6 },
            pulseStyle,
          ]}
        />
        <View style={{ flex: 1 }}>
          <Text style={[miniBarStyles.title, { color: t.ink }]} numberOfLines={1}>{protocolName}</Text>
          <Text style={[miniBarStyles.sub, { color: t.mintText }]}>
            {`IN PROGRESS · BLOCK ${currentIndex + 1} OF ${totalBlocks}`}
          </Text>
        </View>
        <Pressable
          onPress={onExpand}
          style={[miniBarStyles.iconBtn, { backgroundColor: t.mint, borderColor: dark ? t.mint : t.ink }]}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Open workout"
        >
          <Ionicons name="chevron-up" size={18} color={t.onMint} />
        </Pressable>
        <Pressable
          onPress={onEnd}
          style={[miniBarStyles.iconBtn, { borderColor: t.ink }]}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Exit workout"
        >
          <Ionicons name="close" size={18} color={t.ink} />
        </Pressable>
      </View>
    </Pressable>
  )
}

const miniBarStyles = StyleSheet.create({
  bar: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 10, gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  liveDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
  title: { fontSize: 15, fontFamily: font.bold },
  sub: { fontSize: 10, fontFamily: font.mono, letterSpacing: 1.1, marginTop: 3 },
  iconBtn: {
    width: 34, height: 34, borderRadius: 17, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center",
  },
})
