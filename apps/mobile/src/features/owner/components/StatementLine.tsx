import type { StatementLine as Line } from '@parkease/contracts/owner';
import { colors, elevation, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import { StyleSheet, Text, View } from 'react-native';

import { AmountRow } from '@/features/shared/components/AmountRow';
import { formatDayMonthIST, formatTimeIST } from '@/lib/format';
import { formatPaise, MINUS_SIGN } from '@/lib/money';

const money = (paise: Line['basePaise'] | Line['netPaise']) =>
  formatPaise(paise, { alwaysDecimals: true });

/**
 * One booking on the owner's statement, direction A (spec §4). Base, fee,
 * any refund, and what the owner keeps — each a response field, formatted and
 * nothing else. No surge, no rate: the fee label names no percentage, because
 * no rate exists in `apps/mobile` (R-FE-06).
 */
export function StatementLine({ line }: { readonly line: Line }) {
  const at = new Date(line.occurredAt);
  return (
    <View style={styles.root} testID="statement-line">
      <Text
        style={styles.when}
      >{`${formatDayMonthIST(at, { weekday: true })} · ${formatTimeIST(at)}`}</Text>
      <Text style={styles.who} testID="line-who">
        {`${line.driverName} · ${line.durationLabel} · ${line.spaceName}`}
      </Text>
      <View style={styles.amounts}>
        <AmountRow label="Base price" value={money(line.basePaise)} testID="line-base" />
        <AmountRow
          label="ParkEase fee"
          value={`${MINUS_SIGN}${money(line.feePaise)}`}
          testID="line-fee"
        />
        {line.reversedPaise > 0 ? (
          <AmountRow
            label="Refunded to driver"
            value={`${MINUS_SIGN}${money(line.reversedPaise)}`}
            testID="line-refund"
          />
        ) : null}
        <View style={styles.rule} />
        <AmountRow label="You earned" value={money(line.netPaise)} testID="line-net" emphasis />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.base,
    ...elevation.card,
  },
  when: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.textTertiary },
  who: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginTop: spacing.xs,
  },
  amounts: { marginTop: spacing.md, gap: spacing.sm },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});
