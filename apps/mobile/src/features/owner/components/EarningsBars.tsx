import type { OwnerEarningsView } from '@parkease/contracts/owner';
import { colors, fontSize, spacing } from '@parkease/tokens';
import { StyleSheet, Text, View } from 'react-native';

import { formatDayMonthIST } from '@/lib/format';
import { formatPaise } from '@/lib/money';

const HEIGHT = 96;
const MIN_BAR = 2;

// The shared fixed-table formatter (S-41, R-ARCH-07): deterministic across
// ICU builds and, for the axis and the "best day" label, the year would just
// be noise — every day in `days` is already inside the one period on screen.
const dayLabel = (date: string, options?: { weekday?: boolean }) =>
  formatDayMonthIST(new Date(`${date}T00:00:00Z`), options);

/**
 * Daily bars from the server's own buckets (spec §4) — no aggregation here.
 * Height is a display ratio of two server values, not money arithmetic.
 * Bars, not a line: each day is a discrete total, and an empty day should
 * read as empty. The whole chart is one accessible element with a summary.
 */
export function EarningsBars({ days }: { readonly days: OwnerEarningsView['days'] }) {
  if (days.length < 2) return null;
  // Floored at 0: `netPaise` is signed (a refund-heavy period can make every
  // day zero or negative), and a loss is never "the best day" — an empty
  // period gets a neutral summary instead of announcing its smallest loss.
  const peak = Math.max(...days.map((d) => d.netPaise), 0);
  const best = days.reduce((a, b) => (b.netPaise > a.netPaise ? b : a));
  const summary =
    peak > 0
      ? `Best day ${dayLabel(best.date)}, ${formatPaise(best.netPaise, { alwaysDecimals: true })}.`
      : 'No earnings in this period.';

  const first = days[0];
  const last = days[days.length - 1];

  return (
    <View>
      <View
        style={styles.root}
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Daily earnings, ${String(days.length)} days. ${summary}`}
        testID="earnings-bars"
      >
        {days.map((day) => (
          <View
            key={day.date}
            testID="earnings-bar"
            style={[
              styles.bar,
              day.netPaise > 0
                ? { height: Math.max(MIN_BAR, (day.netPaise / peak) * HEIGHT) }
                : styles.empty,
            ]}
          />
        ))}
      </View>
      {/* The chart above already speaks its own summary to TalkBack — this
          row is a visual axis only. */}
      <View style={styles.axis} importantForAccessibility="no">
        <Text style={styles.axisLabel} testID="earnings-axis-first">
          {first ? dayLabel(first.date) : ''}
        </Text>
        <Text style={styles.axisLabel} testID="earnings-axis-last">
          {last ? dayLabel(last.date) : ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs, height: HEIGHT },
  bar: {
    flex: 1,
    backgroundColor: colors.primaryVivid,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  empty: { height: MIN_BAR, backgroundColor: colors.border },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  axisLabel: { fontSize: fontSize.xs, color: colors.textTertiary },
});
