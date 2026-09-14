import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { SpaceSummary } from '@parkease/contracts/owner';
import { colors, spacing } from '@parkease/tokens';
import { EmptyState, ErrorState, ListSkeleton } from '@parkease/ui-native';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ListingCard } from '@/features/owner/components/ListingCard';
import { useMyListings } from '@/features/owner/hooks/useMyListings';
import { useToggleSpace } from '@/features/owner/hooks/useToggleSpace';

function ToggleWrapper({ listing, onPress }: { listing: SpaceSummary; onPress: () => void }) {
  const toggle = useToggleSpace(listing.id);
  return (
    <ListingCard
      listing={listing}
      onPress={onPress}
      onToggle={
        listing.approvalStatus === 'active' || listing.approvalStatus === 'inactive'
          ? () => {
              toggle.mutate();
            }
          : undefined
      }
    />
  );
}

export default function ListingsScreen() {
  const { data, isLoading, isError, refetch } = useMyListings();

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My Listings</Text>
        </View>
        <ListSkeleton count={3} itemHeight={100} />
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView style={styles.container}>
        <ErrorState
          title="Could not load listings"
          body="Check your connection and try again."
          onAction={() => {
            void refetch();
          }}
        />
      </SafeAreaView>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <EmptyState
          title="No spaces listed"
          body="List your empty parking space and start earning."
          icon={
            <MaterialCommunityIcons
              name="home-city-outline"
              size={48}
              color={colors.textTertiary}
            />
          }
          actionLabel="Add Space"
          onAction={() => {
            router.push('/(owner)/listings/new');
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Listings</Text>
        <Pressable
          onPress={() => {
            router.push('/(owner)/listings/new');
          }}
          accessibilityRole="button"
          accessibilityLabel="Add Space"
          style={styles.addButton}
        >
          <Text style={styles.addButtonText}>+</Text>
        </Pressable>
      </View>
      <FlashList
        data={data.items}
        renderItem={({ item }) => (
          <ToggleWrapper
            listing={item}
            onPress={() => {
              router.push(`/(owner)/listings/${item.id}`);
            }}
          />
        )}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => {
              void refetch();
            }}
          />
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonText: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textInverse,
  },
  list: {
    padding: spacing.base,
  },
});
