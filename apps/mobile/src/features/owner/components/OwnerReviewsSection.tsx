import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ReviewView } from '@parkease/contracts/driver';
import { formatStars, type RatingBp } from '@parkease/contracts/primitives';
import { colors, fontSize, fontWeight, radius, spacing, touchTarget } from '@parkease/tokens';
import { Button, ListSkeleton } from '@parkease/ui-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { warn } from '@/lib/log';

import { toApiFailure } from '../../shared/api/errors';
import { ReportSheet } from '../../shared/components/ReportSheet';
import { ReviewItem } from '../../shared/components/ReviewItem';
import { StarRating } from '../../shared/components/StarRating';
import {
  useOwnerReviews,
  useOwnerReviewSummary,
  useRespondToReview,
} from '../../shared/reviews/hooks';
import { needsReply, orderForOwner } from '../review-order';

/**
 * Reviews on the owner's listing detail (task 17b): the number, then what needs a reply, then the
 * rest. A section in the existing scroll, like the bookings above it — so rows are mapped and paged
 * with "Show more", because a FlashList cannot nest in this ScrollView (the BookingGroup precedent).
 */
export function OwnerReviewsSection({ spaceId }: { readonly spaceId: string }) {
  const summaries = useOwnerReviewSummary();
  const reviews = useOwnerReviews(spaceId);
  const [reporting, setReporting] = useState<string | null>(null);
  const summary = summaries.data?.find((s) => s.spaceId === spaceId);

  useEffect(() => {
    if (summaries.isError) {
      warn('reviews.ownerSummary: could not load; showing reviews without the average', {
        error: summaries.error,
      });
    }
  }, [summaries.isError, summaries.error]);

  if (reviews.isPending) return <ListSkeleton count={2} itemHeight={88} />;

  if (reviews.isError && reviews.data === undefined) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => void reviews.refetch()}
        style={styles.retry}
      >
        <Text style={styles.muted}>{"Couldn't load reviews. Tap to retry."}</Text>
      </Pressable>
    );
  }

  const items = orderForOwner(reviews.data.pages.flatMap((page) => page.data));

  if (items.length === 0) {
    return (
      <Text style={styles.muted}>No reviews yet. They show up here once drivers rate a stay.</Text>
    );
  }

  return (
    <View style={styles.wrap}>
      {summary === undefined || summary.ratingAvgBp === null ? null : (
        <View style={styles.head}>
          {/* The server's average, range-checked by the contract; formatted here, never derived. */}
          <Text style={styles.avg}>{formatStars(summary.ratingAvgBp as RatingBp)}</Text>
          <View style={styles.headText}>
            <StarRating
              stars={formatStars(summary.ratingAvgBp as RatingBp)}
              reviewCount={summary.ratingCount}
              size={16}
            />
            <Text style={styles.muted}>
              {`${String(summary.ratingCount)} reviews · recent ones count more`}
            </Text>
          </View>
          {summary.reportedCount > 0 ? (
            <View style={styles.reportedChip}>
              <MaterialCommunityIcons name="flag-outline" size={14} color={colors.warning} />
              <Text style={styles.reportedText}>{`${String(summary.reportedCount)} reported`}</Text>
            </View>
          ) : null}
        </View>
      )}

      {items.map((review) => (
        <OwnerReview
          key={review.id}
          review={review}
          onReport={() => {
            setReporting(review.id);
          }}
        />
      ))}

      {reviews.isError ? (
        // A failed "Show more" or refresh keeps what is on screen and says so (BookingGroup's rule).
        <Pressable
          accessibilityRole="button"
          onPress={() => void reviews.refetch()}
          style={styles.retry}
        >
          <Text style={styles.muted}>{"Couldn't load more reviews. Tap to retry."}</Text>
        </Pressable>
      ) : null}

      {reviews.hasNextPage ? (
        <Button
          label="Show more reviews"
          variant="ghost"
          loading={reviews.isFetchingNextPage}
          onPress={() => void reviews.fetchNextPage()}
        />
      ) : null}

      <ReportSheet
        as="owner"
        reviewId={reporting}
        onDone={() => {
          setReporting(null);
        }}
      />
    </View>
  );
}

function OwnerReview({
  review,
  onReport,
}: {
  readonly review: ReviewView;
  readonly onReport: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const respond = useRespondToReview();
  const waiting = needsReply(review);

  return (
    <View style={[styles.card, waiting && styles.cardWaiting]}>
      {waiting ? (
        <View style={styles.needChip}>
          <Text style={styles.needText}>Needs a reply</Text>
        </View>
      ) : null}
      <ReviewItem review={review} {...(review.isReported ? {} : { onReport })}>
        {review.isReported ? (
          <Text style={styles.underReview}>Reported. Under review by ParkEase.</Text>
        ) : null}
        {review.ownerResponse === null && !open ? (
          <Pressable
            onPress={() => {
              setOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Respond to ${review.reviewerName}`}
            style={styles.respond}
          >
            <MaterialCommunityIcons name="reply-outline" size={16} color={colors.primary} />
            <Text style={styles.respondText}>Respond</Text>
          </Pressable>
        ) : null}
        {open && review.ownerResponse === null ? (
          <View style={styles.form}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="A public reply, under the review"
              placeholderTextColor={colors.textTertiary}
              maxLength={500}
              multiline
              autoFocus
              style={styles.input}
              accessibilityLabel={`Your reply to ${review.reviewerName}`}
            />
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {respond.isError ? toApiFailure(respond.error).message : ''}
            </Text>
            <View style={styles.formActions}>
              <Button
                label="Cancel"
                variant="ghost"
                onPress={() => {
                  setOpen(false);
                }}
              />
              <Button
                label="Post reply"
                disabled={text.trim() === ''}
                loading={respond.isPending}
                onPress={() => {
                  respond.mutate(
                    { reviewId: review.id, response: text.trim() },
                    {
                      onSuccess: () => {
                        setOpen(false);
                      },
                      onError: (error) => {
                        const failure = toApiFailure(error);
                        warn('reviews.respond: did not post', {
                          code: failure.code,
                          traceId: failure.traceId,
                        });
                      },
                    },
                  );
                }}
              />
            </View>
          </View>
        ) : null}
      </ReviewItem>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
  headText: { gap: 2, flexShrink: 1 },
  avg: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, color: colors.text },
  muted: { fontSize: fontSize.sm, color: colors.textSecondary },
  retry: { minHeight: touchTarget, justifyContent: 'center' },
  reportedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.warningLight,
  },
  reportedText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.warning },
  card: {
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardWaiting: { borderLeftWidth: 3, borderLeftColor: colors.warning },
  needChip: {
    alignSelf: 'flex-start',
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.warningLight,
  },
  needText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.warning },
  underReview: { fontSize: fontSize.xs, color: colors.textTertiary },
  respond: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touchTarget,
  },
  respondText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary },
  form: { gap: spacing.sm },
  input: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: fontSize.base,
    color: colors.text,
    textAlignVertical: 'top',
  },
  error: { fontSize: fontSize.sm, color: colors.errorInk },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
});
