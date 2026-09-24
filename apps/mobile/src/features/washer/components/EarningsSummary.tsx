import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { WasherEarningsPeriod, WasherEarningsSummary } from '@parkease/contracts/washer';
import { colors, fontSize, fontWeight, lineHeight, radius, spacing } from '@parkease/tokens';
import { StyleSheet, Text, View } from 'react-native';

import { formatPaise } from '@/lib/money';

import { PERIOD_LABELS } from '../labels';

/**
 * The headline counts by posting time and the rows by completion time; this says
 * so in a partner's words, on every summary, with no condition (ruling T9-I1).
 */
const CAPTION = 'Counted when you accept a wash. Completed washes are listed below.';

export interface EarningsSummaryProps {
  readonly period: WasherEarningsPeriod;
  readonly summary: WasherEarningsSummary;
}

/**
 * The period's headline: what the ledger moved to this partner in it.
 *
 * `netPaise` is rendered exactly as sent, and it is SIGNED — a job accepted
 * last week and cancelled this week makes this week's net negative. A negative
 * figure keeps the ordinary ink colour: a clawback is not an error, and red
 * would read as one.
 *
 * The headline counts by posting time and the rows by completion time, so
 * they need not agree (see `washerEarningsViewSchema`), and a partner would
 * otherwise read either mismatch as a bug. Two lines say why, and neither
 * compares or derives an amount (R-FE-06):
 *
 * - the fixed caption, always shown, covers a headline ABOVE the rows (an
 *   accepted wash not yet completed);
 * - the taken-back line, shown only when the server reports `reversedPaise`
 *   above zero, covers a headline BELOW them, with the server's amount.
 */
export function EarningsSummary({ period, summary }: EarningsSummaryProps) {
  const heading = PERIOD_LABELS[period].heading;
  const net = formatPaise(summary.netPaise, { alwaysDecimals: true });
  // "completed", not "washes": beside the figure, "5 washes" says those five
  // produced it, and the figure counts at accept, not at completion.
  const completed = `${String(summary.jobsCompleted)} completed`;
  const reversed =
    summary.reversedPaise > 0
      ? `After ${formatPaise(summary.reversedPaise, { alwaysDecimals: true })} taken back for cancelled washes`
      : null;

  return (
    <View style={styles.root} testID="earnings-summary">
      <View accessible accessibilityLabel={`${heading}: ${net}. ${completed}.`}>
        <Text style={styles.heading}>{heading}</Text>
        <View style={styles.figureRow}>
          <Text style={styles.figure} testID="earnings-net">
            {net}
          </Text>
          <View style={styles.chip}>
            <Text style={styles.chipLabel} testID="earnings-jobs">
              {completed}
            </Text>
          </View>
        </View>
      </View>

      {/* Ruling T9-I1: unconditional. Without it, a first accepted wash reads as
          money in the hero above "No completed washes", which looks like a bug. */}
      <Text style={styles.caption} testID="earnings-caption">
        {CAPTION}
      </Text>

      {reversed === null ? null : (
        <View style={styles.reversed}>
          <MaterialCommunityIcons name="undo-variant" size={16} color={colors.textSecondary} />
          <Text style={styles.reversedLabel} testID="earnings-reversed">
            {reversed}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.base,
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  heading: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.textSecondary },
  figureRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: spacing.md,
    rowGap: spacing.xs,
    marginTop: spacing.xs,
  },
  // Ink whatever the sign: the minus carries the meaning, not a colour (R-FE-12).
  figure: {
    fontSize: fontSize['4xl'],
    fontWeight: fontWeight.bold,
    lineHeight: fontSize['4xl'] * lineHeight.tight,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  chip: {
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
  caption: { fontSize: fontSize.sm, color: colors.textSecondary },
  reversed: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  reversedLabel: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary },
});
