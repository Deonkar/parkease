import { sql } from 'drizzle-orm';
import { check, index, pgTable, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { primaryId, timestamps } from '../columns/common.js';

import { bookings } from './booking.js';
import { users } from './identity.js';
import { spaces } from './space.js';

export const reviews = pgTable(
  'reviews',
  {
    id: primaryId(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id),
    reviewerUserId: uuid('reviewer_user_id')
      .notNull()
      .references(() => users.id),
    targetUserId: uuid('target_user_id').references(() => users.id),
    rating: smallint('rating').notNull(),
    comment: text('comment'),
    ownerResponse: text('owner_response'),
    isReported: text('is_reported').notNull().default('false'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('reviews_booking_reviewer_key').on(t.bookingId, t.reviewerUserId),
    index('reviews_space_id_idx').on(t.spaceId),
    index('reviews_reviewer_user_id_idx').on(t.reviewerUserId),
    index('reviews_target_user_id_idx').on(t.targetUserId),
    index('reviews_booking_id_idx').on(t.bookingId),
    check('reviews_rating_check', sql`${t.rating} BETWEEN 1 AND 5`),
  ],
);
