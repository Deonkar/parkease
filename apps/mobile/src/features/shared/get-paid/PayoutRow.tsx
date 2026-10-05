import type { PayoutStatus } from '@parkease/contracts/enums';
import type { PayoutView } from '@parkease/contracts/shared';
import { colors, fontSize, fontWeight, radius, spacing, touchTarget } from '@parkease/tokens';
import { StyleSheet, Text, View } from 'react-native';

import { formatDayMonthIST } from '@/lib/format';
import { formatPaise } from '@/lib/money';

/**
 * One RazorpayX payout (direction A · Checklist). Status is always words in a chip, never
 * colour alone (R-FE-12); a failure says where the money went — back into the balance.
 * Chip pairs are Wayfinder tokens that clear AA; green stays reserved for availability.
 */
const STATUS: Record<PayoutStatus, { label: string; fg: string; bg: string }> = {
  pending: { label: 'Scheduled', fg: colors.textSecondary, bg: colors.surfaceTertiary },
  processing: { label: 'Sent', fg: colors.primaryDark, bg: colors.primarySoft },
  paid: { label: 'Paid', fg: colors.textSecondary, bg: colors.surfaceTertiary },
  failed: { label: 'Failed', fg: colors.errorInk, bg: colors.errorLight },
  reversed: { label: 'Returned', fg: colors.errorInk, bg: colors.errorLight },
  cancelled: { label: 'Cancelled', fg: colors.textSecondary, bg: colors.surfaceTertiary },
};

const UNDONE = new Set<PayoutStatus>(['failed', 'reversed', 'cancelled']);

/**
 * No account number on the row: a payout keeps the fund account it was made for, not its last 4,
 * and stamping today's bank on last month's payout names the wrong account after a change.
 */
export function PayoutRow({ payout }: { readonly payout: PayoutView }) {
  const status = STATUS[payout.status];
  const undone = UNDONE.has(payout.status);
  const when = formatDayMonthIST(new Date(payout.createdAt), { weekday: true });

  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${when}, ${formatPaise(payout.netPaise, { alwaysDecimals: true })}, ${status.label}`}
    >
      <View style={styles.left}>
        <Text style={styles.when}>{when}</Text>
        <Text style={[styles.detail, undone && styles.detailUndone]}>
          {undone ? "Didn't go through — added back to your balance" : 'To your bank'}
        </Text>
        {payout.tcsPaise > 0 || payout.tdsPaise > 0 ? (
          // Each withholding as the server sent it: the client never adds money up (R-FE-06).
          <Text style={styles.detail} testID="payout-tax">
            {`${formatPaise(payout.tcsPaise, { alwaysDecimals: true })} TCS · ${formatPaise(payout.tdsPaise, { alwaysDecimals: true })} TDS withheld`}
          </Text>
        ) : null}
      </View>
      <View style={styles.right}>
        <Text style={[styles.amount, undone && styles.amountUndone]} testID="payout-amount">
          {formatPaise(payout.netPaise, { alwaysDecimals: true })}
        </Text>
        <Text
          style={[styles.chip, { color: status.fg, backgroundColor: status.bg }]}
          testID="payout-status"
        >
          {status.label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: touchTarget + spacing.base,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
  },
  left: { flex: 1, gap: spacing.xs / 2 },
  right: { alignItems: 'flex-end', gap: spacing.xs },
  when: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.text },
  detail: { fontSize: fontSize.sm, color: colors.textSecondary },
  detailUndone: { color: colors.errorInk },
  amount: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  amountUndone: { color: colors.textTertiary, textDecorationLine: 'line-through' },
  chip: {
    overflow: 'hidden',
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
  },
});
