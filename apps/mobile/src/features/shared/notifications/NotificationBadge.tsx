import { colors, fontSize, fontWeight } from '@parkease/tokens';
import { StyleSheet, Text, View } from 'react-native';

import { useUnreadCount } from './hooks';
import { badgeText } from './routing';

/** The count pill, or nothing at zero. Pure: the caller decides where the number comes from. */
export function NotificationBadge({ count }: { readonly count: number }) {
  const text = badgeText(count);
  if (text === null) return null;
  return (
    <View
      testID="notification-badge"
      accessibilityLabel={`${String(count)} unread`}
      style={styles.pill}
    >
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

/**
 * The count for a tab bar's `tabBarBadge`, in the form React Navigation takes. A failed poll shows
 * no badge rather than a stale zero's absence being mistaken for "all caught up": the feed itself
 * says so, with its own error state.
 */
export function useBadgeText(): string | undefined {
  const { data } = useUnreadCount();
  return data === undefined ? undefined : (badgeText(data) ?? undefined);
}

const styles = StyleSheet.create({
  pill: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.error,
  },
  text: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.textInverse },
});
