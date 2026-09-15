import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors, fontSize, spacing } from '@parkease/tokens';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface PriceHeldTimerProps {
  readonly deadlineAt: string;
  readonly onExpired?: () => void;
}

const TICK_MS = 1000;
/** Below this the tone changes from informative to urgent. */
const URGENT_MS = 60_000;

function remaining(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

function mmss(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}

/**
 * The countdown on Review & Pay.
 *
 * Presentational only. The server owns expiry — `booking.expire-unpaid` runs ten
 * minutes after the booking was created and releases the slot regardless of what
 * this component is showing. That matters for what happens at zero: the timer
 * reports the hold is gone and hands control back to the screen, it does not
 * decide anything. A client-side clock that believed it was authoritative would
 * disagree with the server on every device with a skewed clock.
 */
export function PriceHeldTimer({ deadlineAt, onExpired }: PriceHeldTimerProps) {
  const deadline = new Date(deadlineAt).getTime();
  const [left, setLeft] = useState(() => remaining(deadline));

  useEffect(() => {
    if (Number.isNaN(deadline)) return;

    const id = setInterval(() => {
      const next = remaining(deadline);
      setLeft(next);
      if (next === 0) {
        clearInterval(id);
        onExpired?.();
      }
    }, TICK_MS);

    return () => {
      clearInterval(id);
    };
  }, [deadline, onExpired]);

  if (Number.isNaN(deadline)) return null;

  const expired = left === 0;
  const urgent = !expired && left <= URGENT_MS;
  const tone = expired || urgent ? colors.surge : colors.textSecondary;

  return (
    <View style={styles.row}>
      <MaterialCommunityIcons
        name={expired ? 'timer-off-outline' : 'clock-outline'}
        size={15}
        color={tone}
      />
      <Text style={[styles.text, { color: tone }]}>
        {expired ? 'This hold has expired — start again to get a fresh price' : null}
        {!expired ? `Price held for ${mmss(left)}` : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  text: {
    flex: 1,
    fontSize: fontSize.sm,
    fontVariant: ['tabular-nums'],
  },
});
