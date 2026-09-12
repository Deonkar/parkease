import { Role } from '@parkease/contracts/enums';
import { colors } from '@parkease/tokens';
import { Tabs, Redirect } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';

export default function OwnerLayout() {
  const auth = useAuth();

  if (auth.status !== 'authenticated') return <Redirect href="/" />;
  if (auth.activeRole !== Role.OWNER) {
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
      <Tabs.Screen name="index" options={{ title: 'Dashboard' }} />
      <Tabs.Screen name="listings" options={{ title: 'Listings' }} />
      <Tabs.Screen name="earnings" options={{ title: 'Earnings' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
