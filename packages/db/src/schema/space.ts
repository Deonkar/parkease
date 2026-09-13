import type { Amenity } from '@parkease/contracts/enums';
import type { SpacePricing } from '@parkease/contracts/owner';
import type { SpaceSchedule } from '@parkease/contracts/owner';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { primaryId, softDelete, timestamps } from '../columns/common.js';
import { geographyPoint } from '../columns/geography-point.js';

import { users } from './identity.js';

export const spaces = pgTable(
  'spaces',
  {
    id: primaryId(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    description: text('description'),
    addressLine: text('address_line').notNull(),
    landmark: text('landmark'),
    city: text('city').notNull(),
    state: text('state').notNull(),
    pincode: text('pincode').notNull(),
    location: geographyPoint('location').notNull(),
    zoneId: text('zone_id').notNull(),
    pricing: jsonb('pricing').$type<SpacePricing>().notNull(),
    schedule: jsonb('schedule').$type<SpaceSchedule>().notNull(),
    amenities: jsonb('amenities').$type<Amenity[]>().notNull().default([]),
    accessInstructions: text('access_instructions'),
    approvalStatus: text('approval_status').notNull().default('pending_approval'),
    rejectionReason: text('rejection_reason'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedByUserId: uuid('approved_by_user_id').references(() => users.id),
    ratingAvgBp: integer('rating_avg_bp'),
    ratingCount: integer('rating_count').notNull().default(0),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index('spaces_owner_id_idx').on(t.ownerId),
    index('spaces_approved_by_user_id_idx').on(t.approvedByUserId),
    index('spaces_zone_id_idx').on(t.zoneId),
    index('spaces_approval_status_idx').on(t.approvalStatus),
    check(
      'spaces_approval_status_check',
      sql`${t.approvalStatus} IN ('pending_approval','changes_requested','rejected','active','inactive')`,
    ),
    check('spaces_pincode_check', sql`${t.pincode} ~ '^[1-9][0-9]{5}$'`),
  ],
);

export const spaceSlots = pgTable(
  'space_slots',
  {
    id: primaryId(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    vehicleType: text('vehicle_type').notNull(),
    slotIndex: integer('slot_index').notNull(),
    label: text('label'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('space_slots_space_vehicle_index_key').on(t.spaceId, t.vehicleType, t.slotIndex),
    index('space_slots_space_id_idx').on(t.spaceId),
    check('space_slots_vehicle_type_check', sql`${t.vehicleType} IN ('car','two_wheeler')`),
    check('space_slots_slot_index_check', sql`${t.slotIndex} >= 0`),
  ],
);

export const spacePhotos = pgTable(
  'space_photos',
  {
    id: primaryId(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    cloudinaryPublicId: text('cloudinary_public_id').notNull(),
    url: text('url').notNull(),
    format: text('format').notNull(),
    bytes: integer('bytes').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    displayOrder: integer('display_order').notNull().default(0),
    isPrimary: boolean('is_primary').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('space_photos_order_uq').on(t.spaceId, t.displayOrder),
    uniqueIndex('space_photos_primary_uq')
      .on(t.spaceId)
      .where(sql`${t.isPrimary}`),
    index('space_photos_space_id_idx').on(t.spaceId),
  ],
);
