import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Role } from '@parkease/contracts/enums';
import { colors, fontSize, fontWeight, layout, lineHeight, spacing } from '@parkease/tokens';
import { Tabs, Redirect } from 'expo-router';
import type { ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { WasherPresenceProvider } from '@/features/washer/presence-context';
import { landingRouteFor } from '@/lib/landing-route';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

/**
 * `focused` swaps to the filled variant, so the active tab reads as active by
 * shape as well as by colour — colour is never the only signal (R-FE-12).
 * Local, as in the driver and valet layouts; extracting it is S-53.
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

export default function WasherLayout() {
  const auth = useAuth();
  const insets = useSafeAreaInsets();

  if (auth.status !== 'authenticated') return <Redirect href="/" />;
  if (auth.activeRole !== Role.WASHER) {
    return <Redirect href={landingRouteFor(auth.activeRole)} />;
  }

  // Presence wraps the tabs, not one screen: the heartbeat that keeps a partner
  // dispatchable must survive them switching to Menu or Earnings.
  return (
    <WasherPresenceProvider>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.tabInactive,
          // M2: below the icon at every width. From 768px the bar would put
          // labels beside the icons in a narrow item and cut "Earnings" short.
          tabBarLabelPosition: 'below-icon',
          // Its own line box: without one the 12px label sat in a 9px box.
          tabBarLabelStyle: {
            fontSize: fontSize.xs,
            fontWeight: fontWeight.medium,
            lineHeight: fontSize.xs * lineHeight.normal,
          },
          // Tall enough for the icon box and the label's line (the token says
          // how). The gesture bar sits under the tab bar on a modern Android
          // device, so the inset is added to the height rather than eating into it.
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
          name="offers"
          options={{
            title: 'Offers',
            tabBarIcon: tabIcon('inbox-arrow-down-outline', 'inbox-arrow-down'),
          }}
        />
        <Tabs.Screen
          name="active"
          options={{ title: 'Active', tabBarIcon: tabIcon('water-outline', 'water') }}
        />
        <Tabs.Screen
          name="menu"
          options={{ title: 'Menu', tabBarIcon: tabIcon('tag-outline', 'tag') }}
        />
        <Tabs.Screen
          name="earnings"
          options={{ title: 'Earnings', tabBarIcon: tabIcon('wallet-outline', 'wallet') }}
        />
        {/* Out of the bar, which holds §14.3's four tabs; reached from the account
            button in every tab's header. Popped to its top on blur (H2), so that
            button always opens the profile, never a registration left underneath. */}
        <Tabs.Screen name="profile" options={{ href: null, popToTopOnBlur: true }} />
      </Tabs>
    </WasherPresenceProvider>
  );
}
