import { colors, fontSize, spacing } from '@parkease/tokens';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useUnreadCount } from './hooks';
import { NotificationBadge } from './NotificationBadge';

/**
 * The profile entry to the feed for roles whose bottom bar has no Alerts tab. Same look as the
 * Switch role and Settings rows beside it, with the unread count where the chevron's neighbour
 * would be.
 */
export function NotificationsRow() {
  const { data } = useUnreadCount();
  const count = data ?? 0;
  return (
    <Pressable
      testID="notifications-row"
      onPress={() => {
        router.push('/(shared)/notifications');
      }}
      style={styles.item}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `Notifications, ${String(count)} unread` : 'Notifications'}
    >
      <Text style={styles.text}>Notifications</Text>
      <View style={styles.end}>
        <NotificationBadge count={count} />
        <Text style={styles.chevron}>{'›'}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    minHeight: 48,
  },
  text: { fontSize: fontSize.base, color: colors.text },
  end: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chevron: { fontSize: fontSize.xl, color: colors.textTertiary },
});
