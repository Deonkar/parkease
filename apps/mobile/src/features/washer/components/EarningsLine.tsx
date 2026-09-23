import type { WasherEarningsLine } from '@parkease/contracts/washer';
import { colors, elevation, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import { StyleSheet, Text, View } from 'react-native';

import { formatDateIST, formatTimeIST } from '@/lib/format';
import { formatPaise, MINUS_SIGN } from '@/lib/money';

import { SERVICE_LABELS, VEHICLE_LABELS } from '../labels';

export interface EarningsLineProps {
  readonly line: WasherEarningsLine;
}

interface AmountRowProps {
  readonly label: string;
  readonly value: string;
  readonly testID: string;
  readonly emphasis?: boolean;
}

/** One labelled amount, read by TalkBack as one phrase ("ParkEase fee, −₹79.80"). */
function AmountRow({ label, value, testID, emphasis = false }: AmountRowProps) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}, ${value}`}>
      <Text style={[styles.label, emphasis && styles.labelEmphasis]}>{label}</Text>
      <Text style={[styles.amount, emphasis && styles.amountEmphasis]} testID={testID}>
        {value}
      </Text>
    </View>
  );
}

/**
 * One completed wash, as the ledger booked it (spec §6.4).
 *
 * Three amounts, each a response field formatted and nothing else. They are
 * NOT tied together here: the contract says a clawback or a correction can
 * make net differ from the obvious subtraction, and when it does the books are
 * right. The fee is shown as a deduction by its sign alone — prefixed to the
 * server's amount, never produced by negating it — and no rate appears, because
 * no rate exists in `apps/mobile` (R-FE-06).
 */
export function EarningsLine({ line }: EarningsLineProps) {
  const completed = new Date(line.completedAt);

  return (
    <View style={styles.root} testID="earnings-line">
      <Text style={styles.when} testID="line-when">
        {`${formatDateIST(completed)} · ${formatTimeIST(completed)}`}
      </Text>
      <Text style={styles.service}>
        {SERVICE_LABELS[line.serviceName]}
        <Text style={styles.vehicle}>{` · ${VEHICLE_LABELS[line.vehicleType]}`}</Text>
      </Text>

      <View style={styles.amounts}>
        <AmountRow
          label="Service price"
          value={formatPaise(line.grossPaise, { alwaysDecimals: true })}
          testID="line-gross"
        />
        <AmountRow
          label="ParkEase fee"
          value={`${MINUS_SIGN}${formatPaise(line.feePaise, { alwaysDecimals: true })}`}
          testID="line-fee"
        />
        <View style={styles.rule} />
        <AmountRow
          label="You earned"
          value={formatPaise(line.netPaise, { alwaysDecimals: true })}
          testID="line-net"
          emphasis
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.base,
    ...elevation.card,
  },
  when: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.textTertiary },
  service: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginTop: spacing.xs,
  },
  vehicle: { fontWeight: fontWeight.regular, color: colors.textSecondary },
  amounts: { marginTop: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  label: { fontSize: fontSize.sm, color: colors.textSecondary },
  labelEmphasis: { fontWeight: fontWeight.semibold, color: colors.text },
  // Tabular figures, so the three amounts align down their right edge.
  amount: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  amountEmphasis: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.text },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});
