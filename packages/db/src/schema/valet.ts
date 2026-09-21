import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { paise, primaryId, timestamps } from '../columns/common.js';
import { geographyPoint } from '../columns/geography-point.js';

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
    licenceExpiresAt: timestamp('licence_expires_at', { withTimezone: true }),
    backgroundCheckStatus: text('background_check_status').notNull().default('pending'),
    verificationStatus: text('verification_status').notNull().default('unverified'),
    /**
     * What the valet last chose. On its own it means "willing", not
     * "reachable" — a phone that lost connectivity keeps this true — so the
     * assignment query always pairs it with the `last_seen_at` heartbeat.
     */
    isOnline: boolean('is_online').notNull().default(false),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    currentLocation: geographyPoint('current_location'),
    vehicleMake: text('vehicle_make'),
    vehicleNumber: text('vehicle_number'),
    /** Nullable: NULL means unrated, never zero stars. Task 17 owns the writes. */
    ratingAvgBp: integer('rating_avg_bp'),
    ratingCount: integer('rating_count').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('valet_profiles_user_id_key').on(t.userId),
    // Partial: a valet with no fix can never be a candidate, so indexing those
    // rows adds entries no ST_DWithin can return. Mirrors spaces_active_location_gix.
    index('valet_profiles_current_location_gix')
      .using('gist', t.currentLocation)
      .where(sql`${t.currentLocation} IS NOT NULL`),
    check(
      'valet_profiles_verification_status_check',
      sql`${t.verificationStatus} IN ('unverified','pending','verified','rejected')`,
    ),
    check(
      'valet_profiles_background_check_status_check',
      sql`${t.backgroundCheckStatus} IN ('pending','passed','failed')`,
    ),
    // Mirrors the spaces rating invariant from task 17: the two columns cannot
    // disagree, so "unrated" is one state rather than two that look alike.
    check(
      'valet_profiles_rating_check',
      sql`(${t.ratingCount} = 0 AND ${t.ratingAvgBp} IS NULL)
          OR (${t.ratingCount} > 0 AND ${t.ratingAvgBp} BETWEEN 10000 AND 50000)`,
    ),
    check('valet_profiles_rating_count_check', sql`${t.ratingCount} >= 0`),
  ],
);

export const valetJobs = pgTable(
  'valet_jobs',
  {
    id: primaryId(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id),
    driverUserId: uuid('driver_user_id')
      .notNull()
      .references(() => users.id),
    assignedUserId: uuid('assigned_user_id').references(() => users.id),
    status: text('status').notNull().default('requested'),

    pickupLocation: geographyPoint('pickup_location').notNull(),
    pickupAddress: text('pickup_address').notNull(),

    offeredAt: timestamp('offered_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    arrivedAt: timestamp('arrived_at', { withTimezone: true }),
    parkedAt: timestamp('parked_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),

    offerRadiusM: integer('offer_radius_m').notNull().default(5000),
    offerRound: integer('offer_round').notNull().default(0),

    distanceM: integer('distance_m'),
    feePaise: paise('fee_paise'),
    /**
     * Frozen on the row at accept time, so a later rate change cannot restate a
     * settled job (R-MONEY-03). `numeric` rather than a float, because 0.200 is
     * exact and 0.2 as a float is not.
     */
    commissionRate: numeric('commission_rate', { precision: 4, scale: 3 }).notNull(),
    txnId: uuid('txn_id'),

    returnRequestedAt: timestamp('return_requested_at', { withTimezone: true }),
    returnDistanceM: integer('return_distance_m'),
    returnFeePaise: paise('return_fee_paise'),
    returnTxnId: uuid('return_txn_id'),
    returnDropLocation: geographyPoint('return_drop_location'),

    proofPhotoId: text('proof_photo_id'),
    cancellationReason: text('cancellation_reason'),
    ...timestamps,
  },
  (t) => [
    index('valet_jobs_booking_id_idx').on(t.bookingId),
    index('valet_jobs_driver_user_id_idx').on(t.driverUserId),
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
    check('valet_jobs_fee_paise_check', sql`${t.feePaise} IS NULL OR ${t.feePaise} >= 0`),
    check(
      'valet_jobs_return_fee_paise_check',
      sql`${t.returnFeePaise} IS NULL OR ${t.returnFeePaise} >= 0`,
    ),
    check(
      'valet_jobs_distance_check',
      sql`(${t.distanceM} IS NULL OR ${t.distanceM} >= 0)
          AND (${t.returnDistanceM} IS NULL OR ${t.returnDistanceM} >= 0)`,
    ),
    check(
      'valet_jobs_commission_rate_check',
      sql`${t.commissionRate} >= 0 AND ${t.commissionRate} <= 1`,
    ),
    check('valet_jobs_offer_round_check', sql`${t.offerRound} >= 0`),
    check('valet_jobs_offer_radius_check', sql`${t.offerRadiusM} > 0`),
    // The candidate query excludes the driver from its own offer set, so a row
    // that violates this means the exclusion was bypassed.
    check(
      'valet_jobs_assignee_is_not_driver_check',
      sql`${t.assignedUserId} IS NULL OR ${t.assignedUserId} <> ${t.driverUserId}`,
    ),
    /**
     * The invariant the conditional UPDATE in `accept-job.command.ts` leans on:
     * before `accepted` a job has no assignee, and from `accepted` to
     * `completed` it has one. The database enforces it because the application
     * cannot be trusted with it (R-DB-05) — and because "two valets, one job"
     * is precisely the failure this task exists to make unreachable.
     *
     * `cancelled` and `no_show` are unconstrained: either can be reached from a
     * state with an assignee or from one without.
     *
     * Deliberately *not* named `..._status_check`. `enum-drift.integration.test`
     * finds the valet job status enum by `conname LIKE '%status_check%'` and
     * unions the string literals out of every constraint that matches, so a
     * second constraint mentioning statuses would silently widen what that test
     * believes the enum to be.
     */
    check(
      'valet_jobs_assignee_presence_check',
      sql`(${t.status} IN ('requested','offered') AND ${t.assignedUserId} IS NULL)
          OR (${t.status} IN ('accepted','en_route','arrived','parking','parked',
                              'return_requested','returning','completed')
              AND ${t.assignedUserId} IS NOT NULL)
          OR ${t.status} IN ('cancelled','no_show')`,
    ),
  ],
);

/**
 * Who was offered this job, and did they answer.
 *
 * A table rather than an inference from logs, for two reasons: the radius
 * expansion needs "has this valet already seen this job" as a `NOT EXISTS`, and
 * "why did nobody take it" is an operational question somebody will ask.
 */
export const valetJobOffers = pgTable(
  'valet_job_offers',
  {
    id: primaryId(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => valetJobs.id, { onDelete: 'cascade' }),
    valetUserId: uuid('valet_user_id')
      .notNull()
      .references(() => users.id),
    distanceM: integer('distance_m').notNull(),
    /** The rating as it stood when the offer went out. NULL means unrated. */
    ratingAtOfferBp: integer('rating_at_offer_bp'),
    offerRound: integer('offer_round').notNull().default(0),
    offeredAt: timestamp('offered_at', { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    outcome: text('outcome').notNull().default('pending'),
    ...timestamps,
  },
  (t) => [
    /**
     * One offer per valet per job. This is the candidate query's `NOT EXISTS`
     * guard made unbypassable: a later round cannot re-offer to someone who
     * already saw this job, even if the query is wrong.
     */
    uniqueIndex('valet_job_offers_job_valet_key').on(t.jobId, t.valetUserId),
    index('valet_job_offers_job_id_idx').on(t.jobId),
    index('valet_job_offers_valet_user_id_idx').on(t.valetUserId),
    check(
      'valet_job_offers_outcome_check',
      sql`${t.outcome} IN ('pending','won','lost','declined','expired')`,
    ),
    check('valet_job_offers_distance_check', sql`${t.distanceM} >= 0`),
    check(
      'valet_job_offers_rating_check',
      sql`${t.ratingAtOfferBp} IS NULL OR ${t.ratingAtOfferBp} BETWEEN 10000 AND 50000`,
    ),
  ],
);
