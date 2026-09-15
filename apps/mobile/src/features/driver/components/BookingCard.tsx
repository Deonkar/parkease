import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { DriverBooking } from '@parkease/contracts/driver';
import {
  colors,
  duration,
  fontSize,
  fontWeight,
  radius,
  spacing,
  pressScale,
  spring,
} from '@parkease/tokens';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { formatDateIST, formatTimeIST } from '@/lib/format';
import { formatPaise } from '@/lib/money';

import { BookingStatusChip } from './BookingStatusChip';

interface BookingCardProps {
  readonly booking: DriverBooking;
  readonly onPress: () => void;
}

/** 48dp is Material's floor for a touch target; a whole card clears it easily. */
const MIN_TARGET = 48;

export function BookingCard({ booking, onPress }: BookingCardProps) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const startsAt = new Date(booking.startsAt);
  const endsAt = new Date(booking.endsAt);
  const window = `${formatDateIST(startsAt)} · ${formatTimeIST(startsAt)} – ${formatTimeIST(endsAt)}`;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        if (!reduceMotion) scale.value = withSpring(pressScale, spring.snappy);
      }}
      onPressOut={() => {
        if (!reduceMotion) scale.value = withSpring(1, spring.responsive);
      }}
      accessibilityRole="button"
      accessibilityLabel={`${booking.space.title}, ${window}`}
      accessibilityHint="Opens this booking"
      android_ripple={{ color: colors.primarySoft }}
    >
      <Animated.View style={[styles.card, animatedStyle]}>
        <View style={styles.headRow}>
          <Text style={styles.title} numberOfLines={1}>
            {booking.space.title}
          </Text>
          <BookingStatusChip status={booking.status} />
        </View>

        <Text style={styles.address} numberOfLines={1}>
          {booking.space.addressLine}
        </Text>

        <View style={styles.metaRow}>
          <MaterialCommunityIcons
            name={booking.vehicleType === 'car' ? 'car' : 'motorbike'}
            size={15}
            color={colors.textTertiary}
          />
          <Text style={styles.meta} numberOfLines={1}>
            {window}
          </Text>
        </View>

        <View style={styles.footRow}>
          <Text style={styles.total}>
            {formatPaise(booking.quote.totalPaise, { alwaysDecimals: true })}
          </Text>
          <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textTertiary} />
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: MIN_TARGET,
    gap: spacing.xs,
    padding: spacing.base,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    flex: 1,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  address: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  meta: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.textTertiary,
  },
  footRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  total: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
});

export const BOOKING_CARD_ESTIMATED_HEIGHT = 132;
export const BOOKING_CARD_ANIMATION_MS = duration.fast;
