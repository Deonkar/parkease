import { colors, fontSize, lineHeight, radius, spacing } from '@parkease/tokens';
import { Button, ErrorState, Skeleton } from '@parkease/ui-native';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatDistance, formatTimeIST } from '@/lib/format';
import { formatPaise } from '@/lib/money';

import { canPayForWash, WASH_STATUS_COPY } from '../../../src/features/driver/addon-copy';
import {
  DetailRow,
  PartnerCard,
  StatusPanel,
} from '../../../src/features/driver/components/AddonParts';
import { CheckoutSheet } from '../../../src/features/driver/components/CheckoutSheet';
import { WashEvidence } from '../../../src/features/driver/components/WashEvidence';
import {
  useBookingAddons,
  useCancelWash,
  useWashCheckout,
  useWashJob,
} from '../../../src/features/driver/hooks/useAddons';
import { toApiFailure } from '../../../src/features/shared/api/errors';
import { SERVICE_LABELS, VEHICLE_LABELS } from '../../../src/features/shared/carwash-labels';
import { ScreenHeader } from '../../../src/features/shared/components/ScreenHeader';

/**
 * One car wash, as its driver follows and pays for it. Polled while live.
 *
 * The amount is null until a partner accepts, and the screen says "price on
 * acceptance" rather than ₹0 in that window: the number comes from the winning
 * partner's own menu, and until somebody wins there is none (§13.4).
 */
export default function WashJobScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { data: job, isPending, isError, refetch } = useWashJob(jobId);
  const addons = useBookingAddons(job?.bookingId);
  const cancel = useCancelWash(jobId);
  const checkout = useWashCheckout(job);
  const [error, setError] = useState<string | null>(null);

  if (isPending) {
    return (
      <>
        <ScreenHeader title="Your car wash" />
        <View style={[styles.screen, styles.content]}>
          <Skeleton width="100%" height={88} />
          <Skeleton width="100%" height={120} />
        </View>
      </>
    );
  }

  if (isError) {
    return (
      <ErrorState
        title="We couldn't load your car wash"
        body="Check your connection and try again."
        actionLabel="Try again"
        onAction={() => void refetch()}
      />
    );
  }

  const paid =
    checkout.state.phase === 'paid' || (addons.data?.paidWashJobIds.includes(job.id) ?? false);
  const finding = job.status === 'requested' || job.status === 'offered';
  const payable = canPayForWash(job, paid);

  return (
    <>
      <ScreenHeader title="Your car wash" />
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <StatusPanel
          copy={WASH_STATUS_COPY[job.status]}
          icon="car-wash"
          testID={`wash-status-${job.status}`}
        />

        {finding && job.offeredTo > 0 ? (
          <Text style={styles.detail}>
            Asked {String(job.offeredTo)} {job.offeredTo === 1 ? 'partner' : 'partners'} within{' '}
            {formatDistance(job.offerRadiusM)}.
          </Text>
        ) : null}

        {job.washer === null ? null : (
          <PartnerCard
            name={job.washer.businessName ?? job.washer.name}
            subtitle={job.washer.businessName === null ? null : job.washer.name}
            ratingAvgBp={job.washer.ratingAvgBp}
            ratingCount={job.washer.ratingCount}
          />
        )}

        <View style={styles.card}>
          <DetailRow label="Service" value={SERVICE_LABELS[job.serviceName]} />
          <DetailRow label="Vehicle" value={VEHICLE_LABELS[job.vehicleType]} />
          <DetailRow label="Requested" value={formatTimeIST(new Date(job.requestedAt))} />
          {job.pricePaise === null || job.gstPaise === null || job.driverTotalPaise === null ? (
            <DetailRow label="Price" value="Set when a partner accepts" />
          ) : (
            <>
              <DetailRow label="Wash" value={formatPaise(job.pricePaise)} />
              <DetailRow label="GST" value={formatPaise(job.gstPaise)} />
              <DetailRow label="Total" value={formatPaise(job.driverTotalPaise)} />
            </>
          )}
          {job.cancellationReason === null ? null : (
            <DetailRow label="Reason" value={job.cancellationReason} />
          )}
        </View>

        <WashEvidence beforePhotoId={job.beforePhotoId} afterPhotoId={job.afterPhotoId} />

        {paid ? (
          <Text style={styles.paid} accessibilityLiveRegion="polite" testID="wash-paid">
            Payment sent. We confirm it with the bank and send your receipt as a notification.
          </Text>
        ) : null}

        {checkout.state.phase === 'failed' ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {checkout.state.message}
          </Text>
        ) : null}
        {error === null ? null : (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        )}

        {payable && job.driverTotalPaise !== null ? (
          <Button
            label={`Pay ${formatPaise(job.driverTotalPaise)}`}
            testID="wash-pay"
            loading={checkout.state.phase === 'creating-order'}
            onPress={checkout.start}
          />
        ) : null}

        {/* Server-decided (§13.9): free before `washing`, refused from it. */}
        {job.cancellable ? (
          <Button
            label="Cancel wash"
            testID="wash-cancel"
            variant="ghost"
            loading={cancel.isPending}
            onPress={() => {
              Alert.alert('Cancel this wash?', 'The partner will be told straight away.', [
                { text: 'Keep wash', style: 'cancel' },
                {
                  text: 'Cancel wash',
                  style: 'destructive',
                  onPress: () => {
                    setError(null);
                    cancel.mutate(undefined, {
                      onError: (cause) => {
                        setError(toApiFailure(cause).message);
                      },
                    });
                  },
                },
              ]);
            }}
          />
        ) : null}
      </ScrollView>

      {checkout.state.phase === 'checkout' ? (
        <CheckoutSheet
          visible
          params={{
            keyId: checkout.state.order.keyId,
            razorpayOrderId: checkout.state.order.razorpayOrderId,
            amountPaise: checkout.state.order.amountPaise,
            // Checkout's description line: what the driver is buying.
            spaceTitle: checkout.state.order.serviceLabel,
            themeColor: colors.primary,
            prefill: { name: '', contact: '' },
          }}
          onResult={checkout.handleResult}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceSecondary },
  content: { gap: spacing.md, padding: spacing.base, paddingBottom: spacing['2xl'] },
  detail: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: fontSize.sm * lineHeight.normal,
  },
  card: {
    padding: spacing.base,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  paid: {
    fontSize: fontSize.sm,
    color: colors.availableInk,
    lineHeight: fontSize.sm * lineHeight.normal,
  },
  error: {
    fontSize: fontSize.sm,
    color: colors.errorInk,
    lineHeight: fontSize.sm * lineHeight.normal,
  },
});
