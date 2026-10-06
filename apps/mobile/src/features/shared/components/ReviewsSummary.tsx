import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { RatingBadge, ReviewSummary } from '@parkease/contracts/driver';
import { colors, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import { StyleSheet, Text, View } from 'react-native';

import { RatingBars } from './RatingBars';
import { StarRating } from './StarRating';

interface ReviewsSummaryProps {
  readonly badge: RatingBadge;
  readonly summary: ReviewSummary;
}

/**
 * The head of a space's reviews: the badge, the server's stars, and the distribution. Three
 * states, from the badge the server decided (task 17 §17.7):
 *
 * - **New** — no stars and no zero, ever. The empty state R-FE-08 asks for on this block.
 * - **Mixed reviews** — said in words with an icon, not only in amber (R-FE-12).
 * - **Rated** — stars and count.
 *
 * "Recent reviews count more" sits under the number because the average is weighted and the bars
 * are not, so the two can look different; saying why is cheaper than a support ticket.
 */
export function ReviewsSummary({ badge, summary }: ReviewsSummaryProps) {
  if (badge.kind === 'new') {
    return (
      <View style={styles.newBox}>
        <View style={styles.newChip}>
          <MaterialCommunityIcons
            name="star-four-points-outline"
            size={14}
            color={colors.primary}
          />
          <Text style={styles.newChipText}>New</Text>
        </View>
        <Text style={styles.newText}>
          No reviews yet. Be the first to rate this space after your booking.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <Text style={styles.stars}>{badge.stars}</Text>
        <View style={styles.headText}>
          <StarRating stars={badge.stars} reviewCount={badge.reviewCount} size={16} />
          <Text style={styles.count}>
            {`${String(badge.reviewCount)} ${badge.reviewCount === 1 ? 'review' : 'reviews'}`}
          </Text>
        </View>
        {badge.kind === 'low_rated' ? (
          <View style={styles.mixed}>
            <MaterialCommunityIcons name="alert-circle-outline" size={14} color={colors.warning} />
            <Text style={styles.mixedText}>{badge.label}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.note}>Recent reviews count more</Text>
      <RatingBars distribution={summary.distribution} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
  stars: {
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  headText: { gap: 2 },
  count: { fontSize: fontSize.xs, color: colors.textSecondary },
  mixed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.warningLight,
  },
  mixedText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.warning },
  note: { fontSize: fontSize.xs, color: colors.textTertiary },
  newBox: {
    gap: spacing.sm,
    padding: spacing.base,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
  },
  newChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
  },
  newChipText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.primary },
  newText: { fontSize: fontSize.sm, color: colors.textSecondary },
});
