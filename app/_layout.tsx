import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import 'react-native-reanimated';
import Auth_context from '@/components/auth-context';
import {GestureHandlerRootView} from 'react-native-gesture-handler'
import AsyncStorage from "@react-native-async-storage/async-storage"

const ONBOARDING_KEY = "hasSeenOnboarding"

export const unstable_settings = {
  anchor: '(tabs)',
};
//porque lo pone en el layout directamente? 
export default function RootLayout() {
  

  return (
     <GestureHandlerRootView style={{ flex: 1 }}>
      <Auth_context> 
        <Stack>
          <Stack.Screen name="(tabs)" options={{headerShown:false}} />
          <Stack.Screen name="auth" options={{presentation:'modal', headerShown: false }} />
          <Stack.Screen name="OnBoarding" options={{headerShown: false}} />
        </Stack>
      </Auth_context>
     </GestureHandlerRootView>
  );
}
