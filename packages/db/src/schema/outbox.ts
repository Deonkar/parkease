import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { primaryId, timestamps } from '../columns/common.js';

export type OutboxPayload = Record<string, unknown>;

export const outboxMessages = pgTable(
  'outbox_messages',
  {
    id: primaryId(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<OutboxPayload>().notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    lastError: text('last_error'),
    traceId: text('trace_id'),
    ...timestamps,
  },
  (t) => [
    index('outbox_messages_pending_idx')
      .on(t.availableAt)
      .where(sql`${t.status} = 'pending'`),
    check('outbox_messages_status_check', sql`${t.status} IN ('pending','dispatched','failed')`),
  ],
);
