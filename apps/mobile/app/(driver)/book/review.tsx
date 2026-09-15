import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors, fontSize, fontWeight, lineHeight, radius, spacing } from '@parkease/tokens';
import { Button, Skeleton } from '@parkease/ui-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatDateIST, formatTimeIST } from '@/lib/format';
import { formatPaise } from '@/lib/money';

import { PriceBreakdown } from '../../../src/features/driver/components/PriceBreakdown';
import {
  useCreateBooking,
  useQuote,
  useSpaceDetail,
} from '../../../src/features/driver/hooks/useBookings';
import { recoveryFor, toApiFailure } from '../../../src/features/shared/api/errors';
import { ScreenHeader } from '../../../src/features/shared/components/ScreenHeader';

/**
 * Route params arrive as strings, always. The narrower unions the API wants are
 * re-established below rather than asserted here, because `useLocalSearchParams`
 * will happily hand back whatever is in the URL.
 */
type ReviewParams = {
  spaceId: string;
  vehicleType: string;
  durationType: string;
  startsAt: string;
  endsAt: string;
  vehicleNumber?: string;
};

const VEHICLE_TYPES = ['car', 'two_wheeler'] as const;
const DURATION_TYPES = ['hourly', 'daily', 'weekly', 'monthly'] as const;

type VehicleType = (typeof VEHICLE_TYPES)[number];
type DurationType = (typeof DURATION_TYPES)[number];

const asVehicleType = (value: string): VehicleType =>
  (VEHICLE_TYPES as readonly string[]).includes(value) ? (value as VehicleType) : 'car';

const asDurationType = (value: string): DurationType =>
  (DURATION_TYPES as readonly string[]).includes(value) ? (value as DurationType) : 'hourly';

/**
 * Review & Pay. The breakdown is fetched before the driver commits, from
 * `GET /driver/quotes`, which prices the window and reserves nothing — so
 * looking at the price does not take a slot off the market for ten minutes.
 *
 * Every number on this screen comes from the server. The app never multiplies a
 * rate and never adds GST (R-FE-06).
 *
 * Until task 9 wires Razorpay the flow stops at `pending_payment`, which is why
 * the button says "hold" and not "pay": a Pay button that takes no money is a
 * lie the driver only discovers on the next screen.
 */
export default function ReviewAndPayScreen() {
  const params = useLocalSearchParams<ReviewParams>();
  const vehicleType = asVehicleType(params.vehicleType);
  const durationType = asDurationType(params.durationType);
  const insets = useSafeAreaInsets();
  const { data: space } = useSpaceDetail(params.spaceId);
  const createBooking = useCreateBooking();

  const quote = useQuote({
    spaceId: params.spaceId,
    vehicleType,
    durationType,
    startsAt: params.startsAt,
    endsAt: params.endsAt,
  });

  const startsAt = useMemo(() => new Date(params.startsAt), [params.startsAt]);
  const endsAt = useMemo(() => new Date(params.endsAt), [params.endsAt]);

  const failure = createBooking.error === null ? null : toApiFailure(createBooking.error);

  const reserve = () => {
    createBooking.mutate(
      {
        spaceId: params.spaceId,
        vehicleType,
        durationType,
        startsAt: params.startsAt,
        endsAt: params.endsAt,
        ...(params.vehicleNumber === undefined ? {} : { vehicleNumber: params.vehicleNumber }),
      },
      {
        onSuccess: (created) => {
          router.replace({
            pathname: '/(driver)/book/confirmed',
            params: { bookingId: created.id },
          });
        },
      },
    );
  };

  return (
    <>
      <ScreenHeader title="Review & pay" />

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <Text style={styles.spaceTitle}>{space?.title ?? 'This space'}</Text>

          {/*
            The window as a sentence, not as fields. Direction C guesses the
            default, and a default nobody reads is a wrong booking — this line,
            directly above the money, is what stops that.
          */}
          <Text style={styles.window}>
            {vehicleType === 'car' ? 'Car' : 'Two-wheeler'} · {formatDateIST(startsAt)} ·{' '}
            {formatTimeIST(startsAt)} to {formatTimeIST(endsAt)}
          </Text>

          {params.vehicleNumber === undefined ? null : (
            <Text style={styles.plate}>{params.vehicleNumber}</Text>
          )}

          <Pressable
            onPress={() => {
              router.replace({
                pathname: '/(driver)/book/[spaceId]',
                params: { spaceId: params.spaceId },
              });
            }}
            style={styles.editRow}
            accessibilityRole="button"
            accessibilityLabel="Change the time or vehicle for this booking"
            hitSlop={8}
          >
            <MaterialCommunityIcons name="pencil-outline" size={15} color={colors.primary} />
            <Text style={styles.editText}>Change time or vehicle</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          {quote.isPending ? (
            <>
              <Skeleton width="40%" height={18} />
              <View style={{ height: spacing.md }} />
              <Skeleton width="100%" height={92} />
            </>
          ) : quote.isError ? (
            <Text style={styles.quoteError}>{toApiFailure(quote.error).message}</Text>
          ) : (
            <PriceBreakdown quote={quote.data.quote} />
          )}
        </View>

        {failure === null ? null : <FailureNotice failure={failure} spaceId={params.spaceId} />}
      </ScrollView>

      <View style={[styles.dock, { paddingBottom: insets.bottom + spacing.md }]}>
        {/*
          The button says what it actually does. Payment lands in task 9, so
          committing here reserves the slot and starts the ten-minute hold — and
          a button labelled "Pay" that takes no money would be a lie the driver
          only discovers on the next screen.
        */}
        <Button
          label={
            quote.data === undefined
              ? 'Hold this spot'
              : `Hold this spot · ${formatPaise(quote.data.quote.totalPaise, { alwaysDecimals: true })}`
          }
          loading={createBooking.isPending}
          disabled={quote.data === undefined}
          onPress={reserve}
        />
        <Text style={styles.dockNote}>
          We&rsquo;ll keep it for 10 minutes. Nothing is charged yet.
        </Text>
      </View>
    </>
  );
}

/**
 * A 409 with no way forward is what makes a legitimate refusal feel like a
 * defect, so every failure the booking flow knows about carries its next step.
 */
function FailureNotice({
  failure,
  spaceId,
}: {
  readonly failure: ReturnType<typeof toApiFailure>;
  readonly spaceId: string;
}) {
  const recovery = recoveryFor(failure);

  return (
    <View style={[styles.notice, styles.noticeError]}>
      <MaterialCommunityIcons name="alert-circle-outline" size={18} color={colors.errorInk} />
      <View style={styles.noticeBody}>
        <Text style={styles.noticeTextError}>{failure.message}</Text>

        {recovery === 'back-to-search' ? (
          <Pressable
            onPress={() => {
              router.replace('/(driver)');
            }}
            hitSlop={8}
            accessibilityRole="button"
            style={styles.noticeAction}
          >
            <Text style={styles.noticeActionText}>Find another spot</Text>
          </Pressable>
        ) : null}

        {recovery === 'none' && failure.code !== 'NETWORK' ? (
          <Pressable
            onPress={() => {
              router.replace({ pathname: '/(shared)/space/[id]', params: { id: spaceId } });
            }}
            hitSlop={8}
            accessibilityRole="button"
            style={styles.noticeAction}
          >
            <Text style={styles.noticeActionText}>Back to this space</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
  },
  content: {
    gap: spacing.md,
    padding: spacing.base,
    paddingBottom: spacing['2xl'],
  },
  card: {
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
  window: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: fontSize.sm * lineHeight.normal,
  },
  plate: {
    fontSize: fontSize.sm,
    color: colors.textTertiary,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 48,
  },
  editText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.primary,
  },
  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.base,
    borderRadius: radius.md,
  },
  noticeError: {
    backgroundColor: colors.errorLight,
  },
  noticeBody: {
    flex: 1,
    gap: spacing.xs,
  },
  noticeTextError: {
    fontSize: fontSize.sm,
    color: colors.errorInk,
    lineHeight: fontSize.sm * lineHeight.normal,
  },
  noticeAction: {
    minHeight: 48,
    justifyContent: 'center',
  },
  noticeActionText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.primary,
  },
  quoteError: {
    fontSize: fontSize.sm,
    color: colors.errorInk,
    lineHeight: fontSize.sm * lineHeight.normal,
  },
  dockNote: {
    fontSize: fontSize.xs,
    color: colors.textTertiary,
    textAlign: 'center',
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
