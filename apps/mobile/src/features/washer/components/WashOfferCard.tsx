import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { WashJobOffer } from '@parkease/contracts/washer';
import {
  colors,
  elevation,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  spacing,
} from '@parkease/tokens';
import { memo, useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDistance } from '@/lib/format';
import { formatPaise } from '@/lib/money';

import { SERVICE_LABELS, VEHICLE_LABELS } from '../labels';

import { OfferCountdown } from './OfferCountdown';

export interface WashOfferCardProps {
  readonly offer: WashJobOffer;
  /**
   * From the partner's OWN menu row for this service and vehicle — the same row
   * the server priced the earnings from. `null` drops the chip rather than
   * guessing a number.
   */
  readonly durationMinutes: number | null;
  /**
   * Called with this card's job id, so the screen can pass ONE stable callback
   * to every card and the memoised cards stay unrendered (H5).
   */
  readonly onAccept: (jobId: string) => void;
  /** Accept is locked and this says why, in words (R-FE-12). */
  readonly lockedReason?: string;
  /** This card's accept is in flight. */
  readonly accepting?: boolean;
}

/**
 * One wash offer — direction "Bay".
 *
 * The take-home figure is the headline because it is what a partner decides
 * on; the service name under it is how they confirm the decision. That figure
 * is `earningsPaise` from the server, formatted and nothing else: the
 * commission rate does not exist in `apps/mobile`, and a CI grep holds that
 * line (R-FE-06).
 *
 * Locked cards keep the money visible. A partner who can see what they would
 * have earned has a reason to finish verifying; a greyed-out blank does not.
 */
const EXPIRED = 'This offer has expired';

/**
 * Memoised (H5): the countdown inside owns the one-second tick, so a card is
 * re-rendered only when its own props change, not every second.
 */
export const WashOfferCard = memo(function WashOfferCard({
  offer,
  durationMinutes,
  onAccept,
  lockedReason: givenLock,
  accepting = false,
}: WashOfferCardProps) {
  // The id of the offer the countdown saw run out (N1). FlashList RECYCLES a
  // card component across offers, so a plain boolean would carry one offer's
  // expiry into the next and lock a live offer. Holding the job id ties the
  // lock to the offer it belongs to.
  const [expiredJobId, setExpiredJobId] = useState<string | null>(() =>
    Date.parse(offer.expiresAt) <= Date.now() ? offer.jobId : null,
  );
  const { jobId } = offer;
  const markExpired = useCallback(() => {
    setExpiredJobId(jobId);
  }, [jobId]);
  const expired = expiredJobId === jobId;
  const lockedReason = givenLock ?? (expired ? EXPIRED : undefined);
  const locked = lockedReason !== undefined;
  const disabled = locked || accepting;
  const earnings = formatPaise(offer.earningsPaise, { alwaysDecimals: true });
  const service = SERVICE_LABELS[offer.serviceName];

  return (
    <View style={styles.root} testID="wash-offer-card">
      <Text style={styles.eyebrow}>YOU EARN</Text>
      <Text style={styles.earnings} testID="offer-earnings">
        {earnings}
      </Text>

      <Text style={styles.service}>{service}</Text>
      <Text style={styles.vehicle}>{`for a ${VEHICLE_LABELS[offer.vehicleType]}`}</Text>

      <View style={styles.chips}>
        <View style={styles.chip}>
          <MaterialCommunityIcons
            name="map-marker-distance"
            size={16}
            color={colors.textSecondary}
          />
          <Text style={styles.chipLabel}>{`${formatDistance(offer.distanceM)} away`}</Text>
        </View>
        {durationMinutes === null ? null : (
          <View style={styles.chip}>
            <MaterialCommunityIcons name="timer-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.chipLabel}>{`${String(durationMinutes)} min`}</Text>
          </View>
        )}
      </View>

      {/* Keyed by the job: a recycled card starts its countdown from a fresh
          clock, and an offer that is already over reports it on mount. */}
      <OfferCountdown
        key={jobId}
        offeredAt={offer.offeredAt}
        expiresAt={offer.expiresAt}
        onExpire={markExpired}
      />

      <View style={styles.acceptClip}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            locked
              ? `Accept job, unavailable. ${lockedReason}`
              : `Accept ${service} for ${earnings}`
          }
          accessibilityState={{ disabled, busy: accepting }}
          disabled={disabled}
          onPress={() => {
            onAccept(offer.jobId);
          }}
          android_ripple={{ color: colors.primaryDark }}
          style={[styles.accept, locked && styles.acceptLocked]}
          testID="offer-accept"
        >
          {locked ? (
            <MaterialCommunityIcons name="lock-outline" size={18} color={colors.textSecondary} />
          ) : null}
          <Text style={[styles.acceptLabel, locked && styles.acceptLabelLocked]}>
            {accepting ? 'Accepting…' : 'Accept Job'}
          </Text>
        </Pressable>
      </View>

      {locked ? <Text style={styles.lockedReason}>{lockedReason}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.base,
    ...elevation.card,
  },
  eyebrow: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.textTertiary,
    letterSpacing: 0.4,
  },
  earnings: {
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.bold,
    lineHeight: fontSize['3xl'] * lineHeight.tight,
    color: colors.text,
    marginTop: spacing.xs,
  },
  service: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginTop: spacing.md,
  },
  vehicle: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  chipLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
  },
  // The ripple is clipped by its parent on Android, not by its own radius.
  acceptClip: { marginTop: spacing.base, borderRadius: radius.md, overflow: 'hidden' },
  accept: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
  },
  acceptLocked: { backgroundColor: colors.surfaceTertiary },
  acceptLabel: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textInverse },
  acceptLabelLocked: { color: colors.textSecondary },
  lockedReason: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
