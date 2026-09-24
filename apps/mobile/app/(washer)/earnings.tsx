import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { WasherEarningsLine, WasherEarningsPeriod } from '@parkease/contracts/washer';
import { colors, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import { ErrorState, Skeleton } from '@parkease/ui-native';
import { FlashList } from '@shopify/flash-list';
import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolveScreenState } from '@/features/shared/screen-state';
import { loadFailureCopy } from '@/features/washer/api/errors';
import { EarningsLine } from '@/features/washer/components/EarningsLine';
import { EarningsSummary } from '@/features/washer/components/EarningsSummary';
import { PeriodTabs } from '@/features/washer/components/PeriodTabs';
import { RefreshNotice } from '@/features/washer/components/RefreshNotice';
import { useWasherEarnings } from '@/features/washer/hooks/useWasherQueries';
import { PERIOD_LABELS } from '@/features/washer/labels';
import { assertNever } from '@/lib/assert-never';

function EarningsSkeleton() {
  return (
    <View style={styles.skeletons} testID="earnings-skeleton">
      <Skeleton width="100%" height={112} borderRadius={radius.lg} />
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} width="100%" height={168} borderRadius={radius.lg} />
      ))}
    </View>
  );
}

/** Names the period, so "nothing" is never ambiguous about when. */
function PeriodEmpty({ period }: { readonly period: WasherEarningsPeriod }) {
  return (
    <View style={styles.empty} testID="earnings-empty">
      <MaterialCommunityIcons name="car-wash" size={40} color={colors.textTertiary} />
      <Text style={styles.emptyTitle}>{PERIOD_LABELS[period].empty}</Text>
      <Text style={styles.emptyBody}>
        Each wash you finish appears here with what you earned on it.
      </Text>
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const renderLine = ({ item }: { readonly item: WasherEarningsLine }) => (
  <EarningsLine line={item} />
);

/**
 * §6.4 — earnings, direction "Bay".
 *
 * Every figure on this screen is a response field, formatted and nothing else
 * (R-FE-06): the headline is `summary.netPaise`, each row is the ledger's own
 * three amounts. The summary and the rows count by different instants and need
 * not sum (see `washerEarningsViewSchema`), so nothing here reconciles them.
 *
 * Period tabs rather than the wireframe's three simultaneous figures, and no
 * sparkline: sizing daily bars would mean summing paise per day in the client
 * (spec §4.3). Week is the default because it is the period a partner is paid
 * on. Each period is its own cache entry, so switching to one not yet loaded
 * shows a skeleton rather than the previous period's money under the new tab.
 */
export default function WasherEarningsScreen() {
  const insets = useSafeAreaInsets();
  const [period, setPeriod] = useState<WasherEarningsPeriod>('week');
  const earnings = useWasherEarnings(period);
  // Only a pull shows the pull indicator; a background refetch stays silent.
  const [pulling, setPulling] = useState(false);

  const onPull = () => {
    setPulling(true);
    // `refetch` resolves on failure too; a failed pull surfaces as `isError`
    // and the RefreshNotice below, never as a swallowed rejection.
    void earnings.refetch().finally(() => {
      setPulling(false);
    });
  };

  const content = (): ReactNode => {
    const screen = resolveScreenState(earnings);
    switch (screen) {
      case 'loading':
        return <EarningsSkeleton />;
      case 'error':
        return (
          <ErrorState
            title="Couldn't load your earnings"
            body={loadFailureCopy(earnings.error)}
            onAction={() => void earnings.refetch()}
          />
        );
      case 'empty':
      case 'ready': {
        const view = earnings.data;
        // The endpoint always answers with a summary; with no answer at all
        // there is no figure to show, only the period's empty state.
        if (view === undefined) return <PeriodEmpty period={period} />;
        return (
          <>
            {earnings.isError ? (
              // The figures stay on screen (ruling T7-I2); this only says the
              // latest refresh failed, and offers another.
              <RefreshNotice
                testID="earnings-refresh-notice"
                retryLabel="Refresh your earnings"
                onRetry={() => void earnings.refetch()}
              />
            ) : null}
            <FlashList
              data={view.lines}
              keyExtractor={(line) => line.jobId}
              renderItem={renderLine}
              ItemSeparatorComponent={Separator}
              contentContainerStyle={styles.list}
              refreshing={pulling}
              onRefresh={onPull}
              ListHeaderComponent={
                <View style={styles.listHeader}>
                  <EarningsSummary period={view.period} summary={view.summary} />
                  {view.lines.length > 0 ? (
                    <Text style={styles.section} accessibilityRole="header">
                      COMPLETED WASHES
                    </Text>
                  ) : null}
                </View>
              }
              ListEmptyComponent={<PeriodEmpty period={view.period} />}
            />
          </>
        );
      }
      default:
        return assertNever(screen);
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.title} accessibilityRole="header">
          Earnings
        </Text>
        <PeriodTabs value={period} onChange={setPeriod} />
      </View>
      {content()}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: {
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  skeletons: { padding: spacing.base, gap: spacing.md },
  // FlashList honours padding here, not gap: rows are spaced by the Separator.
  list: { padding: spacing.base, paddingBottom: spacing.xl },
  listHeader: { gap: spacing.base, marginBottom: spacing.md },
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
});
