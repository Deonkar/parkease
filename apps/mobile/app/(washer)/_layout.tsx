import { Role } from '@parkease/contracts/enums';
import { colors } from '@parkease/tokens';
import { Tabs, Redirect } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';

export default function WasherLayout() {
  const auth = useAuth();

  if (auth.status !== 'authenticated') return <Redirect href="/" />;
  if (auth.activeRole !== Role.WASHER) {
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
      <Tabs.Screen name="offers" options={{ title: 'Offers' }} />
      <Tabs.Screen name="active" options={{ title: 'Active' }} />
      <Tabs.Screen name="menu" options={{ title: 'Menu' }} />
      <Tabs.Screen name="earnings" options={{ title: 'Earnings' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
