import type { DriverBooking } from '@parkease/contracts/driver';
import { colors, spacing } from '@parkease/tokens';
import { EmptyState, ErrorState } from '@parkease/ui-native';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';

import { BookingCard } from '../../../src/features/driver/components/BookingCard';
import { BookingListSkeleton } from '../../../src/features/driver/components/BookingCardSkeleton';
import { SegmentedChoice } from '../../../src/features/driver/components/SegmentedChoice';
import { useBookingsList } from '../../../src/features/driver/hooks/useBookings';
import { ScreenHeader } from '../../../src/features/shared/components/ScreenHeader';

type Filter = 'upcoming' | 'past' | 'all';

const EMPTY: Readonly<Record<Filter, { title: string; body: string }>> = {
  upcoming: {
    title: 'Nothing booked yet',
    body: 'Find a parking spot and book your first one.',
  },
  past: {
    title: 'No past bookings',
    body: 'Once a booking finishes, it will show up here.',
  },
  all: {
    title: 'No bookings yet',
    body: 'Find a parking spot and book your first one.',
  },
};

export default function BookingsListScreen() {
  const [filter, setFilter] = useState<Filter>('upcoming');
  const { data, isPending, isError, refetch, isRefetching, fetchNextPage, hasNextPage } =
    useBookingsList(filter);

  const bookings = data?.pages.flatMap((page) => page.items) ?? [];

  const renderItem = useCallback(
    ({ item }: { item: DriverBooking }) => (
      <BookingCard
        booking={item}
        onPress={() => {
          router.push({ pathname: '/(driver)/bookings/[id]', params: { id: item.id } });
        }}
      />
    ),
    [],
  );

  return (
    <>
      <ScreenHeader title="My bookings" />

      <View style={styles.screen}>
        <View style={styles.filters}>
          <SegmentedChoice<Filter>
            label="Show"
            value={filter}
            onChange={setFilter}
            choices={[
              { value: 'upcoming', label: 'Upcoming' },
              { value: 'past', label: 'Past' },
              { value: 'all', label: 'All' },
            ]}
          />
        </View>

        {isPending ? (
          <BookingListSkeleton />
        ) : isError ? (
          <ErrorState
            title="We couldn't load your bookings"
            body="Check your connection and try again."
            actionLabel="Try again"
            onAction={() => void refetch()}
          />
        ) : bookings.length === 0 ? (
          <EmptyState
            title={EMPTY[filter].title}
            body={EMPTY[filter].body}
            actionLabel="Find parking"
            onAction={() => {
              router.replace('/(driver)');
            }}
          />
        ) : (
          // FlashList, never FlatList (R-FE-07).
          <FlashList
            data={bookings}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            onEndReachedThreshold={0.5}
            onEndReached={() => {
              if (hasNextPage) void fetchNextPage();
            }}
            refreshControl={
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={() => void refetch()}
                tintColor={colors.primary}
              />
            }
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
  },
  filters: {
    padding: spacing.base,
  },
  listPad: {
    paddingHorizontal: spacing.base,
  },
  listContent: {
    paddingHorizontal: spacing.base,
    paddingBottom: spacing['2xl'],
  },
  separator: {
    height: spacing.md,
  },
});
