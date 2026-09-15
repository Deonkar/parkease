import type { DriverRateCard } from '@parkease/contracts/driver';
import { toPaise } from '@parkease/contracts/primitives';
import { colors, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import { StyleSheet, Text, View } from 'react-native';

import { formatPaise } from '@/lib/money';

interface RateCardTableProps {
  readonly card: DriverRateCard;
}

const PLANS = [
  ['Hourly', 'hourlyPaise'],
  ['Daily', 'dailyPaise'],
  ['Weekly', 'weeklyPaise'],
  ['Monthly', 'monthlyPaise'],
] as const;

/**
 * Base rates only. No platform fee line and no GST line — those appear exactly
 * once, at Review & Pay, from a server-issued quote (ADR-009, website.md §2.6).
 *
 * Plans the owner did not price are omitted rather than shown as a dash: a row
 * reading "Weekly —" invites the driver to tap it and find out why.
 */
export function RateCardTable({ card }: RateCardTableProps) {
  const priced = PLANS.filter(([, key]) => (card[key] ?? 0) > 0);
  if (priced.length === 0) return null;

  return (
    <View style={styles.grid}>
      {priced.map(([label, key]) => (
        <View key={key} style={styles.cell}>
          <Text style={styles.plan}>{label}</Text>
          <Text style={styles.price}>{formatPaise(card[key] ?? toPaise(0))}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  cell: {
    flexGrow: 1,
    flexBasis: '45%',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
  },
  plan: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
  price: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
});
