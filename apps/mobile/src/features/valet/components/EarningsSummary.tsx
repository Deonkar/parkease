import type { ValetEarningsSummary } from '@parkease/contracts/valet';
import { colors, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import { StyleSheet, Text, View } from 'react-native';

import { formatPaise } from '@/lib/money';

export interface EarningsSummaryProps {
  readonly summary: ValetEarningsSummary;
}

/**
 * The ledger, formatted. Nothing here is computed.
 *
 * Every figure is a field from `GET /valet/earnings`, which answers from
 * `owner_payable` for this valet's counterparty id and nothing else
 * (R-MONEY-05). The component does not subtract `reversedPaise` from
 * `grossPaise` to check `netPaise` — the ledger is the truth, and a screen that
 * "corrected" it would be inventing money.
 *
 * The reversal is shown rather than folded into the net on purpose: a job
 * cancelled after dispatch claws part of a credited leg back, and an
 * unexplained smaller number is a support ticket.
 *
 * There is deliberately no commission line. Commission is credited to
 * `platform_revenue`, not to this account, so the endpoint does not report it
 * and deriving it here would mean putting the rate in `apps/mobile` — banned by
 * R-FE-06 and caught by a CI grep.
 */
export function EarningsSummary({ summary }: EarningsSummaryProps) {
  const hasReversal = summary.reversedPaise > 0;

  return (
    <View style={styles.root} testID="earnings-summary">
      <Text style={styles.label}>YOU HAVE EARNED</Text>
      <Text style={styles.net} testID="earnings-net">
        {formatPaise(summary.netPaise, { alwaysDecimals: true })}
      </Text>
      <Text style={styles.jobs}>
        {`${String(summary.jobsCompleted)} ${summary.jobsCompleted === 1 ? 'job' : 'jobs'} completed`}
      </Text>

      <View style={styles.divider} />

      <View style={styles.row}>
        <Text style={styles.rowLabel}>Credited</Text>
        <Text style={styles.rowValue} testID="earnings-gross">
          {formatPaise(summary.grossPaise, { alwaysDecimals: true })}
        </Text>
      </View>

      {hasReversal ? (
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Adjustments</Text>
          <Text style={[styles.rowValue, styles.reversed]} testID="earnings-reversed">
            {`−${formatPaise(summary.reversedPaise, { alwaysDecimals: true })}`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.textTertiary,
    letterSpacing: 0.4,
  },
  net: { fontSize: fontSize['4xl'], fontWeight: fontWeight.bold, color: colors.text },
  jobs: { fontSize: fontSize.sm, color: colors.textSecondary },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  rowLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  rowValue: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.text },
  reversed: { color: colors.warning },
});
