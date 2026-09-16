import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors, fontSize, fontWeight, lineHeight, radius, spacing } from '@parkease/tokens';
import { Button, ErrorState, Skeleton } from '@parkease/ui-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatDateIST, formatTimeIST } from '@/lib/format';

import { BookingQr } from '../../../src/features/driver/components/BookingQr';
import { BookingStatusChip } from '../../../src/features/driver/components/BookingStatusChip';
import { PriceBreakdown } from '../../../src/features/driver/components/PriceBreakdown';
import {
  useBooking,
  useCancelBooking,
  useExtendBooking,
  useSelfCheckIn,
} from '../../../src/features/driver/hooks/useBookings';
import { recoveryFor, toApiFailure } from '../../../src/features/shared/api/errors';
import { ScreenHeader } from '../../../src/features/shared/components/ScreenHeader';

const EXTEND_BY_MS = 3_600_000;

export default function BookingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { data: booking, isPending, isError, refetch } = useBooking(id);

  const cancel = useCancelBooking(id);
  const extend = useExtendBooking(id);
  const checkIn = useSelfCheckIn(id);
  const [actionError, setActionError] = useState<string | null>(null);
  const [extendRecovery, setExtendRecovery] = useState(false);

  if (isPending) {
    return (
      <>
        <ScreenHeader title="Your booking" />
        <View style={[styles.screen, styles.content]}>
          <Skeleton height={28} width="60%" />
          <Skeleton width="100%" height={96} />
          <Skeleton width="100%" height={160} />
        </View>
      </>
    );
  }

  if (isError) {
    return (
      <ErrorState
        title="We couldn't load this booking"
        body="Check your connection and try again."
        actionLabel="Try again"
        onAction={() => void refetch()}
      />
    );
  }

  const startsAt = new Date(booking.startsAt);
  const endsAt = new Date(booking.endsAt);
  const mapsUrl = `geo:${String(booking.space.latitude)},${String(booking.space.longitude)}?q=${encodeURIComponent(booking.space.title)}`;

  const isLive = booking.status === 'confirmed' || booking.status === 'active';
  const canCancel = isLive;
  const canExtend = isLive;
  // Self check-in is the unattended-space fallback. The server refuses it until
  // ten minutes after the start, and answers CHECK_IN_TOO_EARLY with copy that
  // says so — offering the button and letting the server judge keeps one source
  // of truth for the window rather than racing it with a device clock.
  const canSelfCheckIn = booking.status === 'confirmed';

  const busy = cancel.isPending || extend.isPending || checkIn.isPending;

  const runAction = (
    action: { mutateAsync: (input: never) => Promise<unknown> },
    input: unknown,
    onExtensionConflict?: () => void,
  ) => {
    setActionError(null);
    setExtendRecovery(false);
    void action.mutateAsync(input as never).catch((error: unknown) => {
      const failure = toApiFailure(error);
      setActionError(failure.message);
      if (recoveryFor(failure) === 'find-another-spot') onExtensionConflict?.();
    });
  };

  return (
    <>
      <ScreenHeader title="Your booking" />

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headRow}>
          <Text style={styles.title}>{booking.space.title}</Text>
          <BookingStatusChip status={booking.status} />
        </View>
        <Text style={styles.detail}>{booking.space.addressLine}</Text>
        <Text style={styles.detail}>
          {formatDateIST(startsAt)} · {formatTimeIST(startsAt)} to {formatTimeIST(endsAt)}
        </Text>

        {booking.qrToken === null ? null : (
          <View style={styles.qrCard}>
            <BookingQr token={booking.qrToken} size={180} />
          </View>
        )}

        {booking.checkedInAt === null ? null : (
          <View style={styles.infoRow}>
            <MaterialCommunityIcons
              name="check-decagram-outline"
              size={16}
              color={colors.availableInk}
            />
            <Text style={styles.infoText}>
              Checked in at {formatTimeIST(new Date(booking.checkedInAt))}
              {booking.checkInMethod === 'driver_fallback' ? ' (self check-in)' : ''}
            </Text>
          </View>
        )}

        <View style={styles.card}>
          {/*
            A booking read back from history carries the multiplier it was
            priced at, but not the tier — the tier lives on the live space, and
            re-deriving it here would mean the client owning a copy of a ladder
            the admin can change (task-10 §10.4). The line names the number.
          */}
          <PriceBreakdown quote={booking.quote} surgeBadge={null} />
        </View>

        {actionError === null ? null : (
          <View style={styles.notice}>
            <MaterialCommunityIcons name="alert-circle-outline" size={18} color={colors.errorInk} />
            <View style={styles.noticeBody}>
              <Text style={styles.noticeText}>{actionError}</Text>
              {extendRecovery ? (
                <Button
                  label="Find another spot"
                  variant="ghost"
                  onPress={() => {
                    router.replace('/(driver)');
                  }}
                />
              ) : null}
            </View>
          </View>
        )}

        {canExtend ? (
          <Pressable
            onPress={() => {
              runAction(extend, new Date(endsAt.getTime() + EXTEND_BY_MS).toISOString(), () => {
                setExtendRecovery(true);
              });
            }}
            disabled={busy}
            style={styles.quietAction}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
          >
            <MaterialCommunityIcons name="clock-plus-outline" size={17} color={colors.primary} />
            <Text style={styles.quietActionText}>
              {extend.isPending ? 'Extending…' : 'Extend by 1 hour'}
            </Text>
          </Pressable>
        ) : null}

        {/*
          Cancelling lives at the bottom of the content, not in the dock. A
          destructive action does not belong in the same zone as the thing the
          driver came here to do, and four stacked buttons above the fold left no
          primary at all.
        */}
        {canCancel ? (
          <Pressable
            onPress={() => {
              Alert.alert(
                'Cancel this booking?',
                `Your spot at ${booking.space.title} will go back on sale.`,
                [
                  { text: 'Keep it', style: 'cancel' },
                  {
                    text: 'Cancel booking',
                    style: 'destructive',
                    onPress: () => {
                      runAction(cancel, undefined);
                    },
                  },
                ],
              );
            }}
            disabled={busy}
            style={styles.quietAction}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
          >
            <Text style={styles.cancelText}>Cancel this booking</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {/*
        One primary action, decided by status. `confirmed` means the driver is on
        their way, so directions lead; once they can self check in, arriving is
        the thing they came to the screen for.
      */}
      <View style={[styles.dock, { paddingBottom: insets.bottom + spacing.md }]}>
        {canSelfCheckIn ? (
          <>
            <Button
              label="I've arrived"
              loading={checkIn.isPending}
              disabled={busy}
              onPress={() => {
                runAction(checkIn, undefined);
              }}
              accessibilityLabel="Check myself in. Available ten minutes after the booking starts, if the owner has not scanned you"
            />
            <Button
              label="Get directions"
              variant="secondary"
              onPress={() => {
                void Linking.openURL(mapsUrl);
              }}
            />
          </>
        ) : (
          <Button
            label="Get directions"
            onPress={() => {
              void Linking.openURL(mapsUrl);
            }}
          />
        )}
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
    gap: spacing.sm,
    padding: spacing.base,
    paddingBottom: spacing['2xl'],
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    flex: 1,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  detail: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: fontSize.sm * lineHeight.normal,
  },
  qrCard: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    marginTop: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  infoText: {
    fontSize: fontSize.sm,
    color: colors.availableInk,
  },
  card: {
    marginTop: spacing.md,
    padding: spacing.base,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.base,
    borderRadius: radius.md,
    backgroundColor: colors.errorLight,
  },
  noticeBody: {
    flex: 1,
    gap: spacing.sm,
  },
  noticeText: {
    fontSize: fontSize.sm,
    color: colors.errorInk,
    lineHeight: fontSize.sm * lineHeight.normal,
  },
  quietAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: 48,
    marginTop: spacing.sm,
  },
  quietActionText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.primary,
  },
  cancelText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textDecorationLine: 'underline',
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
