import type { OwnerEarningsView } from '@parkease/contracts/owner';
import { colors, spacing } from '@parkease/tokens';
import { StyleSheet, View } from 'react-native';

import { formatDateIST } from '@/lib/format';
import { formatPaise } from '@/lib/money';

const HEIGHT = 96;
const MIN_BAR = 2;

// `toLocaleDateString('en-IN', { month: 'short' })` prints "Sept" (4 letters)
// on this Node/ICU build rather than "Sep" — see S-41. `formatDateIST` goes
// through the same locale call, so it carries the same "Sept" and also the
// year; that is accepted as its real output rather than reimplementing a
// second date formatter here (R-ARCH-07).
const dayLabel = (date: string) => formatDateIST(new Date(`${date}T00:00:00Z`));

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

  return (
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
});
