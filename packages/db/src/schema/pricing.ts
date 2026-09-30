import { sql } from 'drizzle-orm';
import { check, integer, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { primaryId } from '../columns/common.js';

import { users } from './identity.js';

/** One owner's commission-free window (task 16c, ADR-032). The 50-slot cap is the CHECK. */
export const commissionWaivers = pgTable(
  'commission_waivers',
  {
    id: primaryId(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    slot: integer('slot').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('commission_waivers_owner_id_key').on(t.ownerId),
    uniqueIndex('commission_waivers_slot_key').on(t.slot),
    check('commission_waivers_slot_check', sql`${t.slot} BETWEEN 1 AND 50`),
    check('commission_waivers_window_check', sql`${t.endsAt} > ${t.startsAt}`),
  ],
);
