
import AsyncStorage from "@react-native-async-storage/async-storage"

const ONBOARDING_KEY = "hasSeenOnboarding"

export async function hasSeenOnboarding() {
  const value = await AsyncStorage.getItem(ONBOARDING_KEY)
  return value === "true"
}

export async function setSeenOnboarding() {
  await AsyncStorage.setItem(ONBOARDING_KEY, "true")
}