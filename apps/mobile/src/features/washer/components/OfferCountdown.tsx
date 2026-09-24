import { colors, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export interface OfferCountdownProps {
  readonly offeredAt: string;
  readonly expiresAt: string;
  /** Called once, when the offer runs out, so the card can lock Accept. */
  readonly onExpire: () => void;
}

/** How often the countdown re-reads the clock. It shows whole seconds. */
const TICK_MS = 1_000;

function formatCountdown(msLeft: number): string {
  const seconds = Math.floor(Math.max(0, msLeft) / 1000);
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * The time an offer has left, in words and as a bar (H5).
 *
 * It owns its one-second timer, so each tick re-renders this small component
 * and nothing around it: before, the timer lived on the offers screen and the
 * whole list — every card, the rail, the header — re-rendered every second
 * for as long as an offer was on screen.
 */
export function OfferCountdown({ offeredAt, expiresAt, onExpire }: OfferCountdownProps) {
  const [now, setNow] = useState(() => Date.now());
  const expires = Date.parse(expiresAt);
  const window = expires - Date.parse(offeredAt);
  const msLeft = Math.max(0, expires - now);
  const expired = msLeft === 0;

  useEffect(() => {
    if (expired) {
      onExpire();
      return undefined;
    }
    const timer = setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [expired, onExpire]);

  const fraction = window > 0 ? msLeft / window : 0;
  const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  // In-process arithmetic on a clamped number, so the template type holds.
  const fill = `${String(percent)}%` as `${number}%`;

  return (
    <View style={styles.expiry}>
      <Text style={styles.expiryLabel}>{`Expires in ${formatCountdown(msLeft)}`}</Text>
      {/* The words above already say it; the bar is for a glance with wet hands. */}
      <View
        style={styles.track}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={[styles.fill, { width: fill }]} testID="offer-expiry-fill" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  expiry: { marginTop: spacing.base, gap: spacing.sm },
  expiryLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.warning },
  track: {
    height: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceTertiary,
    overflow: 'hidden',
  },
  fill: { height: spacing.xs, borderRadius: radius.full, backgroundColor: colors.warning },
});
