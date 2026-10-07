import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { primaryId, timestamps } from '../columns/common.js';

import { users } from './identity.js';

export const notifications = pgTable(
  'notifications',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    data: jsonb('data'),
    category: text('category').notNull().default('account'),
    actionable: boolean('actionable').notNull().default(false),
    deepLink: text('deep_link'),
    dedupeKey: text('dedupe_key'),
    isRead: boolean('is_read').notNull().default(false),
    readAt: timestamp('read_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('notifications_user_id_idx').on(t.userId),
    index('notifications_user_id_is_read_idx').on(t.userId, t.isRead),
    index('notifications_user_id_id_idx').on(t.userId, t.id.desc()),
    uniqueIndex('notifications_dedupe_key_key')
      .on(t.dedupeKey)
      .where(sql`${t.dedupeKey} IS NOT NULL`),
    check(
      'notifications_category_check',
      sql`${t.category} IN (
        'bookings','valet','carwash','jobs','spaces','payouts','reviews','account','promotions'
      )`,
    ),
  ],
);

export const pushTokens = pgTable(
  'push_tokens',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    platform: text('platform').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('push_tokens_token_key').on(t.token),
    index('push_tokens_user_id_idx').on(t.userId),
    check('push_tokens_platform_check', sql`${t.platform} IN ('ios','android','web')`),
  ],
);

/** Per category; a missing category or key falls back to DEFAULT_PUSH_ENABLED / in-app on. */
export type NotificationPreferencesMap = Partial<
  Record<
    | 'bookings'
    | 'valet'
    | 'carwash'
    | 'jobs'
    | 'spaces'
    | 'payouts'
    | 'reviews'
    | 'account'
    | 'promotions',
    { push?: boolean; inApp?: boolean }
  >
>;

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    preferences: jsonb('preferences').$type<NotificationPreferencesMap>().notNull().default({}),
    ...timestamps,
  },
  (t) => [uniqueIndex('notification_preferences_user_id_key').on(t.userId)],
);

export const pushReceipts = pgTable(
  'push_receipts',
  {
    id: primaryId(),
    ticketId: text('ticket_id').notNull(),
    tokenId: uuid('token_id')
      .notNull()
      .references(() => pushTokens.id, { onDelete: 'cascade' }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('push_receipts_ticket_id_key').on(t.ticketId),
    index('push_receipts_token_id_idx').on(t.tokenId),
    index('push_receipts_pending_idx')
      .on(t.createdAt)
      .where(sql`${t.processedAt} IS NULL`),
  ],
);
