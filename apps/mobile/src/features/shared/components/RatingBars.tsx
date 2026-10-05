import { colors, fontSize, radius, spacing } from '@parkease/tokens';
import { StyleSheet, Text, View } from 'react-native';

interface RatingBarsProps {
  /** Counts of opinions per star, as the server sends them. Unweighted, so they sum to the count. */
  readonly distribution: Readonly<Record<1 | 2 | 3 | 4 | 5, number>>;
}

const STARS = [5, 4, 3, 2, 1] as const;

/**
 * The distribution, five to one. Widths are flex ratios of the counts rather than a computed
 * percentage string, so nothing here is arithmetic on a rating — only on how many people said it.
 */
export function RatingBars({ distribution }: RatingBarsProps) {
  const most = Math.max(1, ...STARS.map((s) => distribution[s]));
  return (
    <View style={styles.list}>
      {STARS.map((star) => {
        const count = distribution[star];
        return (
          <View
            key={star}
            style={styles.row}
            accessible
            accessibilityLabel={`${String(star)} stars, ${String(count)} ${count === 1 ? 'review' : 'reviews'}`}
          >
            <Text style={styles.label}>{star}</Text>
            <View style={styles.track}>
              {count > 0 ? <View style={[styles.fill, { flex: count }]} /> : null}
              <View style={{ flex: most - count }} />
            </View>
            <Text style={[styles.label, styles.count]}>{count}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: {
    width: 14,
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  count: { width: 24, textAlign: 'right' },
  track: {
    flex: 1,
    height: 6,
    flexDirection: 'row',
    borderRadius: radius.full,
    backgroundColor: colors.surfaceTertiary,
    overflow: 'hidden',
  },
  fill: { backgroundColor: colors.rating, borderRadius: radius.full },
});
