import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { primaryId, softDelete, timestamps } from '../columns/common.js';

import { bookings } from './booking.js';
import { users } from './identity.js';

/**
 * The record of what was said (task 17 §17.2, migration 0040). `target_id` is a space id, or a
 * user id for driver / valet / washer — polymorphic, so no FK. The read model search and
 * dispatch read is `rating_avg_bp` / `rating_count` on the target's own table.
 */
export const reviews = pgTable(
  'reviews',
  {
    id: primaryId(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id),
    reviewerUserId: uuid('reviewer_user_id')
      .notNull()
      .references(() => users.id),
    reviewerRole: text('reviewer_role').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    /** Whole stars, 1..5. Basis points exist only in aggregates. */
    rating: smallint('rating').notNull(),
    comment: text('comment'),
    ownerResponse: text('owner_response'),
    ownerRespondedAt: timestamp('owner_responded_at', { withTimezone: true }),
    isReported: boolean('is_reported').notNull().default(false),
    moderationStatus: text('moderation_status').notNull().default('visible'),
    removedByUserId: uuid('removed_by_user_id').references(() => users.id),
    removedReason: text('removed_reason'),
    ...softDelete,
    ...timestamps,
  },
  (t) => [
    uniqueIndex('reviews_one_per_counterparty_per_booking').on(
      t.bookingId,
      t.reviewerUserId,
      t.targetType,
      t.targetId,
    ),
    index('reviews_target_idx').on(t.targetType, t.targetId, t.id),
    index('reviews_reviewer_user_id_idx').on(t.reviewerUserId),
    index('reviews_removed_by_user_id_idx')
      .on(t.removedByUserId)
      .where(sql`${t.removedByUserId} IS NOT NULL`),
    index('reviews_moderation_queue_idx')
      .on(t.id)
      .where(sql`${t.isReported} AND ${t.deletedAt} IS NULL`),
    check('reviews_rating_check', sql`${t.rating} BETWEEN 1 AND 5`),
    check(
      'reviews_comment_length_check',
      sql`${t.comment} IS NULL OR char_length(${t.comment}) <= 500`,
    ),
    check(
      'reviews_owner_response_length_check',
      sql`${t.ownerResponse} IS NULL OR char_length(${t.ownerResponse}) <= 500`,
    ),
    check('reviews_reviewer_role_check', sql`${t.reviewerRole} IN ('driver','owner')`),
    check('reviews_target_type_check', sql`${t.targetType} IN ('space','driver','valet','washer')`),
    check('reviews_moderation_status_check', sql`${t.moderationStatus} IN ('visible','removed')`),
    check(
      'reviews_reviewer_target_check',
      sql`(${t.reviewerRole} = 'owner') = (${t.targetType} = 'driver')`,
    ),
    check(
      'reviews_owner_response_pair_check',
      sql`(${t.ownerResponse} IS NULL) = (${t.ownerRespondedAt} IS NULL)`,
    ),
    check(
      'reviews_removed_consistent_check',
      sql`(${t.moderationStatus} = 'removed') = (${t.deletedAt} IS NOT NULL)`,
    ),
  ],
);

export const reviewReports = pgTable(
  'review_reports',
  {
    id: primaryId(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id),
    reporterUserId: uuid('reporter_user_id')
      .notNull()
      .references(() => users.id),
    reason: text('reason').notNull(),
    detail: text('detail'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('review_reports_one_per_reporter').on(t.reviewId, t.reporterUserId),
    index('review_reports_reporter_user_id_idx').on(t.reporterUserId),
    check(
      'review_reports_reason_check',
      sql`${t.reason} IN ('spam_or_fake','inappropriate','irrelevant','other')`,
    ),
    check(
      'review_reports_detail_length_check',
      sql`${t.detail} IS NULL OR char_length(${t.detail}) <= 500`,
    ),
  ],
);
