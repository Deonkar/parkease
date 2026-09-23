import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { WasherEarningsPeriod, WasherEarningsSummary } from '@parkease/contracts/washer';
import { colors, fontSize, fontWeight, lineHeight, radius, spacing } from '@parkease/tokens';
import { StyleSheet, Text, View } from 'react-native';

import { formatPaise } from '@/lib/money';

import { PERIOD_LABELS } from '../labels';

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
 * The reversal line is the one thing here the brief did not ask for. The
 * headline counts by posting time and the rows by completion time, so they
 * need not agree (see `washerEarningsViewSchema`); a partner whose headline is
 * below the sum of their rows would otherwise assume a bug. Its only condition
 * is that the server reported a reversal — no amount is compared or derived to
 * decide it (R-FE-06).
 */
export function EarningsSummary({ period, summary }: EarningsSummaryProps) {
  const heading = PERIOD_LABELS[period].heading;
  const net = formatPaise(summary.netPaise, { alwaysDecimals: true });
  const washes = `${String(summary.jobsCompleted)} ${summary.jobsCompleted === 1 ? 'wash' : 'washes'}`;
  const reversed =
    summary.reversedPaise > 0
      ? `After ${formatPaise(summary.reversedPaise, { alwaysDecimals: true })} reversed for cancellations`
      : null;

  return (
    <View style={styles.root} testID="earnings-summary">
      <View accessible accessibilityLabel={`${heading}: ${net} earned, ${washes} completed`}>
        <Text style={styles.heading}>{heading}</Text>
        <View style={styles.figureRow}>
          <Text style={styles.figure} testID="earnings-net">
            {net}
          </Text>
          <View style={styles.chip}>
            <Text style={styles.chipLabel} testID="earnings-jobs">
              {washes}
            </Text>
          </View>
        </View>
      </View>

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
  reversed: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  reversedLabel: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary },
});
