import { Inject, Injectable } from '@nestjs/common';
import {
  type BookingStatus,
  type ValetJobEvent,
  type ValetJobStatus,
} from '@parkease/contracts/enums';
import { bookings, spaces, valetJobOffers, valetJobs, valetProfiles } from '@parkease/db/schema';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';

import { DB, type Database } from '../../platform/db/db.module.js';
import type { TxHandle } from '../../platform/db/transaction.js';

import { BookingNotValetEligibleError, ValetAlreadyRequestedError } from './errors.js';
import { assertTransition } from './lifecycle.js';

/**
 * prd.md §7.1: valet requires a confirmed or active booking. `pending_payment`
 * is excluded deliberately — dispatching a valet against an unpaid hold means
 * the expiry job can cancel the booking while a valet is mid-journey.
 */
const VALET_ELIGIBLE_BOOKING_STATUSES: readonly BookingStatus[] = ['confirmed', 'active'];

/** A job in any of these is still somebody's responsibility. */
export const LIVE_VALET_STATUSES: readonly ValetJobStatus[] = [
  'requested',
  'offered',
  'accepted',
  'en_route',
  'arrived',
  'parking',
  'parked',
  'return_requested',
  'returning',
];

const TERMINAL_VALET_STATUSES: readonly ValetJobStatus[] = ['completed', 'cancelled', 'no_show'];

export type ValetJobRow = typeof valetJobs.$inferSelect;
export type ValetParticipantRole = 'driver' | 'valet';

export interface InsertValetJobInput {
  readonly bookingId: string;
  readonly driverUserId: string;
  readonly pickup: { readonly lat: number; readonly lng: number; readonly address: string };
  readonly offerRadiusM: number;
  readonly commissionRate: number;
}

export interface OfferCandidate {
  readonly userId: string;
  readonly distanceM: number;
  readonly ratingAvgBp: number | null;
}

/**
 * Not the same failure as an illegal transition, and deliberately not folded
 * into it: the move was legal, somebody else just got there first. Conflating
 * the two would tell a valet their perfectly valid "arrive" was an illegal move.
 */
export class ConcurrentValetTransitionError extends Error {
  constructor(
    readonly from: ValetJobStatus,
    readonly event: ValetJobEvent,
  ) {
    super(`Valet job moved out of '${from}' before '${event}' could be applied`);
    this.name = 'ConcurrentValetTransitionError';
  }
}

/**
 * Reads and writes over `valet_jobs`, always scoped by a participant.
 *
 * Every lookup here takes the acting user's id and filters on it in SQL rather
 * than reading a row and comparing afterwards. A miss is indistinguishable from
 * "does not exist", which is what lets the controllers answer 404 to a job
 * somebody else owns instead of 403 — a 403 confirms the job is real
 * (R-SEC-04, R-API-08).
 */
@Injectable()
export class ValetService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * The booking a valet is being requested against, if this driver owns it.
   *
   * Returns `undefined` for "no such booking" *and* for "not yours", which is
   * the point: the caller answers 404 to both, so a driver probing booking ids
   * learns nothing about which ones exist (R-SEC-04, R-API-08). Only once
   * ownership is established does eligibility get its own, more specific, 400.
   */
  async findOwnedBooking(
    bookingId: string,
    driverId: string,
  ): Promise<{ id: string; status: BookingStatus } | undefined> {
    const [booking] = await this.db
      .select({ id: bookings.id, status: bookings.status })
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.driverId, driverId)));

    return booking === undefined ? undefined : { id: booking.id, status: booking.status };
  }

  assertBookingIsValetEligible(status: BookingStatus): void {
    if (!VALET_ELIGIBLE_BOOKING_STATUSES.includes(status)) {
      throw new BookingNotValetEligibleError();
    }
  }

  async assertNoLiveJobForBooking(bookingId: string): Promise<void> {
    const [existing] = await this.db
      .select({ id: valetJobs.id })
      .from(valetJobs)
      .where(
        and(
          eq(valetJobs.bookingId, bookingId),
          inArray(valetJobs.status, [...LIVE_VALET_STATUSES]),
        ),
      )
      .limit(1);

    if (existing !== undefined) throw new ValetAlreadyRequestedError();
  }

  async findById(jobId: string): Promise<ValetJobRow | undefined> {
    const [job] = await this.db.select().from(valetJobs).where(eq(valetJobs.id, jobId));
    return job;
  }

  async findOwnedByDriver(jobId: string, driverId: string): Promise<ValetJobRow | undefined> {
    const [job] = await this.db
      .select()
      .from(valetJobs)
      .where(and(eq(valetJobs.id, jobId), eq(valetJobs.driverUserId, driverId)));
    return job;
  }

  async findAssignedTo(jobId: string, valetUserId: string): Promise<ValetJobRow | undefined> {
    const [job] = await this.db
      .select()
      .from(valetJobs)
      .where(and(eq(valetJobs.id, jobId), eq(valetJobs.assignedUserId, valetUserId)));
    return job;
  }

  /** The one live job a valet is on, or undefined. */
  async findActiveForValet(valetUserId: string): Promise<ValetJobRow | undefined> {
    const [job] = await this.db
      .select()
      .from(valetJobs)
      .where(
        and(
          eq(valetJobs.assignedUserId, valetUserId),
          notInArray(valetJobs.status, [...TERMINAL_VALET_STATUSES]),
        ),
      )
      .limit(1);
    return job;
  }

  /**
   * Which side of this job the user is on, or null for neither.
   *
   * The socket gateway's authorisation turns on this and nothing else: `job:{id}`
   * is a guessable channel carrying a live vehicle position, and security.md
   * §5.3 makes that visible to the assigned driver and the assigned valet, and
   * to nobody else — not to a valet who lost the race for this job.
   */
  async participantRole(jobId: string, userId: string): Promise<ValetParticipantRole | null> {
    const [job] = await this.db
      .select({ driverUserId: valetJobs.driverUserId, assignedUserId: valetJobs.assignedUserId })
      .from(valetJobs)
      .where(eq(valetJobs.id, jobId));

    if (job === undefined) return null;
    if (job.driverUserId === userId) return 'driver';
    if (job.assignedUserId === userId) return 'valet';
    return null;
  }

  async insert(tx: TxHandle, input: InsertValetJobInput): Promise<ValetJobRow> {
    const [job] = await tx
      .insert(valetJobs)
      .values({
        bookingId: input.bookingId,
        driverUserId: input.driverUserId,
        status: 'requested',
        // Composed in SQL from the request body's numbers. The column is
        // geography, so it is never round-tripped through a JS { lng, lat }.
        pickupLocation: { lng: input.pickup.lng, lat: input.pickup.lat },
        pickupAddress: input.pickup.address,
        offerRadiusM: input.offerRadiusM,
        offerRound: 0,
        commissionRate: input.commissionRate.toFixed(3),
      })
      .returning();

    // RETURNING on a single-row INSERT cannot come back empty; if it ever does,
    // the caller must not proceed on an undefined row (R-FAIL-01).
    if (job === undefined) {
      throw new Error('Inserting a valet job returned no row');
    }
    return job;
  }

  /**
   * The only way a status is written in this domain.
   *
   * `assertTransition` decides the next status; the caller supplies the columns
   * that move with it. A caller cannot pass `status` itself — the machine owns
   * that field, and letting a patch override it is exactly how a state machine
   * becomes decoration.
   */
  async applyEvent(
    tx: TxHandle,
    job: Pick<ValetJobRow, 'id' | 'status'>,
    event: ValetJobEvent,
    patch: Partial<Omit<typeof valetJobs.$inferInsert, 'id' | 'status'>> = {},
  ): Promise<ValetJobRow> {
    const next = assertTransition(job.status as ValetJobStatus, event);

    const [updated] = await tx
      .update(valetJobs)
      .set({ ...patch, status: next, updatedAt: new Date() })
      .where(and(eq(valetJobs.id, job.id), eq(valetJobs.status, job.status)))
      .returning();

    // The WHERE pinned the status we transitioned *from*. Matching nothing means
    // somebody else moved this job between our read and our write, so the status
    // we just computed was derived from a stale row (R-FAIL-01: a typed failure,
    // never a silent zero-row update).
    if (updated === undefined) {
      throw new ConcurrentValetTransitionError(job.status as ValetJobStatus, event);
    }

    return updated;
  }

  async recordOffers(
    tx: TxHandle,
    jobId: string,
    round: number,
    candidates: readonly OfferCandidate[],
  ): Promise<void> {
    if (candidates.length === 0) return;

    await tx.insert(valetJobOffers).values(
      candidates.map((candidate) => ({
        jobId,
        valetUserId: candidate.userId,
        distanceM: Math.round(candidate.distanceM),
        ratingAtOfferBp: candidate.ratingAvgBp,
        offerRound: round,
      })),
    );
  }

  async findOfferFor(
    jobId: string,
    valetUserId: string,
  ): Promise<{ id: string; outcome: string } | undefined> {
    const [offer] = await this.db
      .select({ id: valetJobOffers.id, outcome: valetJobOffers.outcome })
      .from(valetJobOffers)
      .where(and(eq(valetJobOffers.jobId, jobId), eq(valetJobOffers.valetUserId, valetUserId)));
    return offer;
  }

  /** One `won`, the rest `lost`, in two statements rather than N. */
  async resolveOffers(tx: TxHandle, jobId: string, winnerUserId: string): Promise<void> {
    const respondedAt = new Date();

    await tx
      .update(valetJobOffers)
      .set({ outcome: 'won', respondedAt, updatedAt: respondedAt })
      .where(
        and(
          eq(valetJobOffers.jobId, jobId),
          eq(valetJobOffers.valetUserId, winnerUserId),
          eq(valetJobOffers.outcome, 'pending'),
        ),
      );

    await tx
      .update(valetJobOffers)
      .set({ outcome: 'lost', respondedAt, updatedAt: respondedAt })
      .where(
        and(
          eq(valetJobOffers.jobId, jobId),
          eq(valetJobOffers.outcome, 'pending'),
          sql`${valetJobOffers.valetUserId} <> ${winnerUserId}`,
        ),
      );
  }

  /**
   * Straight-line distance from the booked space to a point, in metres, computed
   * by PostGIS on the geography type.
   *
   * Never haversine in JS, and never from destructured coordinates: a geography
   * column does not hand a raw driver read a `{ lng, lat }`, which is how v1
   * built `POINT(undefined undefined)` and searched from the null island
   * (ADR-004, R-DB-07).
   */
  async distanceFromSpaceToPoint(
    bookingId: string,
    point: { readonly lat: number; readonly lng: number },
  ): Promise<number> {
    const rows = await this.db.execute<{ distance_m: number }>(sql`
      SELECT ST_Distance(
               s.location,
               ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography
             ) AS distance_m
      FROM ${bookings} b
      JOIN ${spaces} s ON s.id = b.space_id
      WHERE b.id = ${bookingId}
    `);

    const distance = rows[0]?.distance_m;
    if (distance === undefined) {
      throw new Error(`No space found for booking ${bookingId}; cannot price a valet leg`);
    }
    return Number(distance);
  }

  async isOnlineVerifiedValet(valetUserId: string): Promise<boolean> {
    const [profile] = await this.db
      .select({ verificationStatus: valetProfiles.verificationStatus })
      .from(valetProfiles)
      .where(eq(valetProfiles.userId, valetUserId));
    return profile?.verificationStatus === 'verified';
  }
}
