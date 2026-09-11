import { sql } from 'drizzle-orm';
import { bigint, timestamp, uuid } from 'drizzle-orm/pg-core';

export const primaryId = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const softDelete = {
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
};

export const paise = (name: string) => bigint(name, { mode: 'number' });
