import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ApprovalStatus } from '@parkease/contracts/enums';
import type { OwnerDashboard } from '@parkease/contracts/owner';
import {
  colors,
  fontSize,
  fontWeight,
  layout,
  radius,
  spacing,
  touchTarget,
} from '@parkease/tokens';
import { Button, EmptyState, ErrorState, Skeleton } from '@parkease/ui-native';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { KpiCard } from '@/features/owner/components/KpiCard';
import { StatementLine } from '@/features/owner/components/StatementLine';
import { greeting, growthCaption } from '@/features/owner/greeting';
import { useOwnerDashboard } from '@/features/owner/hooks/useOwnerQueries';
import { ReadableColumn } from '@/features/shared/components/ReadableColumn';
import { RefreshNotice } from '@/features/shared/components/RefreshNotice';
import { resolveScreenState } from '@/features/shared/screen-state';
import { assertNever } from '@/lib/assert-never';
import { formatDayMonthIST } from '@/lib/format';
import { formatPaise } from '@/lib/money';

const money = (paise: OwnerDashboard['owedPaise']) => formatPaise(paise, { alwaysDecimals: true });
const pct = (bp: number) => `${String(Math.round(bp / 100))}%`;

function DashboardSkeleton() {
  return (
    <View style={styles.skeletonGroup} testID="dashboard-skeleton">
      <Skeleton width="100%" height={layout.skeleton.block} borderRadius={radius.md} />
      <Skeleton width="100%" height={layout.skeleton.card} borderRadius={radius.md} />
      <Skeleton width="100%" height={layout.skeleton.card} borderRadius={radius.md} />
    </View>
  );
}

function ScanButton() {
  return (
    <Button
      label="Scan a driver's QR"
      variant="secondary"
      onPress={() => {
        router.push('/(owner)/scan');
      }}
    />
  );
}

function SpaceRow({ space }: { readonly space: OwnerDashboard['spaces'][number] }) {
  const live = space.approvalStatus === ApprovalStatus.ACTIVE;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${space.title}, ${live ? 'live' : 'paused, not in search'}, occupancy ${pct(space.occupancyBp)} today`}
      onPress={() => {
        router.push(`/(owner)/listings/${space.id}`);
      }}
      style={styles.spaceRow}
    >
      <View style={styles.spaceText}>
        <Text style={styles.spaceTitle} numberOfLines={1}>
          {space.title}
        </Text>
        <Text style={styles.muted}>{`Occupancy ${pct(space.occupancyBp)} today`}</Text>
      </View>
      {live ? (
        <View style={styles.pill}>
          <View style={styles.dot} />
          <Text style={styles.liveText}>Live</Text>
        </View>
      ) : (
        <View style={[styles.pill, styles.pausedPill]}>
          <Text style={styles.pausedText}>Paused · not in search</Text>
        </View>
      )}
    </Pressable>
  );
}

/**
 * Direction A · "Statement" (spec §4). Every figure is a response field,
 * formatted; the client computes nothing (R-FE-06). The scanner from task 6
 * stays, one tap from the top, because a driver at the gate outranks a chart.
 */
export default function OwnerDashboardScreen() {
  const dashboard = useOwnerDashboard();
  const [pulling, setPulling] = useState(false);

  const onPull = () => {
    setPulling(true);
    void dashboard.refetch().finally(() => {
      setPulling(false);
    });
  };

  const header = (greetingName: string | null): ReactNode => (
    <View>
      <Text style={styles.muted}>{formatDayMonthIST(new Date(), { weekday: true })}</Text>
      <Text style={styles.h1} accessibilityRole="header">
        {greetingName ? `${greeting()}, ${greetingName}` : greeting()}
      </Text>
    </View>
  );

  // A failed refetch over cached data says so in both ready branches — the
  // no-spaces one included — or the owner reads stale figures as current (R-FAIL-01).
  const refreshNotice: ReactNode = dashboard.isError ? (
    <RefreshNotice
      testID="dashboard-refresh-notice"
      retryLabel="Refresh your dashboard"
      onRetry={() => void dashboard.refetch()}
    />
  ) : null;

  const body = (data: OwnerDashboard): ReactNode => (
    <>
      {header(data.greetingName)}

      {refreshNotice}

      <KpiCard
        hero
        label="Owed to you"
        value={money(data.owedPaise)}
        caption="Held by ParkEase until your next payout."
        testID="kpi-owed"
      />
      <View style={styles.kpiRow}>
        <KpiCard
          label="Today"
          value={money(data.today.netPaise)}
          caption={`${String(data.today.bookings)} ${data.today.bookings === 1 ? 'booking' : 'bookings'}`}
          testID="kpi-today"
        />
        <KpiCard
          label="This month"
          value={money(data.month.netPaise)}
          caption={growthCaption(data.month.growthBp)}
          testID="kpi-month"
        />
      </View>

      <ScanButton />

      <View style={styles.cardHead}>
        <Text style={styles.h2} accessibilityRole="header">
          Statement
        </Text>
        <Pressable
          accessibilityRole="link"
          onPress={() => {
            router.push('/(owner)/earnings');
          }}
          style={styles.link}
        >
          <Text style={styles.linkText}>See all</Text>
        </Pressable>
      </View>
      {data.statement.length === 0 ? (
        <Text style={styles.muted}>Paid bookings appear here with what you earned on each.</Text>
      ) : (
        <View style={styles.statementList}>
          {data.statement.map((line) => (
            <StatementLine key={line.bookingId} line={line} />
          ))}
        </View>
      )}

      <Text style={styles.h2} accessibilityRole="header">
        Spaces
      </Text>
      {data.spaces.map((space) => (
        <SpaceRow key={space.id} space={space} />
      ))}
    </>
  );

  const content = (): ReactNode => {
    const screen = resolveScreenState(dashboard);
    switch (screen) {
      case 'loading':
        return <DashboardSkeleton />;
      case 'error':
        return (
          <ErrorState
            title="Couldn't load your dashboard"
            body="Check your connection and try again."
            onAction={() => void dashboard.refetch()}
          />
        );
      case 'empty':
        // Unreachable: OwnerDashboard is non-nullable, so resolveScreenState
        // never returns 'empty' for this query — the no-spaces case below is
        // ready state with a zero-length list, not an absent response.
        return null;
      case 'ready': {
        const data = dashboard.data;
        if (data === undefined) return null;
        if (data.spaces.length === 0) {
          return (
            <>
              {header(data.greetingName)}
              {refreshNotice}
              <ScanButton />
              <EmptyState
                title="List your first space"
                body="Once a space is live, today's earnings, bookings and occupancy show here."
                icon={
                  <MaterialCommunityIcons
                    name="home-plus-outline"
                    size={48}
                    color={colors.textTertiary}
                  />
                }
                actionLabel="Add a space"
                onAction={() => {
                  router.push('/(owner)/listings/new');
                }}
              />
            </>
          );
        }
        return body(data);
      }
      default:
        return assertNever(screen);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} />}
    >
      <ReadableColumn style={styles.column}>{content()}</ReadableColumn>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    backgroundColor: colors.surfaceSecondary,
  },
  column: {
    padding: spacing.base,
    gap: spacing.lg,
  },
  skeletonGroup: { gap: spacing.lg },
  h1: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, color: colors.text },
  h2: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  muted: { fontSize: fontSize.sm, color: colors.textSecondary },
  kpiRow: { flexDirection: 'row', gap: spacing.md },
  statementList: { gap: spacing.md },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  link: { minHeight: touchTarget, justifyContent: 'center', paddingHorizontal: spacing.sm },
  linkText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary },
  spaceRow: {
    minHeight: touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.base,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  spaceText: { flex: 1, gap: spacing.xs },
  spaceTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.text },
  pill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.availableVivid,
  },
  liveText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.available },
  pausedPill: {
    backgroundColor: colors.mutedSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
  },
  pausedText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
  },
});
