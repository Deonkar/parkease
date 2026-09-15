import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import { StyleSheet, Text, View } from 'react-native';

import { useCountdown } from '../hooks/useCountdown';

interface SlotHeldBarProps {
  /** When `booking.expire-unpaid` will release the slot. */
  readonly deadlineAt: string;
  readonly onExpired?: () => void;
}

/**
 * Under two minutes the bar turns amber. Chosen, not arbitrary: it is roughly
 * how long a UPI round trip plus one retry takes, so it marks the point where a
 * second attempt genuinely might not fit.
 */
const URGENT_MS = 120_000;

/**
 * The slot hold, pinned under the app bar from the moment the booking is
 * reserved until it is paid for.
 *
 * It answers the only question a driver has while paying: *how long have I got?*
 * Before this existed the answer was a line of body copy they had already
 * scrolled past, which is the same as no answer.
 *
 * Colour is never the only signal (R-FE-12): the icon changes with the tone and
 * the label always spells out the state, so the amber and the green are
 * reinforcement rather than information.
 */
export function SlotHeldBar({ deadlineAt, onExpired }: SlotHeldBarProps) {
  const countdown = useCountdown(deadlineAt, { urgentMs: URGENT_MS, onExpired });
  if (countdown === null) return null;

  if (countdown.expired) {
    return (
      <View style={[styles.bar, styles.barExpired]}>
        <MaterialCommunityIcons name="timer-off-outline" size={15} color={colors.errorInk} />
        <Text style={[styles.label, { color: colors.errorInk }]}>
          This hold has expired — the spot is back on the map
        </Text>
      </View>
    );
  }

  const urgent = countdown.urgent;

  return (
    <View
      style={[styles.bar, urgent ? styles.barUrgent : styles.barHolding]}
      accessibilityRole="text"
      // Screen readers get the sentence, not "9:41" stranded without its noun.
      accessibilityLabel={`Your spot is held for ${countdown.label} more`}
    >
      <MaterialCommunityIcons
        name={urgent ? 'clock-alert-outline' : 'clock-outline'}
        size={15}
        color={urgent ? colors.surge : colors.availableInk}
      />
      <Text style={[styles.label, { color: urgent ? colors.surge : colors.availableInk }]}>
        Spot held
      </Text>
      <Text style={[styles.time, { color: urgent ? colors.surge : colors.availableInk }]}>
        {countdown.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
  },
  barHolding: {
    backgroundColor: colors.availableSoft,
  },
  barUrgent: {
    backgroundColor: colors.surgeSoft,
  },
  barExpired: {
    backgroundColor: colors.errorLight,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    flex: 1,
  },
  time: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    fontVariant: ['tabular-nums'],
  },
});
