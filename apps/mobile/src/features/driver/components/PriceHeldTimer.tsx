import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors, fontSize, spacing } from '@parkease/tokens';
import { StyleSheet, Text, View } from 'react-native';

import { useCountdown } from '../hooks/useCountdown';

interface PriceHeldTimerProps {
  readonly deadlineAt: string;
  readonly onExpired?: () => void;
}

/** Below this the tone changes from informative to urgent. */
const URGENT_MS = 60_000;

/**
 * The quote's price hold on Review & Pay.
 *
 * Presentational only — the tick, the threshold and the expiry callback live in
 * `useCountdown`, which the slot-hold bar shares. What differs between the two
 * is what they mean: this one says the *price* may move, the bar says the *slot*
 * may go. Same clock, different consequence, so they stay separate components.
 */
export function PriceHeldTimer({ deadlineAt, onExpired }: PriceHeldTimerProps) {
  const countdown = useCountdown(deadlineAt, { urgentMs: URGENT_MS, onExpired });
  if (countdown === null) return null;

  const tone = countdown.expired || countdown.urgent ? colors.surge : colors.textSecondary;

  return (
    <View style={styles.row}>
      <MaterialCommunityIcons
        name={countdown.expired ? 'timer-off-outline' : 'clock-outline'}
        size={15}
        color={tone}
      />
      <Text style={[styles.text, { color: tone }]}>
        {countdown.expired
          ? 'This hold has expired — start again to get a fresh price'
          : `Price held for ${countdown.label}`}
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
