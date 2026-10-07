import type {
  NotificationPreference,
  UpdateNotificationPreferences,
} from '@parkease/contracts/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  fetchFeed,
  fetchPreferences,
  fetchUnreadCount,
  markAllRead,
  markRead,
  savePreferences,
} from './api';

export const notificationKeys = {
  all: ['notifications'] as const,
  feed: ['notifications', 'feed'] as const,
  unread: ['notifications', 'unread-count'] as const,
  prefs: ['notifications', 'preferences'] as const,
};

export function useNotificationFeed() {
  return useInfiniteQuery({
    queryKey: notificationKeys.feed,
    queryFn: ({ pageParam, signal }) => fetchFeed(pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  });
}

/** Polled every 30 s; the badge is a hint, not a promise. */
export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unread,
    queryFn: ({ signal }) => fetchUnreadCount(signal),
    refetchInterval: 30_000,
  });
}

const useRefresh = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: notificationKeys.all });
};

export function useMarkRead() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: markRead, onSettled: refresh });
}

export function useMarkAllRead() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: markAllRead, onSettled: refresh });
}

export function usePreferences() {
  return useQuery({
    queryKey: notificationKeys.prefs,
    queryFn: ({ signal }) => fetchPreferences(signal),
  });
}

function applyUpdate(
  list: NotificationPreference[] | undefined,
  update: UpdateNotificationPreferences,
): NotificationPreference[] | undefined {
  return list?.map((p) => {
    const u = update.preferences.find((x) => x.category === p.category);
    if (u === undefined) return p;
    return {
      ...p,
      ...(u.pushEnabled === undefined ? {} : { pushEnabled: u.pushEnabled }),
      ...(u.inAppEnabled === undefined ? {} : { inAppEnabled: u.inAppEnabled }),
    };
  });
}

/**
 * Optimistic: a switch that lags behind the finger reads as broken. On failure the previous list
 * is restored and the error stays on the mutation for the screen to show (R-FAIL-01).
 */
export function useUpdatePreference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update: UpdateNotificationPreferences) => savePreferences(update),
    onMutate: async (update) => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.prefs });
      const previous = queryClient.getQueryData<NotificationPreference[]>(notificationKeys.prefs);
      queryClient.setQueryData<NotificationPreference[]>(notificationKeys.prefs, (old) =>
        applyUpdate(old, update),
      );
      return { previous };
    },
    onError: (_error, _update, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(notificationKeys.prefs, context.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.prefs }),
  });
}
