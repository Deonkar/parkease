import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  OWNER_EARNINGS_PERIOD_VALUES,
  type OwnerEarningsPeriod,
  type StatementLine as Line,
} from '@parkease/contracts/owner';
import {
  colors,
  fontSize,
  fontWeight,
  layout,
  radius,
  spacing,
  touchTarget,
} from '@parkease/tokens';
import { ErrorState, Skeleton } from '@parkease/ui-native';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EarningsBars } from '@/features/owner/components/EarningsBars';
import { KpiCard } from '@/features/owner/components/KpiCard';
import { StatementLine } from '@/features/owner/components/StatementLine';
import { useOwnerEarnings, useOwnerTransactions } from '@/features/owner/hooks/useOwnerQueries';
import { PeriodTabs } from '@/features/shared/components/PeriodTabs';
import { RefreshNotice } from '@/features/shared/components/RefreshNotice';
import { resolveScreenState } from '@/features/shared/screen-state';
import { formatPaise } from '@/lib/money';

const LABELS: Record<OwnerEarningsPeriod, { tab: string; heading: string; empty: string }> = {
  today: { tab: 'Today', heading: 'Today', empty: 'No paid bookings today' },
  week: { tab: 'Week', heading: 'This week', empty: 'No paid bookings this week' },
  month: { tab: 'Month', heading: 'This month', empty: 'No paid bookings this month' },
};

const renderLine = ({ item }: { readonly item: Line }) => <StatementLine line={item} />;
const Separator = () => <View style={styles.separator} />;

/**
 * Direction A · "Statement", earnings (spec §4). The headline and bars are
 * the server's period movement; the list is the statement, paged by cursor.
 * Nothing on this screen is computed from anything else on it (R-FE-06).
 *
 * `PeriodTabs` sits above the loading/error/ready switch, not inside the
 * FlashList header, so a tap on an unloaded period never unmounts the tab
 * bar itself — only the content beneath it goes to a skeleton (fix round 1:
 * the tabs used to live only in `ListHeaderComponent`, which the loading and
 * error branches never render).
 */
export default function OwnerEarningsScreen() {
  const [period, setPeriod] = useState<OwnerEarningsPeriod>('month');
  const earnings = useOwnerEarnings(period);
  const transactions = useOwnerTransactions(period);
  const [pulling, setPulling] = useState(false);

  const onPull = () => {
    setPulling(true);
    void Promise.all([earnings.refetch(), transactions.refetch()]).finally(() => {
      setPulling(false);
    });
  };

  const lines = useMemo(
    () => transactions.data?.pages.flatMap((page) => page.data) ?? [],
    [transactions.data],
  );
  const screen = resolveScreenState(earnings);

  const tabs = (
    <PeriodTabs
      values={OWNER_EARNINGS_PERIOD_VALUES}
      label={(p) => LABELS[p].tab}
      value={period}
      onChange={setPeriod}
    />
  );

  const header = (
    <View style={styles.header}>
      {earnings.isError && earnings.data !== undefined ? (
        <RefreshNotice
          testID="earnings-refresh-notice"
          retryLabel="Refresh your earnings"
          onRetry={() => void earnings.refetch()}
        />
      ) : null}
      {earnings.data === undefined ? null : (
        <View style={styles.summary}>
          <KpiCard
            hero
            label={LABELS[period].heading}
            value={formatPaise(earnings.data.netPaise, { alwaysDecimals: true })}
            caption={`${String(earnings.data.bookings)} ${earnings.data.bookings === 1 ? 'booking' : 'bookings'}`}
            testID="earnings-headline"
          />
          <EarningsBars days={earnings.data.days} />
        </View>
      )}
      {/* R-FAIL-01: a failed background refetch or pull no longer goes silent
          just because pages already loaded — `ListEmptyComponent` only fires
          with zero rows, so this is the notice for "still have rows, latest
          fetch failed". */}
      {transactions.isError && lines.length > 0 ? (
        <RefreshNotice
          testID="transactions-refresh-notice"
          retryLabel="Refresh your transactions"
          onRetry={() => void transactions.refetch()}
        />
      ) : null}
      {lines.length > 0 ? (
        <Text style={styles.section} accessibilityRole="header">
          TRANSACTIONS
        </Text>
      ) : null}
    </View>
  );

  const footer = (
    <>
      {transactions.isFetchNextPageError ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void transactions.fetchNextPage()}
          style={styles.loadMoreRetry}
        >
          <Text style={styles.loadMoreRetryText}>Couldn&apos;t load more. Tap to retry.</Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          router.push('/(owner)/earnings/payouts');
        }}
        style={styles.payouts}
      >
        <Text style={styles.payoutsText}>Payouts</Text>
        <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textSecondary} />
      </Pressable>
    </>
  );

  const content = (): ReactNode => {
    if (screen === 'loading') {
      return (
        <View style={styles.skeletons} testID="earnings-skeleton">
          <Skeleton width="100%" height={layout.skeleton.block} borderRadius={radius.md} />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width="100%" height={layout.skeleton.card} borderRadius={radius.md} />
          ))}
        </View>
      );
    }

    if (screen === 'error') {
      return (
        <ErrorState
          title="Couldn't load your earnings"
          body="Check your connection and try again."
          onAction={() => void earnings.refetch()}
        />
      );
    }

    return (
      <FlashList
        data={lines}
        keyExtractor={(line) => line.bookingId}
        renderItem={renderLine}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={styles.list}
        refreshing={pulling}
        onRefresh={onPull}
        onEndReached={() => {
          if (transactions.hasNextPage && !transactions.isFetchingNextPage) {
            void transactions.fetchNextPage();
          }
        }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          transactions.isError ? (
            <ErrorState
              title="Couldn't load transactions"
              body="Check your connection and try again."
              onAction={() => void transactions.refetch()}
            />
          ) : transactions.isPending ? (
            <Skeleton width="100%" height={layout.skeleton.card} borderRadius={radius.md} />
          ) : (
            <View style={styles.empty} testID="earnings-empty">
              <MaterialCommunityIcons
                name="receipt-text-outline"
                size={40}
                color={colors.textTertiary}
              />
              <Text style={styles.emptyTitle}>{LABELS[period].empty}</Text>
              <Text style={styles.emptyBody}>
                Each paid booking appears here with what you earned.
              </Text>
            </View>
          )
        }
        ListFooterComponent={footer}
      />
    );
  };

  return (
    <View style={styles.root}>
      <View style={styles.tabsRow}>{tabs}</View>
      <View style={styles.body}>{content()}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  tabsRow: {
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  body: { flex: 1 },
  skeletons: { padding: spacing.base, gap: spacing.md },
  list: { padding: spacing.base, paddingBottom: spacing.xl },
  header: { gap: spacing.base, marginBottom: spacing.md },
  summary: {
    gap: spacing.base,
    padding: spacing.base,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  section: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.textTertiary,
    letterSpacing: 0.4,
  },
  separator: { height: spacing.md },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing['2xl'],
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    color: colors.text,
    textAlign: 'center',
  },
  emptyBody: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
  loadMoreRetry: {
    minHeight: touchTarget,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
  },
  loadMoreRetryText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.warning,
  },
  payouts: {
    marginTop: spacing.lg,
    minHeight: touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.base,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  payoutsText: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.text },
});
