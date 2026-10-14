import Auth_context, { ConsumeAuth } from "@/components/auth-context"
import { Redirect, Stack, useSegments } from "expo-router"
import React, { useEffect, useState } from "react"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { hasSeenOnboarding } from "../../hooks/onBoardingHook"

export default function AppLayout() {
  const segments = useSegments()
  const { User, isLoadingUser } = ConsumeAuth()
  const [seenOnboarding, setSeenOnboardingState] = useState<boolean | null>(null)

  useEffect(() => {
    async function checkOnboarding() {
      const seen = await hasSeenOnboarding()
      setSeenOnboardingState(seen)
    }
    checkOnboarding()
  }, [])

  if (isLoadingUser || seenOnboarding === null) {
    return <GestureHandlerRootView style={{ flex: 1 }} />
  }

  const inAuthGroup = segments[0] === "auth"
  const inOnboarding = segments[0] === "OnBoarding"

  if (!seenOnboarding) {
    if (!inOnboarding) return <Redirect href="/OnBoarding" />
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Auth_context>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#242325" } }} />
        </Auth_context>
      </GestureHandlerRootView>
    )
  }

  if (!User && !inAuthGroup) return <Redirect href="/auth" />
  if (User && inAuthGroup) return <Redirect href="/" />

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Auth_context>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#242325" } }} />
      </Auth_context>
    </GestureHandlerRootView>
  )
}