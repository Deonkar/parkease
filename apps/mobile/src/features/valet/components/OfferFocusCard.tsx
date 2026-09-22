import type { ValetOffer } from '@parkease/contracts/valet';
import { colors, fontSize, fontWeight, lineHeight, radius, spacing } from '@parkease/tokens';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatPaise } from '@/lib/money';

export interface OfferFocusCardProps {
  readonly offer: ValetOffer;
  /** 1-based position in the offer set. */
  readonly position: number;
  readonly total: number;
  readonly onAccept: () => void;
  readonly onSkip: () => void;
  /** Pending verification: the accept is locked and says why. */
  readonly lockedReason?: string;
  readonly expiresInLabel?: string;
}

/**
 * One offer, filling the screen — direction "Focus".
 *
 * `earningsPaise` is rendered and nothing else. It is already the valet's net,
 * computed server-side by `computeValetLegFee`; the commission rate does not
 * exist anywhere in `apps/mobile` and a CI grep enforces that (R-FE-06).
 *
 * Showing one offer at a time costs the valet the ability to compare, so the
 * position counter and the skip label both name the set explicitly: a card that
 * said only "Skip" would read as "discard" rather than "show me the next one".
 */
export function OfferFocusCard({
  offer,
  position,
  total,
  onAccept,
  onSkip,
  lockedReason,
  expiresInLabel,
}: OfferFocusCardProps) {
  const locked = lockedReason !== undefined;
  const earnings = formatPaise(offer.earningsPaise, { alwaysDecimals: true });

  return (
    <View style={styles.root} testID="offer-focus-card">
      <View style={styles.meta}>
        <Text style={styles.position}>{`Offer ${String(position)} of ${String(total)}`}</Text>
        {expiresInLabel === undefined ? null : (
          <Text style={styles.expiry}>{`${expiresInLabel} left`}</Text>
        )}
      </View>

      <Text style={styles.address}>{offer.pickupAddress}</Text>
      <Text style={styles.distance}>{`${String(offer.distanceM)} m away · pickup now`}</Text>

      <View style={styles.earningsPanel}>
        <Text style={styles.earningsLabel}>YOU EARN</Text>
        <Text style={styles.earnings} testID="offer-earnings">
          {earnings}
        </Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            locked ? `Accept job, locked. ${lockedReason}` : `Accept job for ${earnings}`
          }
          accessibilityState={{ disabled: locked }}
          disabled={locked}
          onPress={onAccept}
          style={[styles.accept, locked && styles.acceptLocked]}
        >
          <Text style={[styles.acceptLabel, locked && styles.acceptLabelLocked]}>Accept Job</Text>
        </Pressable>

        {locked ? (
          <Text style={styles.lockedReason}>{lockedReason}</Text>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Skip this offer and show the next one"
            onPress={onSkip}
            style={styles.skip}
          >
            <Text style={styles.skipLabel}>Skip — show next offer</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.base,
    gap: spacing.base,
  },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  position: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.textTertiary,
    letterSpacing: 0.4,
  },
  expiry: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.warning,
    backgroundColor: colors.warningLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  address: {
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
    lineHeight: fontSize['3xl'] * lineHeight.tight,
  },
  distance: { fontSize: fontSize.base, color: colors.textSecondary, fontWeight: fontWeight.medium },
  earningsPanel: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
  },
  earningsLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.textTertiary,
    letterSpacing: 0.4,
  },
  earnings: { fontSize: 44, fontWeight: fontWeight.bold, color: colors.text },
  actions: { marginTop: 'auto', gap: spacing.sm },
  accept: {
    height: 68,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptLocked: { backgroundColor: colors.border },
  acceptLabel: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.textInverse,
  },
  acceptLabelLocked: { color: colors.muted },
  skip: { height: 48, alignItems: 'center', justifyContent: 'center' },
  skipLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.textSecondary,
  },
  lockedReason: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
});
