import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { BookingFilter, ListBookingsQuery } from '@parkease/contracts/driver';
import type {
  BookingStatus,
  CheckInMethod,
  DurationType,
  VehicleType,
} from '@parkease/contracts/enums';
import type { Quote } from '@parkease/contracts/money';
import { bookings, bookingSlots, spaces, users } from '@parkease/db/schema';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { DB, type Database } from '../../platform/db/db.module.js';
import type { TxHandle } from '../../platform/db/transaction.js';

export interface InsertBookingInput {
  readonly driverId: string;
  readonly spaceId: string;
  readonly vehicleType: VehicleType;
  readonly durationType: DurationType;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly vehicleNumber: string | null;
  readonly status: BookingStatus;
  readonly quote: Quote;
}

/** Statuses a driver reads as still ahead of them, regardless of the clock. */
const LIVE_STATUSES: readonly BookingStatus[] = ['pending_payment', 'confirmed', 'active'];
const SETTLED_STATUSES: readonly BookingStatus[] = ['completed', 'cancelled', 'expired', 'no_show'];

/**
 * A keyset cursor over `(starts_at, id)`. It carries the filter it was issued
 * under: replaying an `upcoming` cursor against `past` reverses the sort and
 * would silently skip or repeat rows. Untrusted input, so it is parsed through a
 * schema rather than cast (R-VAL-01).
 */
const cursorPayloadSchema = z.object({
  f: z.string(),
  t: z.string().datetime(),
  i: z.string().uuid(),
});

interface BookingCursor {
  readonly startsAt: Date;
  readonly id: string;
}

const encodeCursor = (filter: BookingFilter, row: { startsAt: Date; id: string }): string =>
  Buffer.from(
    JSON.stringify({ f: filter, t: row.startsAt.toISOString(), i: row.id }),
    'utf8',
  ).toString('base64url');

function decodeCursor(raw: string, filter: BookingFilter): BookingCursor | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    // Malformed base64url or JSON. A typed failure, not a swallowed error.
    return undefined;
  }

  const payload = cursorPayloadSchema.safeParse(parsed);
  if (!payload.success || payload.data.f !== filter) return undefined;

  return { startsAt: new Date(payload.data.t), id: payload.data.i };
}

@Injectable()
export class BookingService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * The quote is written whole: base, surge premium, fee, GST, total and the
   * owner's share all land in the same row, so the price the driver agreed to is
   * recoverable from the booking alone and does not depend on replaying the rate
   * card (ADR-008). `bookings_balance_check` re-asserts the arithmetic in the
   * database.
   */
  async insert(tx: TxHandle, input: InsertBookingInput) {
    const [row] = await tx
      .insert(bookings)
      .values({
        driverId: input.driverId,
        spaceId: input.spaceId,
        vehicleType: input.vehicleType,
        vehicleNumber: input.vehicleNumber,
        durationType: input.durationType,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        status: input.status,
        basePaise: input.quote.basePaise,
        surgePremiumPaise: input.quote.surgePremiumPaise,
        surgeMultiplierBp: input.quote.surgeMultiplierBp,
        parkeaseFeePaise: input.quote.parkeaseFeePaise,
        gstPaise: input.quote.gstPaise,
        totalPaise: input.quote.driverTotalPaise,
        ownerEarningsPaise: input.quote.ownerEarningsPaise,
      })
      .returning();

    if (row === undefined) throw new Error('Booking insert returned no row');
    return row;
  }

  /**
   * Ownership is resolved per resource, and a miss is indistinguishable from a
   * missing row: the caller turns `undefined` into a 404, never a 403, so the
   * API does not confirm that someone else's booking exists (R-SEC-04, R-API-08).
   */
  async findOwnedByDriver(bookingId: string, driverId: string) {
    const [row] = await this.db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.id, bookingId),
          eq(bookings.driverId, driverId),
          isNull(bookings.deletedAt),
        ),
      );
    return row;
  }

  /** Joins through `spaces.owner_id`: an owner reaches only their own spaces. */
  async findOnSpaceOwnedBy(bookingId: string, ownerId: string) {
    const [row] = await this.db
      .select({ booking: bookings })
      .from(bookings)
      .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
      .where(
        and(eq(bookings.id, bookingId), eq(spaces.ownerId, ownerId), isNull(bookings.deletedAt)),
      );
    return row?.booking;
  }

  /**
   * Row-locked read for the worker. Two deliveries of the same job would
   * otherwise both read `pending_payment` and both try to cancel.
   */
  async findForUpdate(tx: TxHandle, bookingId: string) {
    const [row] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for('update');
    return row;
  }

  async findWithSpace(bookingId: string) {
    const [row] = await this.db
      .select({
        booking: bookings,
        space: spaces,
        slotIndex: bookingSlots.slotIndex,
      })
      .from(bookings)
      .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
      .leftJoin(bookingSlots, eq(bookingSlots.bookingId, bookings.id))
      .where(eq(bookings.id, bookingId));
    return row;
  }

  async findDriver(driverId: string) {
    const [row] = await this.db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, driverId));
    return row;
  }

  /**
   * Keyset pagination over `(starts_at, id)`. `upcoming` reads soonest-first
   * because that is the booking the driver is about to use; everything else reads
   * newest-first.
   */
  async listForDriver(driverId: string, query: ListBookingsQuery) {
    const ascending = query.filter === 'upcoming';

    const conditions = [eq(bookings.driverId, driverId), isNull(bookings.deletedAt)];

    if (query.filter === 'upcoming') conditions.push(inArray(bookings.status, LIVE_STATUSES));
    if (query.filter === 'past') conditions.push(inArray(bookings.status, SETTLED_STATUSES));
    if (query.status !== undefined) conditions.push(eq(bookings.status, query.status));

    if (query.cursor !== undefined) {
      const cursor = decodeCursor(query.cursor, query.filter);
      if (cursor === undefined) {
        throw new BadRequestException({
          error: 'INVALID_CURSOR',
          message: 'That page link is no longer valid. Pull to refresh.',
        });
      }
      // Compare on the whole tuple, so rows sharing a start time still page
      // deterministically instead of repeating or vanishing at the boundary.
      // Written as one SQL row comparison rather than an or(); `or()` is typed
      // as possibly-undefined and the non-null assertion needed to use it is
      // exactly the kind of "I know better" the lint rule is there to stop.
      conditions.push(
        ascending
          ? sql`(${bookings.startsAt}, ${bookings.id}) > (${cursor.startsAt}, ${cursor.id})`
          : sql`(${bookings.startsAt}, ${bookings.id}) < (${cursor.startsAt}, ${cursor.id})`,
      );
    }

    const rows = await this.db
      .select({ booking: bookings, space: spaces, slotIndex: bookingSlots.slotIndex })
      .from(bookings)
      .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
      .leftJoin(bookingSlots, eq(bookingSlots.bookingId, bookings.id))
      .where(and(...conditions))
      .orderBy(
        ascending ? asc(bookings.startsAt) : desc(bookings.startsAt),
        ascending ? asc(bookings.id) : desc(bookings.id),
      )
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const last = items.at(-1);

    return {
      items,
      hasMore,
      nextCursor: hasMore && last !== undefined ? encodeCursor(query.filter, last.booking) : null,
    };
  }

  async markStatus(tx: TxHandle, bookingId: string, status: BookingStatus) {
    const [row] = await tx
      .update(bookings)
      .set({ status, updatedAt: new Date() })
      .where(eq(bookings.id, bookingId))
      .returning();
    return row;
  }

  async markCancelled(
    tx: TxHandle,
    bookingId: string,
    status: BookingStatus,
    reason: string | null,
  ) {
    const [row] = await tx
      .update(bookings)
      .set({
        status,
        cancelledAt: new Date(),
        cancellationReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, bookingId))
      .returning();
    return row;
  }

  /**
   * `checked_in_at` and `check_in_method` are written together — the database
   * insists on it via `bookings_check_in_method_present_check`, so a future code
   * path cannot record the fact without recording the evidence.
   */
  async markCheckedIn(
    tx: TxHandle,
    bookingId: string,
    status: BookingStatus,
    method: CheckInMethod,
    at: Date,
  ) {
    const [row] = await tx
      .update(bookings)
      .set({ status, checkedInAt: at, checkInMethod: method, updatedAt: new Date() })
      .where(eq(bookings.id, bookingId))
      .returning();
    return row;
  }

  async markCompleted(tx: TxHandle, bookingId: string, status: BookingStatus, at: Date) {
    const [row] = await tx
      .update(bookings)
      .set({ status, completedAt: at, updatedAt: new Date() })
      .where(eq(bookings.id, bookingId))
      .returning();
    return row;
  }

  /**
   * An extension adds to every money column rather than replacing it, so the
   * booking's total always reflects everything the driver has agreed to pay, and
   * `bookings_balance_check` keeps holding.
   */
  async applyExtension(tx: TxHandle, bookingId: string, newEndsAt: Date, delta: Quote) {
    const [row] = await tx
      .update(bookings)
      .set({
        endsAt: newEndsAt,
        basePaise: sql`${bookings.basePaise} + ${delta.basePaise}`,
        surgePremiumPaise: sql`${bookings.surgePremiumPaise} + ${delta.surgePremiumPaise}`,
        parkeaseFeePaise: sql`${bookings.parkeaseFeePaise} + ${delta.parkeaseFeePaise}`,
        gstPaise: sql`${bookings.gstPaise} + ${delta.gstPaise}`,
        totalPaise: sql`${bookings.totalPaise} + ${delta.driverTotalPaise}`,
        ownerEarningsPaise: sql`${bookings.ownerEarningsPaise} + ${delta.ownerEarningsPaise}`,
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, bookingId))
      .returning();
    return row;
  }
}
