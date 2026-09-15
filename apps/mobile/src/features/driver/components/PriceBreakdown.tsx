import type { QuoteBreakdown } from '@parkease/contracts/driver';
import type { Paise } from '@parkease/contracts/primitives';
import { colors, fontSize, fontWeight, spacing } from '@parkease/tokens';
import { StyleSheet, Text, View } from 'react-native';

import { formatPaise } from '@/lib/money';

interface PriceBreakdownProps {
  readonly quote: QuoteBreakdown;
}

const BASIS_POINTS = 10_000;

/**
 * The canonical breakdown, rendered from the server-issued quote.
 *
 * Every number here is displayed exactly as received. The app never multiplies
 * a rate and never adds GST (R-FE-06) — the only arithmetic below is turning
 * basis points into "1.5x" for the label, which is presentation, not pricing.
 *
 * There is deliberately no "Platform fee" row. The ParkEase Fee is charged
 * once, out of the owner's side; a driver-side fee line charges it twice, which
 * is exactly the bug the corrected model exists to remove (ADR-009,
 * website.md §2.7). If you are adding one, read the ADR first.
 */
export function PriceBreakdown({ quote }: PriceBreakdownProps) {
  const multiplier = quote.surgeMultiplierBp / BASIS_POINTS;
  const hasSurge = quote.surgePremiumPaise > 0;

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Price breakdown</Text>

      <View style={styles.rule} />

      <Row label="Base price" value={quote.basePaise} />
      {hasSurge ? (
        <Row
          label={`Surge (${multiplier.toFixed(1)}x high demand)`}
          value={quote.surgePremiumPaise}
        />
      ) : null}
      <Row label="GST (18% on ParkEase fee)" value={quote.gstPaise} />

      <View style={styles.rule} />

      <View
        style={styles.row}
        accessibilityRole="text"
        accessibilityLabel={`Total ${formatPaise(quote.totalPaise, { alwaysDecimals: true })}`}
      >
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.totalValue}>
          {formatPaise(quote.totalPaise, { alwaysDecimals: true })}
        </Text>
      </View>

      <View style={styles.rule} />

      {/*
        The owner's share, shown to the driver on purpose. It is the one line
        that makes the fee model legible: the money is going to a person who
        owns this spot, and ParkEase's cut comes out of their side, not on top
        of the driver's.
      */}
      <Text style={styles.ownerNote}>
        Owner earns {formatPaise(quote.ownerEarningsPaise, { alwaysDecimals: true })}
      </Text>
    </View>
  );
}

function Row({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{formatPaise(value as Paise, { alwaysDecimals: true })}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  heading: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  label: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  value: {
    fontSize: fontSize.sm,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  totalLabel: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  totalValue: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  ownerNote: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
});
