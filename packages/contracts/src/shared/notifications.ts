import { z } from 'zod';

import { notificationIdSchema } from '../primitives/ids.js';
import { cursorPageOf } from '../primitives/pagination.js';

import { NOTIFICATION_CATEGORIES } from './notification-catalog.js';

/**
 * Keyset on the notification id, like payouts: ids are UUIDv7, so id order is creation order and
 * the cursor is simply the last id.
 */
export const notificationFeedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: notificationIdSchema.optional(),
});
export type NotificationFeedQuery = z.infer<typeof notificationFeedQuerySchema>;

export const notificationViewSchema = z.object({
  id: notificationIdSchema,
  category: z.enum(NOTIFICATION_CATEGORIES),
  actionable: z.boolean(),
  title: z.string(),
  body: z.string(),
  deepLink: z.string().nullable(),
  isRead: z.boolean(),
  createdAt: z.string().datetime(),
});
export type NotificationView = z.infer<typeof notificationViewSchema>;

export const notificationFeedSchema = cursorPageOf(notificationViewSchema);
export type NotificationFeed = z.infer<typeof notificationFeedSchema>;

export const unreadCountSchema = z.object({ count: z.number().int().nonnegative() });
export type UnreadCount = z.infer<typeof unreadCountSchema>;
