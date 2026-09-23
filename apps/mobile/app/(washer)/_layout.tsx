import { Role } from '@parkease/contracts/enums';
import { colors } from '@parkease/tokens';
import { Tabs, Redirect } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';
import { WasherPresenceProvider } from '@/features/washer/presence-context';

export default function WasherLayout() {
  const auth = useAuth();

  if (auth.status !== 'authenticated') return <Redirect href="/" />;
  if (auth.activeRole !== Role.WASHER) {
    return <Redirect href={`/(${auth.activeRole ?? 'auth'})`} />;
  }

  // Presence wraps the tabs, not one screen: the heartbeat that keeps a partner
  // dispatchable must survive them switching to Menu or Earnings.
  return (
    <WasherPresenceProvider>
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
    </WasherPresenceProvider>
  );
}
