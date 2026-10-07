import { type NotificationCategory, type NotificationView } from '@parkease/contracts/shared';

import type { NotificationRow } from '../../../domains/notification/notification.service.js';

/** `category` is a CHECK-constrained column, so the cast narrows what the database already proved. */
export const toNotificationView = (row: NotificationRow): NotificationView =>
  ({
    id: row.id,
    category: row.category as NotificationCategory,
    actionable: row.actionable,
    title: row.title,
    body: row.body,
    deepLink: row.deepLink,
    isRead: row.isRead,
    createdAt: row.createdAt.toISOString(),
  }) as NotificationView;
