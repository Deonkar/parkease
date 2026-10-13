import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fontSize, iconSize, spacing } from '@parkease/tokens';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useIsOnline } from '@/lib/offline';

/**
 * The one place the app says it has no network (S-150). Persistent while offline, over every
 * screen, and announced once by screen readers as it appears. It says what still works: saved
 * screens show, and anything the person does is sent when the signal returns.
 */
export function OfflineBanner() {
  const online = useIsOnline();
  const insets = useSafeAreaInsets();
  if (online) return null;

  return (
    <View
      testID="offline-banner"
      style={[styles.banner, { paddingTop: insets.top + spacing.xs }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <MaterialCommunityIcons name="wifi-off" size={iconSize.sm} color={colors.textInverse} />
      <Text style={styles.text}>
        You&apos;re offline. Showing what was saved; anything you do will send when you&apos;re
        back.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.sm,
    backgroundColor: colors.text,
  },
  text: {
    flex: 1,
    color: colors.textInverse,
    fontSize: fontSize.sm,
  },
});
