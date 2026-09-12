import { Role } from '@parkease/contracts/enums';
import { colors } from '@parkease/tokens';
import { Tabs, Redirect } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';

export default function DriverLayout() {
  const auth = useAuth();

  if (auth.status !== 'authenticated') return <Redirect href="/" />;
  if (auth.activeRole !== Role.DRIVER) {
    return <Redirect href={`/(${auth.activeRole ?? 'auth'})`} />;
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.tabInactive,
        headerShown: false,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="bookings" options={{ title: 'Bookings' }} />
      <Tabs.Screen name="alerts" options={{ title: 'Alerts' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
