import { Inject, Injectable } from '@nestjs/common';
import type { ApprovalStatus, BookingStatus } from '@parkease/contracts/enums';
import { spaceScheduleSchema } from '@parkease/contracts/owner';
import { bookingSlots, bookings, spaceSlots, spaces } from '@parkease/db/schema';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { parseOutgoing } from '../../../platform/http/outgoing-contract.js';
import type { Reader } from '../../ledger/queries/owner-balance.js';
import { openHoursWithin } from '../schedule.js';
// Reader lives with the first query that needed it (R2) — a redeclaration here
// would be a second copy of the same shape drifting from the original.

/**
 * Booking status, not slot status: completion and cancellation both set the
 * slot `released`, so filtering on the slot would lose every finished booking
 * (spec §2). Cancelled, expired and no-show never occupied anything.
 */
const OCCUPYING: BookingStatus[] = ['confirmed', 'active', 'completed'];

/**
 * Booked slot-hours ÷ (slots × open hours in the window), in basis points, for every space the
 * owner has, in one statement. Open hours are the window intersected with the space's own schedule
 * (S-82): a space that closes overnight and is booked for every hour it is open reads 10,000 bp.
 */
@Injectable()
export class SpaceOccupancyQuery {
  constructor(@Inject(DB) private readonly db: Database) {}

  async forOwner(ownerId: string, window: { from: Date; to: Date }, reader: Reader = this.db) {
    const from = sql`${window.from.toISOString()}::timestamptz`;
    const to = sql`${window.to.toISOString()}::timestamptz`;

    // Scoped to the owner's own spaces INSIDE the subquery, not just by the
    // outer join: a completed booking's slot is `released`, outside the
    // partial GiST index, so an unscoped `&&` falls back to a platform-wide
    // scan of `booking_slots` instead of using `booking_slots_space_id_idx` /
    // `space_slots_space_id_idx`. Behaviour is unchanged — narrowing before
    // the aggregate cannot add or drop a row the outer join wouldn't already
    // have dropped.
    const slotCounts = reader
      .select({ spaceId: spaceSlots.spaceId, slots: sql<number>`count(*)::int`.as('slots') })
      .from(spaceSlots)
      .innerJoin(spaces, eq(spaces.id, spaceSlots.spaceId))
      .where(and(eq(spaces.ownerId, ownerId), isNull(spaces.deletedAt)))
      .groupBy(spaceSlots.spaceId)
      .as('slot_counts');

    const booked = reader
      .select({
        spaceId: bookingSlots.spaceId,
        hours: sql<string>`sum(extract(epoch from
          least(upper(${bookingSlots.period}), ${to}) - greatest(lower(${bookingSlots.period}), ${from})
        ) / 3600)::text`.as('hours'),
      })
      .from(bookingSlots)
      .innerJoin(bookings, eq(bookings.id, bookingSlots.bookingId))
      .innerJoin(spaces, eq(spaces.id, bookingSlots.spaceId))
      .where(
        and(
          eq(spaces.ownerId, ownerId),
          isNull(spaces.deletedAt),
          inArray(bookings.status, OCCUPYING),
          sql`${bookingSlots.period} && tstzrange(${from}, ${to}, '[)')`,
        ),
      )
      .groupBy(bookingSlots.spaceId)
      .as('booked');

    const rows = await reader
      .select({
        id: spaces.id,
        title: spaces.title,
        approvalStatus: spaces.approvalStatus,
        schedule: spaces.schedule,
        slots: slotCounts.slots,
        hours: booked.hours,
      })
      .from(spaces)
      .leftJoin(slotCounts, eq(slotCounts.spaceId, spaces.id))
      .leftJoin(booked, eq(booked.spaceId, spaces.id))
      .where(and(eq(spaces.ownerId, ownerId), isNull(spaces.deletedAt)))
      .orderBy(asc(spaces.createdAt));

    return rows.map((row) => {
      const openHours = openHoursWithin(
        parseOutgoing(spaceScheduleSchema, row.schedule, 'space schedule'),
        window.from,
        window.to,
      );
      // Drizzle types a LEFT-JOINed aliased subquery's own columns as
      // non-nullable — it only marks the whole-row object nullable, and that
      // form isn't usable here (subquery-as-field requires exactly one
      // selected column; both `slotCounts` and `booked` select two). At
      // runtime a space with no slots or no bookings in the window genuinely
      // joins to SQL NULL, so the fallback is load-bearing despite the rule.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      const available = (row.slots ?? 0) * openHours;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      const bookedHours = Number(row.hours ?? 0);
      return {
        id: row.id,
        title: row.title,
        // `approvalStatus` is TEXT + CHECK (spaces_approval_status_check), not
        // `$type<ApprovalStatus>()` on the column — DB-guaranteed narrowing,
        // not a cast on outside data (R-VAL-01 is about the process boundary).
        approvalStatus: row.approvalStatus as ApprovalStatus,
        occupancyBp: available > 0 ? Math.round((bookedHours / available) * 10_000) : 0,
      };
    });
  }
}
