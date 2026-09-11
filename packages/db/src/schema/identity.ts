import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { primaryId, timestamps } from '../columns/common.js';

export const users = pgTable(
  'users',
  {
    id: primaryId(),
    phone: text('phone').notNull(),
    name: text('name'),
    email: text('email'),
    avatarUrl: text('avatar_url'),
    status: text('status').notNull().default('active'),
    firebaseUid: text('firebase_uid').notNull(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('users_phone_key').on(t.phone),
    uniqueIndex('users_firebase_uid_key').on(t.firebaseUid),
    check('users_status_check', sql`${t.status} IN ('active', 'blocked', 'deleted')`),
  ],
);

export const userRoles = pgTable(
  'user_roles',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    status: text('status').notNull().default('active'),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    grantedByUserId: uuid('granted_by_user_id').references(() => users.id),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('user_roles_user_id_role_key').on(t.userId, t.role),
    index('user_roles_user_id_idx').on(t.userId),
    index('user_roles_granted_by_user_id_idx').on(t.grantedByUserId),
    check('user_roles_role_check', sql`${t.role} IN ('driver','owner','valet','washer','admin')`),
    check(
      'user_roles_status_check',
      sql`${t.status} IN ('active', 'pending', 'suspended', 'rejected')`,
    ),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    familyId: uuid('family_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    userAgent: text('user_agent'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('refresh_tokens_token_hash_key').on(t.tokenHash),
    index('refresh_tokens_user_id_idx').on(t.userId),
    index('refresh_tokens_family_id_idx').on(t.familyId),
  ],
);
