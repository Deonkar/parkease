import type { PublicReviewView } from '@parkease/contracts/driver';
import { colors, spacing } from '@parkease/tokens';
import { EmptyState, ErrorState, ListSkeleton, Skeleton } from '@parkease/ui-native';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';

import { useSpaceDetail } from '../../../src/features/driver/hooks/useBookings';
import { ReadableColumn } from '../../../src/features/shared/components/ReadableColumn';
import { ReportSheet } from '../../../src/features/shared/components/ReportSheet';
import { ReviewItem } from '../../../src/features/shared/components/ReviewItem';
import { ReviewsSummary } from '../../../src/features/shared/components/ReviewsSummary';
import { ScreenHeader } from '../../../src/features/shared/components/ScreenHeader';
import { useSpaceReviews } from '../../../src/features/shared/reviews/hooks';

function Separator() {
  return <View style={styles.separator} />;
}

/**
 * Every review of a space, newest first (task 17b, "See all N reviews"). The summary heads the
 * list from the space detail already in the cache; the list itself pages from the server.
 */
export default function SpaceReviewsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const space = useSpaceDetail(id);
  const reviews = useSpaceReviews(id);
  const [reporting, setReporting] = useState<string | null>(null);

  const items = reviews.data?.pages.flatMap((page) => page.data) ?? [];

  const renderItem = useCallback(
    ({ item }: { item: PublicReviewView }) => (
      <ReviewItem
        review={item}
        onReport={() => {
          setReporting(item.id);
        }}
      />
    ),
    [],
  );

  const header =
    space.data === undefined ? null : (
      <View style={styles.summary}>
        <ReviewsSummary badge={space.data.badge} summary={space.data.reviewSummary} />
      </View>
    );

  return (
    <>
      <ScreenHeader
        title={space.data === undefined ? 'Reviews' : `Reviews · ${space.data.title}`}
      />

      <View style={styles.screen}>
        <ReadableColumn>
          {reviews.isPending ? (
            <View style={styles.pad}>
              <ListSkeleton count={5} itemHeight={96} />
            </View>
          ) : reviews.isError ? (
            <ErrorState
              title="We couldn't load the reviews"
              body="Check your connection and try again."
              actionLabel="Try again"
              onAction={() => void reviews.refetch()}
            />
          ) : items.length === 0 ? (
            <EmptyState
              title="No reviews yet"
              body="Drivers can rate this space after a booking here."
            />
          ) : (
            // FlashList, never FlatList (R-FE-07).
            <FlashList
              data={items}
              renderItem={renderItem}
              keyExtractor={(item) => item.id}
              ListHeaderComponent={header}
              ItemSeparatorComponent={Separator}
              contentContainerStyle={styles.listContent}
              onEndReachedThreshold={0.5}
              onEndReached={() => {
                if (reviews.hasNextPage && !reviews.isFetchingNextPage)
                  void reviews.fetchNextPage();
              }}
              ListFooterComponent={
                reviews.isFetchingNextPage ? (
                  // Skeletons, never spinners (mobile.md): the next page's shape, not a wheel.
                  <Skeleton width="100%" height={88} style={styles.more} />
                ) : null
              }
              refreshControl={
                <RefreshControl
                  refreshing={reviews.isRefetching}
                  onRefresh={() => void reviews.refetch()}
                  tintColor={colors.primary}
                />
              }
            />
          )}
        </ReadableColumn>
      </View>

      <ReportSheet
        as="driver"
        reviewId={reporting}
        onDone={() => {
          setReporting(null);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  pad: { padding: spacing.base },
  summary: { paddingVertical: spacing.base },
  listContent: { paddingHorizontal: spacing.base, paddingBottom: spacing['2xl'] },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  more: { marginVertical: spacing.base },
});
