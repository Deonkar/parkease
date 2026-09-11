import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { paise, primaryId, timestamps } from '../columns/common.js';

import { bookings } from './booking.js';
import { users } from './identity.js';

export const valetProfiles = pgTable(
  'valet_profiles',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    licenceDocumentId: text('licence_document_id'),
    verificationStatus: text('verification_status').notNull().default('unverified'),
    isAvailable: text('is_available').notNull().default('false'),
    ...timestamps,
  },
  (t) => [
    index('valet_profiles_user_id_idx').on(t.userId),
    check(
      'valet_profiles_verification_status_check',
      sql`${t.verificationStatus} IN ('unverified','pending','verified','rejected')`,
    ),
  ],
);

export const valetJobs = pgTable(
  'valet_jobs',
  {
    id: primaryId(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id),
    assignedUserId: uuid('assigned_user_id').references(() => users.id),
    status: text('status').notNull().default('requested'),
    feePaise: paise('fee_paise'),
    distanceM: integer('distance_m'),
    pickupPhotoId: text('pickup_photo_id'),
    dropoffPhotoId: text('dropoff_photo_id'),
    offeredAt: timestamp('offered_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('valet_jobs_booking_id_idx').on(t.bookingId),
    index('valet_jobs_assigned_user_id_idx').on(t.assignedUserId),
    index('valet_jobs_status_idx').on(t.status),
    check(
      'valet_jobs_status_check',
      sql`${t.status} IN (
        'requested','offered','accepted','en_route','arrived',
        'parking','parked','return_requested','returning',
        'completed','cancelled','no_show'
      )`,
    ),
  ],
);
