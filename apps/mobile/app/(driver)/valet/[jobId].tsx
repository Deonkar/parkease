import { TRACKED_VALET_STATUSES } from '@parkease/contracts/valet';
import { colors, fontSize, lineHeight, radius, spacing } from '@parkease/tokens';
import { Button, ErrorState, Skeleton } from '@parkease/ui-native';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { formatDistance, formatTimeIST } from '@/lib/format';
import { formatPaise } from '@/lib/money';

import { canRequestReturn, VALET_STATUS_COPY } from '../../../src/features/driver/addon-copy';
import {
  DetailRow,
  PartnerCard,
  StatusPanel,
} from '../../../src/features/driver/components/AddonParts';
import { MeetingPointForm } from '../../../src/features/driver/components/MeetingPointForm';
import { ValetMap } from '../../../src/features/driver/components/ValetMap';
import {
  useCancelValet,
  useRequestValetReturn,
  useValetJob,
} from '../../../src/features/driver/hooks/useAddons';
import { useValetTracking } from '../../../src/features/driver/hooks/useValetTracking';
import { newerFix } from '../../../src/features/driver/valet-tracking';
import { toApiFailure } from '../../../src/features/shared/api/errors';
import { ScreenHeader } from '../../../src/features/shared/components/ScreenHeader';

/**
 * One valet job, as its driver follows it. Polled while live (`useValetJob`):
 * the valet moves the job on from their own phone and nothing pushes it here.
 */
export default function ValetJobScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { data: job, isPending, isError, refetch } = useValetJob(jobId);
  const cancel = useCancelValet(jobId);
  const giveBack = useRequestValetReturn(jobId);
  const [returning, setReturning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A status frame on the socket re-reads the job now rather than at the next poll.
  const onStatus = useCallback(() => {
    void refetch();
  }, [refetch]);
  // Tracked only while the server broadcasts: the same list the gateway uses.
  const tracked = job !== undefined && TRACKED_VALET_STATUSES.includes(job.status);
  const socketFix = useValetTracking(jobId, tracked, onStatus);

  if (isPending) {
    return (
      <>
        <ScreenHeader title="Your valet" />
        <View style={[styles.screen, styles.content]}>
          <Skeleton width="100%" height={88} />
          <Skeleton width="100%" height={72} />
        </View>
      </>
    );
  }

  if (isError) {
    return (
      <ErrorState
        title="We couldn't load your valet"
        body="Check your connection and try again."
        actionLabel="Try again"
        onAction={() => void refetch()}
      />
    );
  }

  const copy = VALET_STATUS_COPY[job.status];
  const finding = job.status === 'requested' || job.status === 'offered';

  return (
    <>
      <ScreenHeader title="Your valet" />
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <StatusPanel
            copy={copy}
            icon="account-tie-outline"
            testID={`valet-status-${job.status}`}
          />

          {finding && job.offeredTo > 0 ? (
            <Text style={styles.detail}>
              Asked {String(job.offeredTo)} {job.offeredTo === 1 ? 'valet' : 'valets'} within{' '}
              {formatDistance(job.offerRadiusM)}.
            </Text>
          ) : null}

          {tracked ? <ValetMap fix={newerFix(job.lastKnownLocation, socketFix)} /> : null}

          {job.valet === null ? null : (
            <PartnerCard
              name={job.valet.name}
              subtitle={
                [job.valet.vehicleMake, job.valet.vehicleNumber]
                  .filter((part): part is string => part !== null)
                  .join(' · ') || null
              }
              ratingAvgBp={job.valet.ratingAvgBp}
              ratingCount={job.valet.ratingCount}
            />
          )}

          {/*
            The contact is a mode, never a number (§11.9). Until masked calling
            ships the only variant is a support thread, and its `threadUrl` is a
            server path with no screen in the app yet — so the driver gets the
            reference support needs rather than a button that opens nothing.
          */}
          {job.contact === null ? null : (
            <Text style={styles.detail} testID="valet-contact">
              Need help with your valet? Contact ParkEase support and quote reference{' '}
              {job.id.slice(-8).toUpperCase()}.
            </Text>
          )}

          <View style={styles.card}>
            <DetailRow label="Pickup" value={job.pickupAddress} />
            <DetailRow label="Requested" value={formatTimeIST(new Date(job.requestedAt))} />
            {job.parkedAt === null ? null : (
              <DetailRow label="Parked" value={formatTimeIST(new Date(job.parkedAt))} />
            )}
            {job.outboundLeg.feePaise === null ? null : (
              <DetailRow label="Drop-off leg" value={formatPaise(job.outboundLeg.feePaise)} />
            )}
            {job.returnLeg.feePaise === null ? null : (
              <DetailRow label="Return leg" value={formatPaise(job.returnLeg.feePaise)} />
            )}
            {job.cancellationReason === null ? null : (
              <DetailRow label="Reason" value={job.cancellationReason} />
            )}
          </View>

          {error === null ? null : (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          )}

          {canRequestReturn(job) ? (
            returning ? (
              <MeetingPointForm
                addressLabel="Where should the valet bring your car?"
                submitLabel="Bring my car back"
                submitTestID="valet-return-submit"
                submitting={giveBack.isPending}
                onSubmit={(drop) => {
                  setError(null);
                  giveBack.mutate(drop, {
                    onSuccess: () => {
                      setReturning(false);
                    },
                    onError: (cause) => {
                      setError(toApiFailure(cause).message);
                    },
                  });
                }}
              />
            ) : (
              <Button
                label="Bring my car back"
                testID="valet-request-return"
                onPress={() => {
                  setReturning(true);
                }}
              />
            )
          ) : null}

          {/* Server-decided (§11.2): from `parking` on, a stranger has the keys. */}
          {job.cancellable ? (
            <Button
              label="Cancel valet"
              testID="valet-cancel"
              variant="ghost"
              loading={cancel.isPending}
              onPress={() => {
                Alert.alert('Cancel this valet?', 'The valet will be told straight away.', [
                  { text: 'Keep valet', style: 'cancel' },
                  {
                    text: 'Cancel valet',
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
      </KeyboardAvoidingView>
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
  error: {
    fontSize: fontSize.sm,
    color: colors.errorInk,
    lineHeight: fontSize.sm * lineHeight.normal,
  },
});
