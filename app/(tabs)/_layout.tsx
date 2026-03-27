import { ConsumeAuth } from "@/components/auth-context"
import { Stack, Redirect, useSegments } from "expo-router"
import React, { useEffect, useState } from "react"
import Auth_context from "@/components/auth-context"
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

  // ⏳ Wait for everything
  if (isLoadingUser || seenOnboarding === null) {
    return null
  }

  // 📍 Get current route group
  const inAuthGroup = segments[0] === "auth"
  const inOnboarding = segments[0] === "OnBoarding"

  // 🧠 1. Onboarding ALWAYS comes first (regardless of auth)
  if (!seenOnboarding) {
    if (!inOnboarding) {
      return <Redirect href="/OnBoarding" />
    }
    return (
      <Auth_context>
        <Stack screenOptions={{ headerShown: false }} />
      </Auth_context>
    )
  }

  // 🔐 2. Auth second
  if (!User && !inAuthGroup) {
    return <Redirect href="/auth" />
  }

  // ✅ 3. Prevent going back to auth
  if (User && inAuthGroup) {
    return <Redirect href="/" />
  }

  return (
    <Auth_context>
      <Stack screenOptions={{ headerShown: false }} />
    </Auth_context>
  )
}