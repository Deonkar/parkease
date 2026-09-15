import { MaterialCommunityIcons } from '@expo/vector-icons';
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
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="view-dashboard-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="listings"
        options={{
          title: 'Listings',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="home-city-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          title: 'Earnings',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="wallet-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="account-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen name="scan" options={{ href: null }} />
      <Tabs.Screen name="listings/new" options={{ href: null }} />
      <Tabs.Screen name="listings/[id]" options={{ href: null }} />
      <Tabs.Screen name="earnings/payouts" options={{ href: null }} />
    </Tabs>
  );
}
