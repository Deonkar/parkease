import {
  DEFAULT_PUSH_ENABLED,
  NOTIFICATION_CATEGORIES,
  type NotificationPreference,
  type NotificationView,
  type UpdateNotificationPreferences,
} from '@parkease/contracts/shared';

/**
 * Served only to a dev-mock session (`isSharedDevMock`), so the feed and settings open in the web
 * preview with no API. In-memory and mutable: marking read in the preview behaves like the real
 * thing. Includes the awkward rows on purpose: a failed payout (actionable) and a lakh-sized
 * rupee amount in a body.
 */
const minutesAgo = (m: number): string => new Date(Date.now() - m * 60_000).toISOString();

const row = (
  n: number,
  category: NotificationView['category'],
  title: string,
  body: string,
  ago: number,
  extra: Partial<NotificationView> = {},
): NotificationView =>
  ({
    id: `0192f1c0-0000-7000-8000-${String(n).padStart(12, '0')}`,
    category,
    actionable: false,
    title,
    body,
    deepLink: null,
    isRead: false,
    createdAt: minutesAgo(ago),
    ...extra,
  }) as NotificationView;

let items: NotificationView[] = [
  row(
    9,
    'bookings',
    'Booking confirmed',
    'Your spot is reserved. Open the booking for directions and your pass.',
    2,
    { deepLink: '/(driver)/bookings' },
  ),
  row(
    8,
    'payouts',
    "Payout couldn't go through",
    "We couldn't send ₹1,24,500 to your account. Check your bank details and we'll retry.",
    15,
    { actionable: true, deepLink: '/(owner)/earnings/payouts' },
  ),
  row(
    7,
    'valet',
    'Your car is parked',
    'Your valet has parked your car. Photo proof is in the job.',
    90,
  ),
  row(
    6,
    'payouts',
    '₹3,200 deposited',
    'Your weekly payout was sent to the account ending 1234.',
    60 * 26,
    {
      isRead: true,
    },
  ),
  row(5, 'spaces', 'Space approved', 'Your parking space is now live.', 60 * 28, { isRead: true }),
  row(
    4,
    'account',
    'Commission-free until your window ends',
    'You keep your full earnings until 6 Jan.',
    60 * 24 * 5,
    { isRead: true },
  ),
];

let prefs: NotificationPreference[] = NOTIFICATION_CATEGORIES.map((category) => ({
  category,
  pushEnabled: DEFAULT_PUSH_ENABLED[category],
  inAppEnabled: true,
}));

export const devNotifications = {
  feed: (cursor: string | undefined) => {
    const start = cursor === undefined ? 0 : items.findIndex((i) => i.id === cursor) + 1;
    const page = items.slice(start, start + 20);
    const hasMore = start + 20 < items.length;
    return Promise.resolve({
      data: page,
      meta: { limit: 20, hasMore, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null },
    });
  },
  unread: () => Promise.resolve(items.filter((i) => !i.isRead).length),
  markRead: (id: string) => {
    items = items.map((i) => (i.id === id ? { ...i, isRead: true } : i));
    return Promise.resolve();
  },
  markAllRead: () => {
    items = items.map((i) => ({ ...i, isRead: true }));
    return Promise.resolve();
  },
  preferences: () => Promise.resolve(prefs),
  save: (update: UpdateNotificationPreferences) => {
    prefs = prefs.map((p) => {
      const u = update.preferences.find((x) => x.category === p.category);
      return u === undefined
        ? p
        : {
            ...p,
            ...(u.pushEnabled === undefined ? {} : { pushEnabled: u.pushEnabled }),
            ...(u.inAppEnabled === undefined ? {} : { inAppEnabled: u.inAppEnabled }),
          };
    });
    return Promise.resolve(prefs);
  },
};
