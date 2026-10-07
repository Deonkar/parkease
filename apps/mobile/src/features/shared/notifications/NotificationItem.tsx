import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { NotificationCategory, NotificationView } from '@parkease/contracts/shared';
import { colors, fontSize, fontWeight, lineHeight, radius, spacing } from '@parkease/tokens';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { relativeTime } from './routing';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const CATEGORY_ICON: Record<NotificationCategory, IconName> = {
  bookings: 'calendar-check-outline',
  valet: 'car-key',
  carwash: 'car-wash',
  jobs: 'briefcase-outline',
  spaces: 'office-building-outline',
  payouts: 'wallet-outline',
  reviews: 'star-outline',
  account: 'account-check-outline',
  promotions: 'tag-outline',
};

interface NotificationItemProps {
  readonly item: NotificationView;
  readonly now: Date;
  readonly onPress: (item: NotificationView) => void;
}

/**
 * Direction B, "category tiles": an icon tile says what kind of thing this is before a word is
 * read, an unread card is washed in the primary tint, and a failed payout or a rejected listing
 * gets a red tile because it is something the person can fix. Read rows fall back to a plain card
 * with a regular-weight title, so state does not rest on colour alone.
 */
function NotificationItemBase({ item, now, onPress }: NotificationItemProps) {
  const alert = item.actionable;
  const time = relativeTime(item.createdAt, now);
  return (
    <Pressable
      testID={`notification-${item.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${item.isRead ? '' : 'Unread. '}${item.title}. ${item.body}. ${time}`}
      onPress={() => {
        onPress(item);
      }}
      android_ripple={{ color: colors.surfaceTertiary }}
      style={[styles.card, item.isRead ? styles.read : styles.unread]}
    >
      <View style={[styles.tile, alert && styles.tileAlert]}>
        <MaterialCommunityIcons
          accessibilityElementsHidden
          importantForAccessibility="no"
          name={alert ? 'alert-circle-outline' : CATEGORY_ICON[item.category]}
          size={22}
          color={alert ? colors.errorInk : colors.primary}
        />
      </View>
      <View style={styles.text}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, item.isRead && styles.titleRead]} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={styles.time}>{time}</Text>
        </View>
        <Text style={styles.body} numberOfLines={3}>
          {item.body}
        </Text>
      </View>
    </Pressable>
  );
}

export const NotificationItem = memo(NotificationItemBase);

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: spacing.md,
    marginHorizontal: spacing.base,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 72,
  },
  unread: { backgroundColor: colors.infoLight, borderColor: colors.primarySoft },
  read: { backgroundColor: colors.surface, borderColor: colors.border },
  tile: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  tileAlert: { backgroundColor: colors.errorLight },
  text: { flex: 1, gap: spacing.xs / 2 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  title: {
    flex: 1,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  titleRead: { fontWeight: fontWeight.regular },
  time: { fontSize: fontSize.xs, color: colors.textTertiary, paddingTop: 2 },
  body: {
    fontSize: fontSize.sm,
    lineHeight: fontSize.sm * lineHeight.normal,
    color: colors.textSecondary,
  },
});
