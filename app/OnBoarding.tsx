import { Melt, PaperBackground, PosterHeadline } from "@/components/paper"
import { Text, View } from "react-native"
import { useRouter } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { setSeenOnboarding } from "../hooks/onBoardingHook"
import { useC } from "@/theme/paper/legacy"
import CustomButton from "@/components/customButton"

export default function Onboarding() {
  const C = useC()
  const router = useRouter()

  async function handleContinue() {
    await setSeenOnboarding()
    router.replace("/")
  }

  return (
    <PaperBackground>
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
          <View style={{ alignItems: "center" }}>
            <Melt top={0} height={260} />
            <PosterHeadline size={72}>Hi there!</PosterHeadline>
          </View>

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
    </PaperBackground>
  )
}
