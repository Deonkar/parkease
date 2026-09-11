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

import { paise, primaryId, softDelete, timestamps } from '../columns/common.js';
import { geographyPoint } from '../columns/geography-point.js';

import { users } from './identity.js';

export interface SpaceAmenities {
  covered?: boolean;
  cctv?: boolean;
  ev_charging?: boolean;
  security_guard?: boolean;
  lighting?: boolean;
  wheelchair_accessible?: boolean;
}

export interface SpaceScheduleSlot {
  open: string;
  close: string;
}

export type SpaceSchedule = Record<string, SpaceScheduleSlot | null>;

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
    approvalStatus: text('approval_status').notNull().default('draft'),
    rejectionReason: text('rejection_reason'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedByUserId: uuid('approved_by_user_id').references(() => users.id),
    amenities: jsonb('amenities').$type<SpaceAmenities>().notNull().default({}),
    schedule: jsonb('schedule').$type<SpaceSchedule>().notNull(),
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
      sql`${t.approvalStatus} IN ('draft','pending_review','active','changes_requested','rejected','paused')`,
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
    pricePaiseHourly: paise('price_paise_hourly').notNull(),
    pricePaiseDaily: paise('price_paise_daily'),
    pricePaiseWeekly: paise('price_paise_weekly'),
    pricePaiseMonthly: paise('price_paise_monthly'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('space_slots_space_vehicle_index_key').on(t.spaceId, t.vehicleType, t.slotIndex),
    index('space_slots_space_id_idx').on(t.spaceId),
    check('space_slots_vehicle_type_check', sql`${t.vehicleType} IN ('car','two_wheeler')`),
    check('space_slots_slot_index_check', sql`${t.slotIndex} >= 0`),
    check('space_slots_price_hourly_check', sql`${t.pricePaiseHourly} > 0`),
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
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('space_photos_space_id_idx').on(t.spaceId)],
);
