import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { PublicReviewView } from '@parkease/contracts/driver';
import { colors, fontSize, fontWeight, lineHeight, spacing, touchTarget } from '@parkease/tokens';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { reviewedAgo } from '../reviews/review-copy';

import { StarRating } from './StarRating';

interface ReviewItemProps {
  /** The public view, or the owner's (which adds `isReported`). */
  readonly review: PublicReviewView & { readonly isReported?: boolean };
  /** Omitted where reporting is not offered, so the link is never a dead control. */
  readonly onReport?: () => void;
  /** Owner-only additions under the review: a reported chip, the respond form. */
  readonly children?: ReactNode;
}

/** One review: stars, who and when, what they said, the owner's reply, and a quiet Report. */
export function ReviewItem({ review, onReport, children }: ReviewItemProps) {
  return (
    <View style={styles.item}>
      {/* Report shares the star row, so its 48dp target costs no row of its own. */}
      <View style={styles.head}>
        <StarRating stars={review.rating} />
        {onReport === undefined ? null : (
          <Pressable
            onPress={onReport}
            accessibilityRole="button"
            accessibilityLabel={`Report ${review.reviewerName}'s review`}
            style={styles.report}
          >
            <MaterialCommunityIcons name="flag-outline" size={14} color={colors.textTertiary} />
            <Text style={styles.reportText}>Report</Text>
          </Pressable>
        )}
      </View>
      <Text style={styles.name}>
        {review.reviewerName}
        <Text style={styles.meta}>{` · ${reviewedAgo(review.createdAt)}`}</Text>
      </Text>
      {review.comment === null ? null : <Text style={styles.comment}>{review.comment}</Text>}
      {review.ownerResponse === null ? null : (
        <View style={styles.reply}>
          <Text style={styles.replyLabel}>Owner replied</Text>
          <Text style={styles.replyText}>{review.ownerResponse}</Text>
        </View>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  item: { gap: spacing.xs, paddingVertical: spacing.md },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 24,
  },
  meta: { fontSize: fontSize.xs, fontWeight: fontWeight.regular, color: colors.textTertiary },
  name: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  comment: {
    fontSize: fontSize.sm,
    lineHeight: fontSize.sm * lineHeight.normal,
    color: colors.text,
  },
  reply: {
    marginTop: spacing.xs,
    paddingLeft: spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    gap: 2,
  },
  replyLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
  },
  replyText: {
    fontSize: fontSize.sm,
    lineHeight: fontSize.sm * lineHeight.normal,
    color: colors.textSecondary,
  },
  report: {
    marginVertical: -spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touchTarget,
    paddingHorizontal: spacing.xs,
  },
  reportText: { fontSize: fontSize.xs, color: colors.textTertiary },
});
