import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { RatingBadge } from '@parkease/contracts/driver';
import { colors, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import { StyleSheet, Text, View } from 'react-native';

import { starsLabel } from '../../shared/reviews/review-copy';
import { formatRatingLabel } from '../space-display';

/**
 * The rating on a search result — list row and map card alike, from the server's badge. "New" is
 * a chip, never a zero; "Mixed reviews" is said in words beside the stars, not only in colour.
 */
export function RatingMeta({ badge }: { readonly badge: RatingBadge }) {
  if (badge.kind === 'new') {
    return (
      <View style={styles.newChip}>
        <Text style={styles.newText}>New</Text>
      </View>
    );
  }
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={
        badge.kind === 'low_rated'
          ? `${starsLabel(badge.stars, badge.reviewCount)}, mixed reviews`
          : starsLabel(badge.stars, badge.reviewCount)
      }
    >
      <MaterialCommunityIcons name="star" size={14} color={colors.rating} />
      <Text style={styles.text}>{formatRatingLabel(badge)}</Text>
      {badge.kind === 'low_rated' ? <Text style={styles.mixed}>· Mixed reviews</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  text: { fontSize: fontSize.sm, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  mixed: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.warning },
  newChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
  },
  newText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.primary },
});
