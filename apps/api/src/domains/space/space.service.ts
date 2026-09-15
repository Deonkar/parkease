import { Inject, Injectable } from '@nestjs/common';
import { spaces, spaceSlots, spacePhotos, users } from '@parkease/db/schema';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { DB, type Database } from '../../platform/db/db.module.js';

@Injectable()
export class SpaceService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async findOwnedBy(spaceId: string, ownerId: string) {
    const [space] = await this.db
      .select()
      .from(spaces)
      .where(and(eq(spaces.id, spaceId), eq(spaces.ownerId, ownerId), isNull(spaces.deletedAt)));
    return space;
  }

  /**
   * A space a driver may book right now: approved, switched on, not deleted, and
   * with at least one slot of the vehicle type they asked for.
   *
   * The slot check is what makes "this space takes cars" a fact rather than an
   * assumption — `AvailabilityService.allocate` would otherwise find no candidate
   * index and report SLOT_UNAVAILABLE, which reads to the driver as "someone beat
   * you to it" when the truth is the space has no car slots at all.
   *
   * Deliberately narrower than the read path: prd.md §8 honours bookings made
   * before a space was deactivated, so this gate is only on *new* bookings.
   */
  async findBookable(spaceId: string, vehicleType: 'car' | 'two_wheeler') {
    const [space] = await this.db
      .select()
      .from(spaces)
      .where(
        and(
          eq(spaces.id, spaceId),
          eq(spaces.approvalStatus, 'active'),
          isNull(spaces.deletedAt),
          sql`EXISTS (
            SELECT 1 FROM space_slots ss
            WHERE ss.space_id = ${spaces.id} AND ss.vehicle_type = ${vehicleType}
          )`,
        ),
      );
    return space;
  }

  /**
   * A space as a driver sees it, with the owner joined for the trust line.
   *
   * Approved and not deleted, but `inactive` is allowed through: a driver
   * arriving from an existing booking must still be able to read the space they
   * booked (prd.md §8). The narrower `findBookable` gate is what stops a *new*
   * booking.
   */
  async findForDriver(spaceId: string) {
    const [row] = await this.db
      .select({ space: spaces, ownerName: users.name, ownerSince: users.createdAt })
      .from(spaces)
      .innerJoin(users, eq(users.id, spaces.ownerId))
      .where(
        and(
          eq(spaces.id, spaceId),
          inArray(spaces.approvalStatus, ['active', 'inactive']),
          isNull(spaces.deletedAt),
        ),
      );
    return row;
  }

  /**
   * Slots with nothing occupying them at `at`, per vehicle type.
   *
   * Counted live against `booking_slots`, never cached (ADR-010): a stale
   * availability number sends a driver to a space that has just been taken,
   * which is the one thing discovery must not do. The predicate mirrors the
   * exclusion constraint's, so this count and what `allocate` will actually find
   * cannot disagree.
   */
  async availabilityAt(spaceId: string, at: Date) {
    const rows = await this.db.execute<{ vehicle_type: string; free: number }>(sql`
      SELECT ss.vehicle_type, count(*)::int AS free
      FROM space_slots ss
      WHERE ss.space_id = ${spaceId}
        AND NOT EXISTS (
          SELECT 1 FROM booking_slots bs
          WHERE bs.space_id     = ss.space_id
            AND bs.vehicle_type = ss.vehicle_type
            AND bs.slot_index   = ss.slot_index
            AND bs.status IN ('confirmed', 'active')
            AND bs.period @> ${at.toISOString()}::timestamptz
        )
      GROUP BY ss.vehicle_type
    `);

    const free = { car: 0, twoWheeler: 0 };
    for (const row of rows) {
      if (row.vehicle_type === 'car') free.car = row.free;
      else if (row.vehicle_type === 'two_wheeler') free.twoWheeler = row.free;
    }
    return free;
  }

  async listByOwner(ownerId: string, opts: { page: number; limit: number }) {
    const offset = (opts.page - 1) * opts.limit;

    const [items, [countRow]] = await Promise.all([
      this.db
        .select()
        .from(spaces)
        .where(and(eq(spaces.ownerId, ownerId), isNull(spaces.deletedAt)))
        .orderBy(desc(spaces.createdAt))
        .limit(opts.limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(spaces)
        .where(and(eq(spaces.ownerId, ownerId), isNull(spaces.deletedAt))),
    ]);

    const total = countRow?.count ?? 0;
    return {
      items,
      meta: {
        page: opts.page,
        limit: opts.limit,
        total,
        totalPages: Math.ceil(total / opts.limit),
      },
    };
  }

  async getSlots(spaceId: string) {
    return this.db.select().from(spaceSlots).where(eq(spaceSlots.spaceId, spaceId));
  }

  async listPhotos(spaceId: string) {
    return this.db
      .select()
      .from(spacePhotos)
      .where(eq(spacePhotos.spaceId, spaceId))
      .orderBy(spacePhotos.displayOrder);
  }

  async loadRelated(spaceId: string) {
    const [slots, photos] = await Promise.all([this.getSlots(spaceId), this.listPhotos(spaceId)]);
    return { slots, photos };
  }
}
