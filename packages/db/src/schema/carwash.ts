import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { paise, primaryId, timestamps } from '../columns/common.js';

import { bookings } from './booking.js';
import { users } from './identity.js';

export const washerProfiles = pgTable(
  'washer_profiles',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    verificationStatus: text('verification_status').notNull().default('unverified'),
    isAvailable: text('is_available').notNull().default('false'),
    ...timestamps,
  },
  (t) => [
    index('washer_profiles_user_id_idx').on(t.userId),
    check(
      'washer_profiles_verification_status_check',
      sql`${t.verificationStatus} IN ('unverified','pending','verified','rejected')`,
    ),
  ],
);

export const washServices = pgTable(
  'wash_services',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    pricePaise: paise('price_paise').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    vehicleType: text('vehicle_type').notNull(),
    isActive: text('is_active').notNull().default('true'),
    ...timestamps,
  },
  (t) => [
    index('wash_services_user_id_idx').on(t.userId),
    check('wash_services_price_check', sql`${t.pricePaise} > 0`),
    check('wash_services_duration_check', sql`${t.durationMinutes} > 0`),
    check('wash_services_vehicle_type_check', sql`${t.vehicleType} IN ('car','two_wheeler')`),
  ],
);

export const washJobs = pgTable(
  'wash_jobs',
  {
    id: primaryId(),
    bookingId: uuid('booking_id').references(() => bookings.id),
    washServiceId: uuid('wash_service_id')
      .notNull()
      .references(() => washServices.id),
    assignedUserId: uuid('assigned_user_id').references(() => users.id),
    driverUserId: uuid('driver_user_id')
      .notNull()
      .references(() => users.id),
    status: text('status').notNull().default('requested'),
    feePaise: paise('fee_paise'),
    beforePhotoId: text('before_photo_id'),
    afterPhotoId: text('after_photo_id'),
    offeredAt: timestamp('offered_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('wash_jobs_booking_id_idx').on(t.bookingId),
    index('wash_jobs_wash_service_id_idx').on(t.washServiceId),
    index('wash_jobs_assigned_user_id_idx').on(t.assignedUserId),
    index('wash_jobs_driver_user_id_idx').on(t.driverUserId),
    index('wash_jobs_status_idx').on(t.status),
    check(
      'wash_jobs_status_check',
      sql`${t.status} IN (
        'requested','offered','accepted','en_route',
        'washing','completed','cancelled'
      )`,
    ),
  ],
);
