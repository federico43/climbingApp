import Auth_context from '@/components/auth-context';
import { SessionSyncRunner } from '@/components/SessionSyncRunner';
import { UpdateBanner } from '@/components/UpdateBanner';
import { VideoUploadQueueRunner } from '@/components/VideoUploadQueueRunner';
import { PaperThemeProvider } from '@/theme/paper/PaperThemeProvider';
import { fontFiles } from '@/theme/paper/tokens';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  // Paper Mint fonts (docs/design-system.md §3). Bundled, so this resolves
  // almost instantly; on an error the app still renders with system fonts.
  const [fontsLoaded, fontError] = useFonts(fontFiles);
  if (!fontsLoaded && !fontError) return <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#242325' }} />;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#242325' }}>
      <PaperThemeProvider>
      <Auth_context>
        <Stack screenOptions={{ contentStyle: { backgroundColor: '#242325' } }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="auth" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="OnBoarding" options={{ headerShown: false }} />
          {/* Design system preview: testapp://paper-preview */}
          <Stack.Screen name="paper-preview" options={{ headerShown: false }} />
        </Stack>
        <UpdateBanner />
        <VideoUploadQueueRunner />
        <SessionSyncRunner />
      </Auth_context>
      </PaperThemeProvider>
    </GestureHandlerRootView>
  );
}
