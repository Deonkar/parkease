import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  colors,
  duration,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  spacing,
} from '@parkease/tokens';
import { Button, ErrorState, Skeleton } from '@parkease/ui-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatDateIST, formatTimeIST } from '@/lib/format';
import { formatPaise } from '@/lib/money';

import { BookingQr } from '../../../src/features/driver/components/BookingQr';
import { PriceHeldTimer } from '../../../src/features/driver/components/PriceHeldTimer';
import { useBooking } from '../../../src/features/driver/hooks/useBookings';
import { ScreenHeader } from '../../../src/features/shared/components/ScreenHeader';

export default function BookingConfirmedScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { data: booking, isPending, isError, refetch } = useBooking(bookingId);

  if (isPending) {
    return (
      <>
        <ScreenHeader title="Your booking" />
        <View style={[styles.screen, styles.content]}>
          <Skeleton height={64} width={64} borderRadius={32} />
          <Skeleton height={28} width="60%" />
          <Skeleton width="100%" height={232} />
        </View>
      </>
    );
  }

  if (isError) {
    return (
      <ErrorState
        title="We couldn't load this booking"
        body="It is safe — pull up your bookings to find it."
        actionLabel="Try again"
        onAction={() => void refetch()}
      />
    );
  }

  const held = booking.status === 'pending_payment';

  const startsAt = new Date(booking.startsAt);
  const endsAt = new Date(booking.endsAt);
  const mapsUrl = `geo:${String(booking.space.latitude)},${String(booking.space.longitude)}?q=${encodeURIComponent(booking.space.title)}`;

  return (
    <>
      <ScreenHeader title={held ? 'Spot held' : 'Booking confirmed'} />

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          entering={reduceMotion ? undefined : FadeInDown.duration(duration.base)}
          style={styles.hero}
        >
          <View style={[styles.tick, held && styles.tickHeld]}>
            <MaterialCommunityIcons
              name={held ? 'clock-outline' : 'check'}
              size={32}
              color={colors.textInverse}
              accessibilityElementsHidden
            />
          </View>
          <Text style={styles.heading} accessibilityRole="header">
            {held ? 'Spot held for you' : "You're booked"}
          </Text>
        </Animated.View>

        {booking.qrToken === null ? (
          <View style={styles.notice}>
            <MaterialCommunityIcons name="clock-outline" size={18} color={colors.surge} />
            <Text style={styles.noticeText}>
              Your check-in code appears here once this booking is paid for. Card and UPI payment
              arrive in the next release.
            </Text>
          </View>
        ) : (
          <BookingQr token={booking.qrToken} />
        )}

        <View style={styles.card}>
          <Text style={styles.spaceTitle}>{booking.space.title}</Text>
          <Text style={styles.detail}>{booking.space.addressLine}</Text>
          <Text style={styles.detail}>
            {formatDateIST(startsAt)} · {formatTimeIST(startsAt)} to {formatTimeIST(endsAt)}
          </Text>
          <Text style={styles.detail}>
            {formatPaise(booking.quote.totalPaise, { alwaysDecimals: true })}
            {booking.status === 'pending_payment' ? ' due' : ' paid'}
          </Text>
          {booking.slotIndex === null ? null : (
            <Text style={styles.detail}>Slot {String(booking.slotIndex + 1)}</Text>
          )}

          {held && booking.paymentDeadlineAt !== null ? (
            <PriceHeldTimer deadlineAt={booking.paymentDeadlineAt} />
          ) : null}
        </View>
      </ScrollView>

      <View style={[styles.dock, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button
          label="Get directions"
          onPress={() => {
            void Linking.openURL(mapsUrl);
          }}
        />
        {/*
          "Add car wash" is deliberately absent. It belongs on the booking detail
          screen once the booking is `active`, because offering a wash at
          `confirmed` sells a service for a car that has not arrived (prd.md §7.2).
        */}
        <Button
          label="View my bookings"
          variant="secondary"
          onPress={() => {
            router.replace('/(driver)/bookings');
          }}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
  },
  content: {
    gap: spacing.xl,
    padding: spacing.base,
    paddingTop: spacing['2xl'],
    alignItems: 'center',
  },
  hero: {
    alignItems: 'center',
    gap: spacing.md,
  },
  tickHeld: {
    backgroundColor: colors.primary,
  },
  tick: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.available,
  },
  heading: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  card: {
    alignSelf: 'stretch',
    gap: spacing.xs,
    padding: spacing.base,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  spaceTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  detail: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: fontSize.sm * lineHeight.normal,
  },
  notice: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.base,
    borderRadius: radius.md,
    backgroundColor: colors.surgeSoft,
  },
  noticeText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.surge,
  },
  dock: {
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
