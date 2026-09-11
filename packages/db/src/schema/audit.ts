import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { primaryId } from '../columns/common.js';

import { users } from './identity.js';

export const auditLog = pgTable(
  'audit_log',
  {
    id: primaryId(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    actorRole: text('actor_role'),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ipAddress: text('ip_address'),
    traceId: text('trace_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_actor_user_id_idx').on(t.actorUserId),
    index('audit_log_target_idx').on(t.targetType, t.targetId),
    index('audit_log_created_at_idx').on(t.createdAt),
  ],
);
