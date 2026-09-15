import { Injectable } from '@nestjs/common';
import type { SlotStatus, VehicleType } from '@parkease/contracts/enums';
import { bookingSlots } from '@parkease/db/schema';
import { eq, sql } from 'drizzle-orm';

import { PG_EXCLUSION_VIOLATION, isPgError, pgConstraintName } from '../../platform/db/errors.js';
import type { TxHandle } from '../../platform/db/transaction.js';
import { logger } from '../../platform/observability/logger.js';

import { ExtensionConflictError, SlotUnavailableError } from './errors.js';

export interface AllocateSlotInput {
  readonly bookingId: string;
  readonly spaceId: string;
  readonly vehicleType: VehicleType;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** The statuses inside `booking_slots_no_overlap`'s WHERE predicate. */
const OCCUPYING: readonly SlotStatus[] = ['confirmed', 'active'];

@Injectable()
export class AvailabilityService {
  /**
   * Allocates the lowest free `slot_index` for the window and records occupancy.
   *
   * The SELECT chooses *which* index to try. It does not make the write safe —
   * `booking_slots_no_overlap` does. Two racers can both pick index 0; the loser
   * gets 23P01 and a 409. There is no advisory lock, no SELECT FOR UPDATE and no
   * retry loop, by decision (ADR-007).
   *
   * The honest cost: with three slots, a driver who loses the race on index 0
   * gets a 409 even though index 1 was free. That is accepted — a lost race is
   * rare, the failure is instant and clearly worded, and "try again" is a new
   * intent with a fresh Idempotency-Key that allocates the next free index.
   */
  async allocate(tx: TxHandle, input: AllocateSlotInput): Promise<number> {
    const period = sql`tstzrange(${input.startsAt.toISOString()}::timestamptz, ${input.endsAt.toISOString()}::timestamptz, '[)')`;

    const candidates = await tx.execute<{ slot_index: number }>(sql`
      SELECT ss.slot_index
      FROM space_slots ss
      WHERE ss.space_id = ${input.spaceId}
        AND ss.vehicle_type = ${input.vehicleType}
        AND NOT EXISTS (
          SELECT 1
          FROM booking_slots bs
          WHERE bs.space_id     = ss.space_id
            AND bs.vehicle_type = ss.vehicle_type
            AND bs.slot_index   = ss.slot_index
            AND bs.status IN ('confirmed', 'active')
            AND bs.period && ${period}
        )
      ORDER BY ss.slot_index
      LIMIT 1
    `);

    const candidate = candidates[0];
    if (candidate === undefined) throw new SlotUnavailableError();

    try {
      await tx.insert(bookingSlots).values({
        bookingId: input.bookingId,
        spaceId: input.spaceId,
        vehicleType: input.vehicleType,
        slotIndex: candidate.slot_index,
        period,
        status: 'confirmed',
      });
    } catch (error) {
      // The constraint fired: someone took this exact slot-instance for an
      // overlapping window between our SELECT and our INSERT. The log line
      // carries the SQLSTATE and the constraint; the driver sees neither.
      if (isPgError(error, PG_EXCLUSION_VIOLATION)) {
        logger.info(
          {
            pgCode: PG_EXCLUSION_VIOLATION,
            constraint: pgConstraintName(error),
            spaceId: input.spaceId,
            slotIndex: candidate.slot_index,
          },
          'lost the race for a slot',
        );
        throw new SlotUnavailableError();
      }
      throw error;
    }

    return candidate.slot_index;
  }

  /**
   * A booking holds exactly one slot row, so the extension mutates that range in
   * place — and is therefore subject to the same exclusion constraint as the
   * original insert. Nothing here checks whether the later window is free; the
   * database answers that.
   */
  async extend(tx: TxHandle, bookingId: string, newEndsAt: Date): Promise<void> {
    try {
      const moved = await tx
        .update(bookingSlots)
        .set({
          period: sql`tstzrange(lower(${bookingSlots.period}), ${newEndsAt.toISOString()}::timestamptz, '[)')`,
          updatedAt: new Date(),
        })
        .where(eq(bookingSlots.bookingId, bookingId))
        .returning({ id: bookingSlots.id });

      // An UPDATE that matches nothing is a successful no-op in SQL, and here
      // that would be the worst outcome available: the booking's `ends_at`
      // moves, the occupancy row does not, and the space is now sold for a
      // window its own exclusion constraint no longer guards. Fail the
      // transaction instead of committing half an extension (R-FAIL-01).
      if (moved.length !== 1) {
        throw new Error(
          `Extension touched ${String(moved.length)} occupancy rows for booking ${bookingId}; expected exactly 1`,
        );
      }
    } catch (error) {
      if (isPgError(error, PG_EXCLUSION_VIOLATION)) {
        logger.info(
          { pgCode: PG_EXCLUSION_VIOLATION, constraint: pgConstraintName(error), bookingId },
          'extension collided with the next booking',
        );
        throw new ExtensionConflictError();
      }
      throw error;
    }
  }

  /**
   * Releasing is a status change, not a delete: the row drops out of the
   * constraint's WHERE predicate and the slot_index becomes allocatable for that
   * window the instant the transaction commits. No cleanup sweep, no tombstones,
   * and the occupancy history survives for disputes.
   */
  async release(tx: TxHandle, bookingId: string): Promise<void> {
    await this.setSlotStatus(tx, bookingId, 'released');
  }

  async setSlotStatus(tx: TxHandle, bookingId: string, status: SlotStatus): Promise<void> {
    await tx
      .update(bookingSlots)
      .set({ status, updatedAt: new Date() })
      .where(eq(bookingSlots.bookingId, bookingId));
  }

  /** True while the booking still occupies its slot. Mirrors the DB predicate. */
  static occupies(status: SlotStatus): boolean {
    return OCCUPYING.includes(status);
  }
}
