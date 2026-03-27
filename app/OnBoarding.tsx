import { View, Text, Button } from "react-native"
import { useRouter } from "expo-router"
import { setSeenOnboarding } from "../hooks/onBoardingHook"
import { colors } from "@/theme/colors"
import CustomButton from '@/components/customButton'
export default function Onboarding() {
  const router = useRouter()

  async function handleContinue() {
    await setSeenOnboarding()
    router.replace("/")
  }

  return (
    <View style={{ flex: 1, alignItems: "center",justifyContent: "center", padding: 20, backgroundColor: colors.backGround }}>
      <Text style={{ fontSize: 24, marginBottom: 20,fontWeight: '600' }}>
        Hi there!
      </Text>
        
      <Text style={{ fontSize: 20, marginBottom: 20, padding:20, textAlign:"center",fontWeight: '600'  }}>
        Welcome to the first version of this app
      </Text>

      <Text style={{ fontSize: 20, marginBottom: 40, textAlign:"center", padding: 20,fontWeight: '600'}}>
        This app is meant to help us in the journey of becoming better climbers and see the progress we make week by week.
      </Text>

      <Text style={{ fontSize: 20, marginBottom: 40, textAlign:"center", padding: 2,fontWeight: '600'}}>
          Hope you like it!
      </Text>
      

      <CustomButton title="Let's Start" onPress={handleContinue} />
    </View>
  )
}