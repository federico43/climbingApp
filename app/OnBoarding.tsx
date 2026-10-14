import { LinearGradient } from "expo-linear-gradient"
import { Text, View } from "react-native"
import { useRouter } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { setSeenOnboarding } from "../hooks/onBoardingHook"
import { C } from "@/utils/theme"
import CustomButton from "@/components/customButton"

export default function Onboarding() {
  const router = useRouter()

  async function handleContinue() {
    await setSeenOnboarding()
    router.replace("/")
  }

  return (
    <LinearGradient colors={["#1B2420", "#242325", "#242325"]} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }}>
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            gap: 24,
          }}
        >
          <Text
            style={{
              fontSize: 28,
              fontWeight: "700",
              color: C.textPrimary,
              textAlign: "center",
            }}
          >
            Hi there!
          </Text>

          <Text
            style={{
              fontSize: 18,
              fontWeight: "600",
              color: C.textPrimary,
              textAlign: "center",
              lineHeight: 26,
            }}
          >
            Welcome to the first version of this app
          </Text>

          <Text
            style={{
              fontSize: 15,
              color: C.textSecondary,
              textAlign: "center",
              lineHeight: 22,
              maxWidth: 320,
            }}
          >
            This app is meant to help us on the journey of becoming better climbers
            and see the progress we make week by week.
          </Text>

          <Text
            style={{
              fontSize: 15,
              color: C.textSecondary,
              textAlign: "center",
              fontStyle: "italic",
            }}
          >
            Hope you like it!
          </Text>

          <View style={{ width: "100%", marginTop: 16 }}>
            <CustomButton title="Let's Start" onPress={handleContinue} />
          </View>
        </View>
      </SafeAreaView>
    </LinearGradient>
  )
}
