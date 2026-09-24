import type { OperatingHours } from '@parkease/contracts/washer';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
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

export const washerProfiles = pgTable(
  'washer_profiles',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * §13.10. A registered outfit and an individual both land here and take the
     * same assignment path; the discriminator says what they must *supply*, not
     * what they become.
     */
    partnerType: text('partner_type').notNull(),
    /**
     * The partner's trading/display name, for BOTH types (ruling T10-C2): a
     * business's business name, a gig partner's own name. It is what a driver
     * sees on the washer card. Nullable in the column only because rows predate
     * the rule; registration always writes it. S-43 renames it `display_name`.
     */
    businessName: text('business_name'),
    gstin: text('gstin'),
    /** Upload ids, never URLs. Files go through POST /uploads (R-VAL-01). */
    businessPhotoIds: text('business_photo_ids').array().notNull().default([]),
    operatingHours: jsonb('operating_hours').$type<OperatingHours>(),
    capabilities: text('capabilities').array().notNull().default([]),
    /**
     * An image an admin looks at. security.md §5.3: the Aadhaar *number* is
     * never collected, and there is deliberately no column that could hold one.
     */
    idDocumentId: text('id_document_id'),
    verificationStatus: text('verification_status').notNull().default('unverified'),
    /**
     * What the partner last chose. On its own it means "willing", not
     * "reachable" — a phone that lost connectivity keeps this true — so the
     * assignment query always pairs it with the `last_seen_at` heartbeat.
     */
    isOnline: boolean('is_online').notNull().default(false),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    currentLocation: geographyPoint('current_location'),
    /** Nullable: NULL means unrated, never zero stars. Task 17 owns the writes. */
    ratingAvgBp: integer('rating_avg_bp'),
    ratingCount: integer('rating_count').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('washer_profiles_user_id_key').on(t.userId),
    // Partial: a partner with no fix can never be a candidate, so indexing those
    // rows adds entries no ST_DWithin can return. Mirrors spaces_active_location_gix.
    index('washer_profiles_current_location_gix')
      .using('gist', t.currentLocation)
      .where(sql`${t.currentLocation} IS NOT NULL`),
    check('washer_profiles_partner_type_check', sql`${t.partnerType} IN ('business','gig')`),
    check(
      'washer_profiles_business_name_check',
      sql`${t.partnerType} <> 'business' OR ${t.businessName} IS NOT NULL`,
    ),
    check(
      'washer_profiles_verification_status_check',
      sql`${t.verificationStatus} IN ('unverified','pending','verified','rejected')`,
    ),
    // Mirrors the spaces rating invariant from task 17: the two columns cannot
    // disagree, so "unrated" is one state rather than two that look alike.
    check(
      'washer_profiles_rating_check',
      sql`(${t.ratingCount} = 0 AND ${t.ratingAvgBp} IS NULL)
          OR (${t.ratingCount} > 0 AND ${t.ratingAvgBp} BETWEEN 10000 AND 50000)`,
    ),
    check('washer_profiles_rating_count_check', sql`${t.ratingCount} >= 0`),
  ],
);

/**
 * A partner's price list: **two rows per service**, one per vehicle type.
 *
 * v1 stored one `price` beside a `vehicle_type` that could be `car`,
 * `two_wheeler` or `BOTH`, and a query for "what does a Premium Wash cost for a
 * bike" against a `BOTH` row needed the caller to know that `BOTH` meant "use
 * this for either" — which no caller did. The unique key below makes `BOTH`
 * unrepresentable rather than merely discouraged.
 */
export const washServices = pgTable(
  'wash_services',
  {
    id: primaryId(),
    washerUserId: uuid('washer_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    serviceName: text('service_name').notNull(),
    vehicleType: text('vehicle_type').notNull(),
    pricePaise: paise('price_paise').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index('wash_services_washer_user_id_idx').on(t.washerUserId),
    // The constraint this table exists for.
    uniqueIndex('wash_services_menu_key').on(t.washerUserId, t.serviceName, t.vehicleType),
    check(
      'wash_services_service_name_check',
      sql`${t.serviceName} IN ('basic_exterior','premium_wash','interior_only','full_detailing','quick_wipe')`,
    ),
    // `> 0`, not `>= 0`. A zero price composes a posting with no rows — leg()
    // drops zero amounts because the ledger CHECK is amount_paise > 0 — and
    // assertEntriesBalance rejects an empty posting, so a free wash is a 500.
    check('wash_services_price_check', sql`${t.pricePaise} > 0`),
    check('wash_services_duration_check', sql`${t.durationMinutes} > 0`),
    check('wash_services_vehicle_type_check', sql`${t.vehicleType} IN ('car','two_wheeler')`),
  ],
);

export const washJobs = pgTable(
  'wash_jobs',
  {
    id: primaryId(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id),
    driverUserId: uuid('driver_user_id')
      .notNull()
      .references(() => users.id),
    washerUserId: uuid('washer_user_id').references(() => users.id),
    status: text('status').notNull().default('requested'),

    /**
     * Denormalised from the menu rather than held by foreign key. A menu row is
     * mutable — a partner can re-price Premium Wash tomorrow — and a settled job
     * that reads its price through an FK is a job whose history changes under it
     * (R-MONEY-03).
     */
    serviceName: text('service_name').notNull(),
    vehicleType: text('vehicle_type').notNull(),
    /** NULL until somebody accepts: no menu has been consulted before that. */
    pricePaise: paise('price_paise'),
    /**
     * Frozen on the row at accept time, so a later rate change cannot restate a
     * settled job (R-MONEY-03). `numeric` rather than a float, because 0.200 is
     * exact and 0.2 as a float is not.
     */
    commissionRate: numeric('commission_rate', { precision: 4, scale: 3 }).notNull(),
    txnId: uuid('txn_id'),

    /** Where the car is. The partner travels to the space, not to the driver. */
    spaceLocation: geographyPoint('space_location').notNull(),

    offerRadiusM: integer('offer_radius_m').notNull().default(3000),
    offerRound: integer('offer_round').notNull().default(0),

    beforePhotoId: text('before_photo_id'),
    afterPhotoId: text('after_photo_id'),

    offeredAt: timestamp('offered_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
    ...timestamps,
  },
  (t) => [
    index('wash_jobs_booking_id_idx').on(t.bookingId),
    index('wash_jobs_driver_user_id_idx').on(t.driverUserId),
    index('wash_jobs_washer_user_id_idx').on(t.washerUserId),
    index('wash_jobs_status_idx').on(t.status),
    // The busy-partner exclusion in the candidate query. Partial, so completed
    // and cancelled jobs never enter it — the cost of asking "are they free"
    // stays proportional to live jobs rather than to a partner's whole career.
    index('wash_jobs_washer_live_idx')
      .on(t.washerUserId)
      .where(sql`${t.status} NOT IN ('completed', 'cancelled')`),
    check(
      'wash_jobs_status_check',
      sql`${t.status} IN (
        'requested','offered','accepted','en_route',
        'washing','completed','cancelled'
      )`,
    ),
    check(
      'wash_jobs_service_name_check',
      sql`${t.serviceName} IN ('basic_exterior','premium_wash','interior_only','full_detailing','quick_wipe')`,
    ),
    check('wash_jobs_vehicle_type_check', sql`${t.vehicleType} IN ('car','two_wheeler')`),
    check('wash_jobs_price_paise_check', sql`${t.pricePaise} IS NULL OR ${t.pricePaise} > 0`),
    check(
      'wash_jobs_commission_rate_check',
      sql`${t.commissionRate} >= 0 AND ${t.commissionRate} <= 1`,
    ),
    check('wash_jobs_offer_round_check', sql`${t.offerRound} >= 0`),
    check('wash_jobs_offer_radius_check', sql`${t.offerRadiusM} > 0`),
    // The candidate query excludes the driver from its own offer set, so a row
    // that violates this means the exclusion was bypassed.
    check(
      'wash_jobs_washer_is_not_driver_check',
      sql`${t.washerUserId} IS NULL OR ${t.washerUserId} <> ${t.driverUserId}`,
    ),
    /**
     * The invariant the conditional UPDATE in `accept-wash.command.ts` leans on:
     * before `accepted` a job has no partner and no price, and from `accepted`
     * to `completed` it has both. The database enforces it because "two
     * partners, one job" is precisely the failure the accept path exists to make
     * unreachable, and the application cannot be trusted with it (R-DB-05).
     *
     * Deliberately *not* named `..._status_check`. `enum-drift.integration.test`
     * finds the wash job status enum by `conname LIKE '%status_check%'` and
     * unions the string literals out of every constraint that matches, so a
     * second constraint mentioning statuses would silently widen what that test
     * believes the enum to be.
     */
    check(
      'wash_jobs_assignee_presence_check',
      sql`(${t.status} IN ('requested','offered')
           AND ${t.washerUserId} IS NULL AND ${t.pricePaise} IS NULL
           AND ${t.txnId} IS NULL)
          OR (${t.status} IN ('accepted','en_route','washing','completed')
              AND ${t.washerUserId} IS NOT NULL AND ${t.pricePaise} IS NOT NULL
              AND ${t.txnId} IS NOT NULL)
          OR ${t.status} = 'cancelled'`,
    ),
    /**
     * §13.8, the row-level half of the photo gates. The command refuses the
     * transition without the photo; this refuses the row without it, so a direct
     * write cannot produce a completed wash with no evidence it happened.
     */
    check(
      'wash_jobs_photo_gate_check',
      sql`(${t.status} <> 'washing'   OR ${t.beforePhotoId} IS NOT NULL)
          AND (${t.status} <> 'completed' OR (${t.beforePhotoId} IS NOT NULL
                                          AND ${t.afterPhotoId} IS NOT NULL))`,
    ),
    /**
     * Migration 0031. One image cannot be evidence of two moments. The other half
     * of 0031 — a photo freezing once its moment has passed — is a trigger
     * (`wash_jobs_evidence_freeze`), because a CHECK cannot see the old row.
     */
    check(
      'wash_jobs_photos_distinct_check',
      sql`${t.afterPhotoId} IS NULL OR ${t.afterPhotoId} <> ${t.beforePhotoId}`,
    ),
  ],
);

/**
 * Who was offered this job, and did they answer.
 *
 * A table rather than an inference from logs, for two reasons: the radius
 * expansion needs "has this partner already seen this job" as a `NOT EXISTS`,
 * and "why did nobody take it" is an operational question somebody will ask.
 */
export const washJobOffers = pgTable(
  'wash_job_offers',
  {
    id: primaryId(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => washJobs.id, { onDelete: 'cascade' }),
    washerUserId: uuid('washer_user_id')
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
     * One offer per partner per job. This is the candidate query's `NOT EXISTS`
     * guard made unbypassable: a later round cannot re-offer to somebody who
     * already saw this job, even if the query is wrong.
     */
    uniqueIndex('wash_job_offers_job_washer_key').on(t.jobId, t.washerUserId),
    index('wash_job_offers_washer_user_id_idx').on(t.washerUserId),
    check(
      'wash_job_offers_outcome_check',
      sql`${t.outcome} IN ('pending','won','lost','declined','expired')`,
    ),
    check('wash_job_offers_distance_check', sql`${t.distanceM} >= 0`),
    check(
      'wash_job_offers_rating_check',
      sql`${t.ratingAtOfferBp} IS NULL OR ${t.ratingAtOfferBp} BETWEEN 10000 AND 50000`,
    ),
  ],
);
