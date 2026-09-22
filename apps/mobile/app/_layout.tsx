import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { queryClient } from '@/lib/query';

// Imported for its side effect, and from the ROOT layout rather than the valet
// one. `TaskManager` looks the background-location task up by string when the
// OS wakes the process, and at that moment no component has mounted and no
// role-specific layout exists. Registering it here is what makes tracking
// survive backgrounding — defining it inside a hook was the v1 bug.
import '@/features/valet/location/task';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ThemeProvider>
            <StatusBar style="auto" />
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
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
