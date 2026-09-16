import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { DriverBooking } from '@parkease/contracts/driver';
import type { Paise } from '@parkease/contracts/primitives';
import { colors, fontSize, fontWeight, lineHeight, radius, spacing } from '@parkease/tokens';
import { Button, Skeleton } from '@parkease/ui-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatDateIST, formatTimeIST } from '@/lib/format';
import { formatPaise } from '@/lib/money';

import { CheckoutSheet } from '../../../src/features/driver/components/CheckoutSheet';
import { PaymentFailedSheet } from '../../../src/features/driver/components/PaymentFailedSheet';
import { PriceBreakdown } from '../../../src/features/driver/components/PriceBreakdown';
import { SlotHeldBar } from '../../../src/features/driver/components/SlotHeldBar';
import {
  useCreateBooking,
  useQuote,
  useSpaceDetail,
} from '../../../src/features/driver/hooks/useBookings';
import { useCheckout } from '../../../src/features/driver/hooks/useCheckout';
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
 * The whole flow is one screen: reserve the slot, then pay, with no method
 * picker of our own. Razorpay owns which methods actually work for a given
 * order, and a list of ours saying "Wallet" when Razorpay has disabled wallets
 * is a promise we cannot keep.
 *
 * Once the slot is reserved, `SlotHeldBar` pins the countdown under the header
 * and keeps it there. It answers the only question a driver has while paying —
 * how long have I got — which used to be a line of body copy they had already
 * scrolled past.
 *
 * A failure arrives as a sheet over this screen rather than a screen replacing
 * it, so the total, the window and the countdown stay visible at exactly the
 * moment the driver is deciding whether to spend money again.
 */
export default function ReviewAndPayScreen() {
  const params = useLocalSearchParams<ReviewParams>();
  const vehicleType = asVehicleType(params.vehicleType);
  const durationType = asDurationType(params.durationType);
  const insets = useSafeAreaInsets();
  const { data: space } = useSpaceDetail(params.spaceId);
  const createBooking = useCreateBooking();

  // The reserved booking stays on this screen rather than being navigated away
  // from. Direction C: the countdown, the total and the window all have to stay
  // visible while the driver pays, and a route change takes all three away.
  const [held, setHeld] = useState<DriverBooking | null>(null);
  const checkout = useCheckout(held?.id);

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
        // The slot is held; payment is the next step on this same screen.
        onSuccess: setHeld,
      },
    );
  };

  /** Reserve on the first tap, pay on every tap after it. */
  const onPrimaryPress = (): void => {
    if (held === null) {
      reserve();
      return;
    }
    checkout.start();
  };

  useEffect(() => {
    if (checkout.state.phase !== 'confirmed') return;
    router.replace({
      pathname: '/(driver)/book/confirmed',
      params: { bookingId: checkout.state.bookingId },
    });
  }, [checkout.state]);

  return (
    <>
      <ScreenHeader title="Review & pay" />

      {/*
        Pinned, not scrolled with the content. An answer that scrolls off screen
        is the same as no answer.
      */}
      {held?.paymentDeadlineAt == null ? null : (
        <View style={styles.holdBar}>
          <SlotHeldBar
            deadlineAt={held.paymentDeadlineAt}
            onExpired={() => {
              // The server already released the slot. Dropping back to the
              // unreserved state is the honest thing to show — the alternative
              // is a Pay button for a spot somebody else now has.
              setHeld(null);
            }}
          />
        </View>
      )}

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
            <PriceBreakdown quote={quote.data.quote} surgeBadge={space?.surgeBadge ?? null} />
          )}
        </View>

        {failure === null ? null : <FailureNotice failure={failure} spaceId={params.spaceId} />}
      </ScrollView>

      <View style={[styles.dock, { paddingBottom: insets.bottom + spacing.md }]}>
        {/*
          The button says what it actually does at each step: it holds the spot
          before one is reserved and it pays once one is. A "Pay" label on a tap
          that only reserves is a lie the driver discovers a screen later.
        */}
        <Button
          label={payLabel(held !== null, quote.data?.quote.totalPaise)}
          loading={
            createBooking.isPending ||
            checkout.state.phase === 'creating-order' ||
            checkout.state.phase === 'verifying'
          }
          disabled={quote.data === undefined}
          onPress={onPrimaryPress}
        />
        <Text style={styles.dockNote}>
          {held === null
            ? 'We’ll keep it for 10 minutes. Nothing is charged yet.'
            : 'Payments handled by Razorpay. Card details never reach ParkEase.'}
        </Text>
      </View>

      {checkout.state.phase === 'checkout' ? (
        <CheckoutSheet
          visible
          params={{
            keyId: checkout.state.order.keyId,
            razorpayOrderId: checkout.state.order.razorpayOrderId,
            amountPaise: checkout.state.order.amountPaise,
            spaceTitle: checkout.state.order.spaceTitle,
            // From the tokens, never a hex at the call site (R-FE-09). Task 9's
            // own mock says "brand orange"; orange was a direction that was not
            // chosen, and CLAUDE.md rejects it.
            themeColor: colors.primary,
            prefill: { name: '', contact: '' },
            ...(checkout.state.method === undefined ? {} : { method: checkout.state.method }),
          }}
          onResult={checkout.handleResult}
        />
      ) : null}

      <PaymentFailedSheet
        visible={checkout.state.phase === 'failed'}
        canChangeMethod={checkout.state.phase === 'failed' && checkout.state.method !== null}
        onTryAgain={() => {
          // Same intent, same idempotency key, so the server reuses the order it
          // already made rather than minting a second (R-FE-05).
          checkout.start(
            checkout.state.phase === 'failed' ? (checkout.state.method ?? undefined) : undefined,
          );
        }}
        onChangeMethod={() => {
          // No prefill, so Razorpay opens on its full method list.
          checkout.start();
        }}
        onDismiss={checkout.dismissFailure}
      />
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

/**
 * One button, two jobs, and the label has to say which one it is doing. The
 * amount is only ever a server field rendered back (R-FE-06).
 */
function payLabel(isHeld: boolean, totalPaise: Paise | undefined): string {
  if (totalPaise === undefined) return isHeld ? 'Pay' : 'Hold this spot';
  const amount = formatPaise(totalPaise, { alwaysDecimals: true });
  return isHeld ? `Pay ${amount}` : `Hold this spot · ${amount}`;
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
  holdBar: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
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
