import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { paise, primaryId, softDelete, timestamps } from '../columns/common.js';
import { tstzRange } from '../columns/tstz-range.js';

import { users } from './identity.js';
import { spaces } from './space.js';

export const bookings = pgTable(
  'bookings',
  {
    id: primaryId(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => users.id),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id),
    vehicleType: text('vehicle_type').notNull(),
    vehicleNumber: text('vehicle_number'),
    durationType: text('duration_type').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('pending_payment'),

    basePaise: paise('base_paise').notNull(),
    surgePremiumPaise: paise('surge_premium_paise').notNull().default(0),
    surgeMultiplierBp: integer('surge_multiplier_bp').notNull().default(10_000),
    parkeaseFeePaise: paise('parkease_fee_paise').notNull(),
    gstPaise: paise('gst_paise').notNull(),
    totalPaise: paise('total_paise').notNull(),
    ownerEarningsPaise: paise('owner_earnings_paise').notNull(),

    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index('bookings_driver_id_idx').on(t.driverId),
    index('bookings_space_id_idx').on(t.spaceId),
    index('bookings_status_starts_at_idx').on(t.status, t.startsAt),
    check('bookings_window_check', sql`${t.endsAt} > ${t.startsAt}`),
    check('bookings_total_check', sql`${t.totalPaise} > 0`),
    check(
      'bookings_balance_check',
      sql`${t.totalPaise} = ${t.basePaise} + ${t.surgePremiumPaise} + ${t.gstPaise}`,
    ),
    check(
      'bookings_status_check',
      sql`${t.status} IN ('pending_payment','confirmed','active','completed','cancelled','expired','no_show')`,
    ),
    check('bookings_vehicle_type_check', sql`${t.vehicleType} IN ('car','two_wheeler')`),
    check(
      'bookings_duration_type_check',
      sql`${t.durationType} IN ('hourly','daily','weekly','monthly')`,
    ),
  ],
);

export const bookingSlots = pgTable(
  'booking_slots',
  {
    id: primaryId(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id),
    vehicleType: text('vehicle_type').notNull(),
    slotIndex: integer('slot_index').notNull(),
    period: tstzRange('period').notNull(),
    status: text('status').notNull().default('held'),
    ...timestamps,
  },
  (t) => [
    index('booking_slots_booking_id_idx').on(t.bookingId),
    index('booking_slots_space_id_idx').on(t.spaceId),
    check(
      'booking_slots_status_check',
      sql`${t.status} IN ('held','confirmed','active','released')`,
    ),
    check('booking_slots_vehicle_type_check', sql`${t.vehicleType} IN ('car','two_wheeler')`),
  ],
);
