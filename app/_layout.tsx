import Auth_context from '@/components/auth-context';
import { UpdateBanner } from '@/components/UpdateBanner';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#242325' }}>
      <Auth_context>
        <Stack screenOptions={{ contentStyle: { backgroundColor: '#242325' } }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="auth" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="OnBoarding" options={{ headerShown: false }} />
        </Stack>
        <UpdateBanner />
      </Auth_context>
    </GestureHandlerRootView>
  );
}
