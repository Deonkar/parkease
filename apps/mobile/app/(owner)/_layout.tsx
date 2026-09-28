import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Role } from '@parkease/contracts/enums';
import { colors, fontSize, fontWeight, layout, lineHeight, spacing } from '@parkease/tokens';
import { Tabs, Redirect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { landingRouteFor } from '@/lib/landing-route';

export default function OwnerLayout() {
  const auth = useAuth();
  const insets = useSafeAreaInsets();

  if (auth.status !== 'authenticated') return <Redirect href="/" />;
  if (auth.activeRole !== Role.OWNER) {
    return <Redirect href={landingRouteFor(auth.activeRole)} />;
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.tabInactive,
        // Below the icon at every width — matches the washer/driver layouts
        // (learnings.md: "The default tab bar is 48px and clips its own
        // labels"). The inset is ADDED to the height, never subtracted: on a
        // gesture-navigation Android device the gesture bar sits under the
        // tab bar, and subtracting re-clips the labels on exactly the
        // devices most of the market uses.
        tabBarLabelPosition: 'below-icon',
        tabBarLabelStyle: {
          fontSize: fontSize.xs,
          fontWeight: fontWeight.medium,
          lineHeight: fontSize.xs * lineHeight.normal,
        },
        tabBarStyle: {
          height: layout.tabBarHeight + insets.bottom,
          paddingBottom: insets.bottom + spacing.xs,
          paddingTop: spacing.xs,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
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
