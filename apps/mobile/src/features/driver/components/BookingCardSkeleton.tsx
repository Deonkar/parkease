import { colors, radius, spacing } from '@parkease/tokens';
import { Skeleton } from '@parkease/ui-native';
import { StyleSheet, View } from 'react-native';

/**
 * A skeleton shaped like the card it stands in for.
 *
 * The generic `ListSkeleton` draws a circle and two bars — an avatar row — which
 * is the wrong silhouette here and makes the list visibly rearrange itself when
 * real data lands. A skeleton that does not match its content is just a loading
 * spinner with extra steps.
 */
export function BookingCardSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <Skeleton width="55%" height={18} />
        <Skeleton width={84} height={22} borderRadius={radius.sm} />
      </View>
      <Skeleton width="75%" height={14} />
      <Skeleton width="60%" height={14} />
      <View style={styles.footRow}>
        <Skeleton width={72} height={18} />
      </View>
    </View>
  );
}

export function BookingListSkeleton({ count = 4 }: { readonly count?: number }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }, (_, index) => (
        <BookingCardSkeleton key={index} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.md,
    paddingHorizontal: spacing.base,
  },
  card: {
    gap: spacing.sm,
    padding: spacing.base,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  footRow: {
    marginTop: spacing.xs,
  },
});
