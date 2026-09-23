import { colors, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import { StyleSheet, Text, View } from 'react-native';

const MINUTE_MS = 60_000;

/**
 * Whole minutes since `startedAt`, never negative — a phone clock a little
 * behind the server's must not show a wash running backwards. Time, not money:
 * nothing here is priced.
 */
export function elapsedMinutesSince(startedAt: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - Date.parse(startedAt)) / MINUTE_MS));
}

export interface ElapsedBarProps {
  readonly elapsedMinutes: number;
  /** The partner's own quote for this service, from their menu. */
  readonly durationMinutes: number;
}

/**
 * Elapsed against the partner's own estimate — presentational only (§6.2).
 *
 * It stops at the estimate and stays there: "40 / 40 min", never "55 / 40". A
 * wash running long is normal, not an error, and a number climbing past the
 * quote reads as a penalty clock. It drives no server action.
 */
export function ElapsedBar({ elapsedMinutes, durationMinutes }: ElapsedBarProps) {
  const shown = Math.min(elapsedMinutes, durationMinutes);
  const fraction = durationMinutes > 0 ? Math.min(1, shown / durationMinutes) : 1;
  // A clamped in-process number, so the template type holds.
  const width = `${String(Math.round(fraction * 100))}%` as `${number}%`;

  return (
    <View style={styles.root}>
      <View style={styles.head}>
        <Text style={styles.label}>Time on this wash</Text>
        <Text style={styles.value}>{`${String(shown)} / ${String(durationMinutes)} min`}</Text>
      </View>
      <View
        testID="elapsed-bar"
        style={styles.track}
        accessibilityRole="progressbar"
        accessibilityLabel="Time on this wash"
        accessibilityValue={{ min: 0, max: durationMinutes, now: shown }}
      >
        <View testID="elapsed-fill" style={[styles.fill, { width }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  label: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.textSecondary },
  value: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.text },
  track: {
    height: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceTertiary,
    overflow: 'hidden',
  },
  // A large fill with its own words beside it: the vivid tone is allowed here.
  fill: { height: spacing.sm, borderRadius: radius.full, backgroundColor: colors.primaryVivid },
});
