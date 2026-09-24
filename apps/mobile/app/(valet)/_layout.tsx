import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Role } from '@parkease/contracts/enums';
import { colors, fontSize, fontWeight } from '@parkease/tokens';
import { Tabs, Redirect } from 'expo-router';
import type { ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { landingRouteFor } from '@/lib/landing-route';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

/**
 * `focused` swaps to the filled variant, so the active tab reads as active by
 * shape as well as by colour — colour is never the only signal (R-FE-12).
 */
function tabIcon(outline: IconName, filled: IconName) {
  return function Icon(props: { color: ColorValue; size: number; focused: boolean }) {
    return (
      <MaterialCommunityIcons
        name={props.focused ? filled : outline}
        size={props.size}
        color={props.color}
      />
    );
  };
}

/**
 * Material's minimum for bottom navigation with labels. The default tab bar is
 * 48px, which clips the label under a 24px icon — visible at 375x812.
 */
const TAB_BAR_HEIGHT = 60;

export default function ValetLayout() {
  const auth = useAuth();
  const insets = useSafeAreaInsets();

  if (auth.status !== 'authenticated') return <Redirect href="/" />;
  if (auth.activeRole !== Role.VALET) {
    return <Redirect href={landingRouteFor(auth.activeRole)} />;
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarLabelStyle: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },
        // The gesture bar sits under the tab bar on a modern Android device, so
        // the inset is added to the height rather than eating into it.
        tabBarStyle: {
          height: TAB_BAR_HEIGHT + insets.bottom,
          paddingBottom: insets.bottom + 6,
          paddingTop: 6,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="offers"
        options={{
          title: 'Offers',
          tabBarIcon: tabIcon('inbox-arrow-down-outline', 'inbox-arrow-down'),
        }}
      />
      <Tabs.Screen
        name="active/index"
        options={{ title: 'Active', tabBarIcon: tabIcon('car-outline', 'car') }}
      />
      <Tabs.Screen
        name="earnings"
        options={{ title: 'Earnings', tabBarIcon: tabIcon('wallet-outline', 'wallet') }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', tabBarIcon: tabIcon('account-outline', 'account') }}
      />
    </Tabs>
  );
}
