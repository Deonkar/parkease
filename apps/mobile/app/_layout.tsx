import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { OfflineBanner } from '@/features/shared/components/OfflineBanner';
import { PushRegistration } from '@/features/shared/notifications/PushRegistration';
import { connectOnlineManager, persistOptions } from '@/lib/offline';
import { queryClient } from '@/lib/query';

// Imported for its side effect, and from the ROOT layout rather than the valet
// one. `TaskManager` looks the background-location task up by string when the
// OS wakes the process, and at that moment no component has mounted and no
// role-specific layout exists. Registering it here is what makes tracking
// survive backgrounding — defining it inside a hook was the v1 bug.
import '@/features/valet/location/task';

connectOnlineManager();

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={persistOptions}
        // Intents paused offline in an earlier session replay once the cache is back.
        onSuccess={() => void queryClient.resumePausedMutations()}
      >
        <AuthProvider>
          <ThemeProvider>
            <StatusBar style="auto" />
            <PushRegistration />
            <OfflineBanner />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(driver)" />
              <Stack.Screen name="(owner)" />
              <Stack.Screen name="(valet)" />
              <Stack.Screen name="(washer)" />
              <Stack.Screen name="(shared)" options={{ presentation: 'modal' }} />
            </Stack>
          </ThemeProvider>
        </AuthProvider>
      </PersistQueryClientProvider>
    </SafeAreaProvider>
  );
}
