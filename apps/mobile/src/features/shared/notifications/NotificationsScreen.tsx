import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { NotificationView } from '@parkease/contracts/shared';
import { colors, fontSize, fontWeight, layout, radius, spacing } from '@parkease/tokens';
import { EmptyState, ErrorState, Skeleton } from '@parkease/ui-native';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import { warn } from '@/lib/log';

import { ReadableColumn } from '../components/ReadableColumn';
import { RefreshNotice } from '../components/RefreshNotice';
import { ScreenHeader } from '../components/ScreenHeader';
import { resolveScreenState } from '../screen-state';

import { useMarkAllRead, useMarkRead, useNotificationFeed } from './hooks';
import { NotificationItem } from './NotificationItem';
import { groupByDay, resolveTap } from './routing';

type Row =
  | { readonly kind: 'header'; readonly key: string; readonly label: string }
  | { readonly kind: 'item'; readonly key: string; readonly item: NotificationView };

const Gap = () => <View style={styles.gap} />;

/**
 * The feed (task 19b, direction B). Tapping a row marks it read and goes where its link says; a
 * link the user cannot use (a role they do not hold) leaves them here rather than on a screen
 * that would refuse them.
 */
export function NotificationsScreen({ tab = false }: { readonly tab?: boolean }) {
  const feed = useNotificationFeed();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const auth = useAuth();
  const now = useMemo(() => new Date(), [feed.dataUpdatedAt]);

  const items = useMemo(() => feed.data?.pages.flatMap((p) => p.data) ?? [], [feed.data]);
  const rows = useMemo<Row[]>(
    () =>
      groupByDay(items, now).flatMap((section) => [
        { kind: 'header' as const, key: `h-${section.label}`, label: section.label },
        ...section.items.map((item) => ({ kind: 'item' as const, key: item.id, item })),
      ]),
    [items, now],
  );
  const hasUnread = items.some((i) => !i.isRead);
  const screen = resolveScreenState({ ...feed, data: items });

  const open = (item: NotificationView): void => {
    if (!item.isRead) {
      markRead.mutate(item.id, {
        onError: (error) => {
          warn('notifications: could not mark as read', error);
        },
      });
    }
    if (auth.status !== 'authenticated') return;
    const target = resolveTap(item.deepLink, auth.roles, auth.activeRole);
    if (target === null) return;
    const go = async (): Promise<void> => {
      if (target.switchTo !== null) await auth.switchRole(target.switchTo);
      router.push(target.href as never);
    };
    go().catch((error: unknown) => {
      warn('notifications: could not open the target', error);
    });
  };

  const markAllButton = (
    <Pressable
      testID="mark-all-read"
      accessibilityRole="button"
      accessibilityLabel="Mark all as read"
      accessibilityState={{ disabled: !hasUnread || markAll.isPending }}
      disabled={!hasUnread || markAll.isPending}
      onPress={() => {
        markAll.mutate(undefined, {
          onError: (error) => {
            warn('notifications: could not mark all as read', error);
          },
        });
      }}
      style={styles.markAll}
      android_ripple={{ color: colors.surfaceTertiary, borderless: true, radius: 24 }}
    >
      <MaterialCommunityIcons
        name="check-all"
        size={24}
        color={hasUnread ? colors.primary : colors.textTertiary}
      />
    </Pressable>
  );
  const header = <ScreenHeader title="Notifications" canGoBack={!tab} right={markAllButton} />;

  if (screen === 'loading') {
    return (
      <View style={styles.root} testID="notifications-skeleton">
        {header}
        <View style={styles.skeletons}>
          {[0, 1, 2, 3].map((n) => (
            <Skeleton key={n} width="100%" height={layout.skeleton.row} borderRadius={radius.md} />
          ))}
        </View>
      </View>
    );
  }
  if (screen === 'error') {
    return (
      <View style={styles.root}>
        {header}
        <ErrorState
          title="Couldn't load your notifications"
          body="Check your connection and try again."
          onAction={() => void feed.refetch()}
        />
      </View>
    );
  }
  if (screen === 'empty') {
    return (
      <View style={styles.root}>
        {header}
        <EmptyState
          title="All caught up"
          body="We'll let you know about bookings, valets, payouts and more."
          icon={
            <MaterialCommunityIcons
              accessibilityElementsHidden
              importantForAccessibility="no"
              name="bell-sleep-outline"
              size={48}
              color={colors.textTertiary}
            />
          }
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {header}
      <ReadableColumn style={styles.body}>
        {feed.isError ? (
          <RefreshNotice
            testID="notifications-refresh-notice"
            retryLabel="Refresh your notifications"
            onRetry={() => void feed.refetch()}
          />
        ) : null}
        <FlashList<Row>
          data={rows}
          keyExtractor={(r) => r.key}
          getItemType={(r) => r.kind}
          renderItem={({ item: row }) =>
            row.kind === 'header' ? (
              <Text style={styles.section} accessibilityRole="header">
                {row.label}
              </Text>
            ) : (
              <NotificationItem item={row.item} now={now} onPress={open} />
            )
          }
          ItemSeparatorComponent={Gap}
          refreshing={feed.isRefetching && !feed.isFetchingNextPage}
          onRefresh={() => void feed.refetch()}
          onEndReached={() => {
            if (feed.hasNextPage && !feed.isFetchingNextPage && !feed.isFetchNextPageError) {
              void feed.fetchNextPage();
            }
          }}
          ListFooterComponent={
            feed.isFetchNextPageError ? (
              <Pressable
                testID="notifications-more-retry"
                accessibilityRole="button"
                onPress={() => void feed.fetchNextPage()}
                style={styles.footer}
              >
                <Text style={styles.footerRetry}>Couldn&apos;t load more. Tap to retry.</Text>
              </Pressable>
            ) : feed.hasNextPage ? null : (
              <Text style={[styles.footer, styles.footerText]}>No older notifications</Text>
            )
          }
          contentContainerStyle={styles.list}
        />
      </ReadableColumn>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  body: { flex: 1 },
  skeletons: { padding: spacing.base, gap: spacing.sm },
  list: { paddingBottom: spacing.xl },
  gap: { height: spacing.sm },
  section: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.base,
    paddingBottom: spacing.sm,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
  },
  markAll: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  footer: {
    minHeight: 48,
    paddingVertical: spacing.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerText: { textAlign: 'center', fontSize: fontSize.sm, color: colors.textTertiary },
  footerRetry: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.warning },
});
