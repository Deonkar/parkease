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
    isRead: boolean('is_read').notNull().default(false),
    readAt: timestamp('read_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('notifications_user_id_idx').on(t.userId),
    index('notifications_user_id_is_read_idx').on(t.userId, t.isRead),
    check(
      'notifications_type_check',
      sql`${t.type} IN (
        'booking_confirmed','booking_reminder','booking_expired','booking_cancelled',
        'valet_assigned','valet_arrived','valet_parked',
        'wash_accepted','wash_completed',
        'payout_processed','review_request',
        'space_approved','space_rejected',
        'weekly_summary'
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

export interface NotificationPreferencesMap {
  booking_confirmed?: boolean;
  booking_reminder?: boolean;
  booking_expired?: boolean;
  booking_cancelled?: boolean;
  valet_assigned?: boolean;
  valet_arrived?: boolean;
  valet_parked?: boolean;
  wash_accepted?: boolean;
  wash_completed?: boolean;
  payout_processed?: boolean;
  review_request?: boolean;
  space_approved?: boolean;
  space_rejected?: boolean;
  weekly_summary?: boolean;
}

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
