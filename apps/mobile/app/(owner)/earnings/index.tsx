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
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { earningsSubtitle } from '@/features/owner/commission-waiver';
import { EarningsBars } from '@/features/owner/components/EarningsBars';
import { KpiCard } from '@/features/owner/components/KpiCard';
import { StatementLine } from '@/features/owner/components/StatementLine';
import {
  useOwnerDashboard,
  useOwnerEarnings,
  useOwnerTransactions,
} from '@/features/owner/hooks/useOwnerQueries';
import { PeriodTabs } from '@/features/shared/components/PeriodTabs';
import { ReadableColumn } from '@/features/shared/components/ReadableColumn';
import { RefreshNotice } from '@/features/shared/components/RefreshNotice';
import { GetPaidRow } from '@/features/shared/get-paid/entry';
import { resolveScreenState } from '@/features/shared/screen-state';
import { formatPaise } from '@/lib/money';

const LABELS: Record<OwnerEarningsPeriod, { tab: string; heading: string; empty: string }> = {
  today: { tab: 'Today', heading: 'Today', empty: 'No paid bookings today' },
  week: { tab: 'Week', heading: 'This week', empty: 'No paid bookings this week' },
  month: { tab: 'Month', heading: 'This month', empty: 'No paid bookings this month' },
};

const renderLine = ({ item }: { readonly item: Line }) => (
  <View style={styles.columnInset}>
    <StatementLine line={item} />
  </View>
);
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
  // The dashboard already carries the window (task 16c); TanStack shares its cache.
  // undefined until it answers, so a failed or pending read never shows the wrong subtitle.
  const waiver = useOwnerDashboard().data?.commissionWaiver;
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
        <KpiCard
          hero
          label={LABELS[period].heading}
          value={formatPaise(earnings.data.netPaise, { alwaysDecimals: true })}
          caption={`${String(earnings.data.bookings)} ${earnings.data.bookings === 1 ? 'booking' : 'bookings'}`}
          testID="earnings-headline"
        >
          <EarningsBars days={earnings.data.days} />
        </KpiCard>
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
    // Same `columnInset` the header and each statement line use (V2, fix
    // wave 5): the FlashList's own `contentContainerStyle` no longer carries
    // a horizontal inset, so every section that needs one names it itself.
    <View style={styles.columnInset}>
      {transactions.isFetchNextPageError ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void transactions.fetchNextPage()}
          style={styles.loadMoreRetry}
        >
          <Text style={styles.loadMoreRetryText}>Couldn&apos;t load more. Tap to retry.</Text>
        </Pressable>
      ) : null}
      <View style={styles.payouts}>
        <GetPaidRow href="/(owner)/earnings/payouts" caption="Paid as each booking is paid" />
      </View>
    </View>
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
      <View style={styles.titleBlock}>
        <ReadableColumn>
          <Text style={styles.title} accessibilityRole="header">
            Earnings
          </Text>
          <Text style={styles.subtitle}>{earningsSubtitle(waiver)}</Text>
        </ReadableColumn>
      </View>
      {/* The strip stays full width (it carries the border); only the tabs
          inside it are held to the readable column, so they align with the
          statement lines below on a wide viewport. */}
      <View style={styles.tabsRow}>
        <ReadableColumn>{tabs}</ReadableColumn>
      </View>
      <View style={styles.body}>
        <ReadableColumn style={styles.bodyColumn}>{content()}</ReadableColumn>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  titleBlock: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.base,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
    gap: spacing.xs / 2,
  },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, color: colors.text },
  subtitle: { fontSize: fontSize.sm, color: colors.textSecondary },
  tabsRow: {
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  body: { flex: 1 },
  bodyColumn: { flex: 1 },
  skeletons: { padding: spacing.base, gap: spacing.md },
  // Vertical only: a horizontal inset here wraps the header (an ordinary
  // child) and each recycled item cell differently enough at a wide
  // viewport to visibly misalign them (V2, fix wave 5) — `columnInset`
  // below is the one inset every section applies to itself instead.
  list: { paddingTop: spacing.base, paddingBottom: spacing.xl },
  columnInset: { paddingHorizontal: spacing.base },
  header: { gap: spacing.base, marginBottom: spacing.md, paddingHorizontal: spacing.base },
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
  payouts: { marginTop: spacing.lg },
});
