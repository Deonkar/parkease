import { Inject, Injectable } from '@nestjs/common';
import type { WasherCard } from '@parkease/contracts/driver';
import { washerCardSchema } from '@parkease/contracts/driver';
import type {
  BookingStatus,
  CarwashJobEvent,
  CarwashJobStatus,
  CarwashServiceName,
  VehicleType,
} from '@parkease/contracts/enums';
import {
  LIVE_CARWASH_STATUSES,
  PHOTO_SLOT_OPEN_STATUSES,
  type WasherProfileView,
  washerProfileViewSchema,
} from '@parkease/contracts/washer';
import {
  bookings,
  spaces,
  users,
  washerProfiles,
  washJobOffers,
  washJobs,
  washServices,
} from '@parkease/db/schema';
import { and, asc, count, eq, inArray, notInArray, sql } from 'drizzle-orm';

import { DB, type Database } from '../../platform/db/db.module.js';
import type { TxHandle } from '../../platform/db/transaction.js';

import {
  BookingNotWashEligibleError,
  PhotoSlotClosedError,
  WashAlreadyRequestedError,
  WasherProfileNotFoundError,
} from './errors.js';
import { assertTransition, parseCarwashJobStatus } from './lifecycle.js';

/**
 * §13. The car must be physically parked, and `active` is the only status that
 * means that.
 *
 * `confirmed` is excluded deliberately and is the v1 bug this task exists to
 * not repeat: a wash for a car that has not arrived is a charge that must be
 * refunded and a partner dispatched to an empty bay.
 */
const WASH_ELIGIBLE_BOOKING_STATUSES: readonly BookingStatus[] = ['active'];

const TERMINAL_CARWASH_STATUSES: readonly CarwashJobStatus[] = ['completed', 'cancelled'];

export type WashJobRow = typeof washJobs.$inferSelect;
export type WashParticipantRole = 'driver' | 'washer';

export interface InsertWashJobInput {
  readonly bookingId: string;
  readonly driverUserId: string;
  readonly serviceName: CarwashServiceName;
  readonly vehicleType: VehicleType;
  readonly offerRadiusM: number;
  readonly commissionRate: number;
}

export interface WashOfferCandidate {
  readonly userId: string;
  readonly distanceM: number;
  readonly ratingAvgBp: number | null;
  /** This partner's own price for the requested service. Each candidate differs. */
  readonly pricePaise: number;
  readonly durationMinutes: number;
}

/**
 * Not the same failure as an illegal transition, and deliberately not folded
 * into it: the move was legal, somebody else just got there first. Conflating
 * the two would tell a partner their perfectly valid "start washing" was an
 * illegal move.
 */
export class ConcurrentWashTransitionError extends Error {
  constructor(
    readonly from: CarwashJobStatus,
    readonly event: CarwashJobEvent,
  ) {
    super(`Car wash job moved out of '${from}' before '${event}' could be applied`);
    this.name = 'ConcurrentWashTransitionError';
  }
}

/**
 * Reads and writes over `wash_jobs`, always scoped by a participant.
 *
 * Every lookup here takes the acting user's id and filters on it in SQL rather
 * than reading a row and comparing afterwards. A miss is indistinguishable from
 * "does not exist", which is what lets the controllers answer 404 to a job
 * somebody else owns instead of 403 — a 403 confirms the job is real
 * (R-SEC-04, R-API-08).
 */
@Injectable()
export class CarwashService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * The booking a wash is being requested against, if this driver owns it.
   *
   * Returns `undefined` for "no such booking" *and* for "not yours", which is
   * the point: the caller answers 404 to both, so a driver probing booking ids
   * learns nothing about which ones exist. Only once ownership is established
   * does eligibility get its own, more specific, 400.
   */
  async findOwnedBooking(
    bookingId: string,
    driverId: string,
  ): Promise<{ id: string; spaceId: string; status: BookingStatus } | undefined> {
    const [booking] = await this.db
      .select({ id: bookings.id, spaceId: bookings.spaceId, status: bookings.status })
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.driverId, driverId)));

    return booking;
  }

  assertBookingIsWashEligible(status: BookingStatus): void {
    if (!WASH_ELIGIBLE_BOOKING_STATUSES.includes(status)) {
      throw new BookingNotWashEligibleError();
    }
  }

  /**
   * One live wash per booking *per service*.
   *
   * Scoped to the service rather than the booking as a whole, because a driver
   * who wants an interior clean and an exterior wash is asking for two
   * different jobs that two different partners could take. What is refused is
   * ordering the same wash twice.
   */
  async assertNoLiveWashForBooking(
    bookingId: string,
    serviceName: CarwashServiceName,
  ): Promise<void> {
    const [existing] = await this.db
      .select({ id: washJobs.id })
      .from(washJobs)
      .where(
        and(
          eq(washJobs.bookingId, bookingId),
          eq(washJobs.serviceName, serviceName),
          inArray(washJobs.status, [...LIVE_CARWASH_STATUSES]),
        ),
      )
      .limit(1);

    if (existing !== undefined) throw new WashAlreadyRequestedError();
  }

  async findById(jobId: string): Promise<WashJobRow | undefined> {
    const [job] = await this.db.select().from(washJobs).where(eq(washJobs.id, jobId));
    return job;
  }

  async findOwnedByDriver(jobId: string, driverId: string): Promise<WashJobRow | undefined> {
    const [job] = await this.db
      .select()
      .from(washJobs)
      .where(and(eq(washJobs.id, jobId), eq(washJobs.driverUserId, driverId)));
    return job;
  }

  async findAssignedTo(jobId: string, washerUserId: string): Promise<WashJobRow | undefined> {
    const [job] = await this.db
      .select()
      .from(washJobs)
      .where(and(eq(washJobs.id, jobId), eq(washJobs.washerUserId, washerUserId)));
    return job;
  }

  /** The one live job a partner is on, or undefined. */
  async findActiveForWasher(washerUserId: string): Promise<WashJobRow | undefined> {
    const [job] = await this.db
      .select()
      .from(washJobs)
      .where(
        and(
          eq(washJobs.washerUserId, washerUserId),
          notInArray(washJobs.status, [...TERMINAL_CARWASH_STATUSES]),
        ),
      )
      .limit(1);
    return job;
  }

  /**
   * Where the car is, as a geography expression rather than as coordinates.
   *
   * Returned as SQL and never destructured: a geography column hands a raw
   * driver read WKB hex, so `.lng` would be `undefined` and the insert would
   * store `POINT(undefined undefined)` — the v1 valet bug, off the coast of
   * Africa (ADR-004, R-DB-07).
   */
  spaceLocationOf(bookingId: string) {
    return sql`(SELECT s.location FROM ${bookings} b JOIN ${spaces} s ON s.id = b.space_id WHERE b.id = ${bookingId})`;
  }

  async insert(tx: TxHandle, input: InsertWashJobInput): Promise<WashJobRow> {
    const [job] = await tx
      .insert(washJobs)
      .values({
        bookingId: input.bookingId,
        driverUserId: input.driverUserId,
        status: 'requested',
        serviceName: input.serviceName,
        vehicleType: input.vehicleType,
        // Composed in SQL from the booked space's own column, never round
        // -tripped through a JS { lng, lat }.
        spaceLocation: this.spaceLocationOf(input.bookingId),
        offerRadiusM: input.offerRadiusM,
        offerRound: 0,
        commissionRate: input.commissionRate.toFixed(3),
      })
      .returning();

    // RETURNING on a single-row INSERT cannot come back empty; if it ever does,
    // the caller must not proceed on an undefined row (R-FAIL-01).
    if (job === undefined) {
      throw new Error('Inserting a car wash job returned no row');
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
    job: Pick<WashJobRow, 'id' | 'status'>,
    event: CarwashJobEvent,
    patch: Partial<Omit<typeof washJobs.$inferInsert, 'id' | 'status'>> = {},
  ): Promise<WashJobRow> {
    const next = assertTransition(parseCarwashJobStatus(job.status), event);

    const [updated] = await tx
      .update(washJobs)
      .set({ ...patch, status: next, updatedAt: new Date() })
      .where(and(eq(washJobs.id, job.id), eq(washJobs.status, job.status)))
      .returning();

    // The WHERE pinned the status we transitioned *from*. Matching nothing
    // means somebody else moved this job between our read and our write, so the
    // status we just computed was derived from a stale row (R-FAIL-01: a typed
    // failure, never a silent zero-row update).
    if (updated === undefined) {
      throw new ConcurrentWashTransitionError(parseCarwashJobStatus(job.status), event);
    }

    return updated;
  }

  /**
   * How many partners were asked. Not who — that is nobody's business but ours,
   * and a driver who could enumerate the partners near them has a map of our
   * supply.
   */
  async countOffers(jobId: string): Promise<number> {
    const [row] = await this.db
      .select({ offers: count() })
      .from(washJobOffers)
      .where(eq(washJobOffers.jobId, jobId));
    return row?.offers ?? 0;
  }

  async recordOffers(
    tx: TxHandle,
    jobId: string,
    round: number,
    candidates: readonly WashOfferCandidate[],
  ): Promise<void> {
    if (candidates.length === 0) return;

    await tx.insert(washJobOffers).values(
      candidates.map((candidate) => ({
        jobId,
        washerUserId: candidate.userId,
        distanceM: Math.round(candidate.distanceM),
        ratingAtOfferBp: candidate.ratingAvgBp,
        offerRound: round,
      })),
    );
  }

  /**
   * Open offers for this partner, nearest first.
   *
   * Scoped to jobs still in `offered`: an offer row whose job was taken,
   * widened past it, or cancelled is history, not a card the app should render.
   * The outcome column alone is not enough — the losers of a race are marked
   * `lost` in the same transaction, but a job that simply moved on has offers
   * that are still `pending`.
   */
  async findOpenOffersFor(
    washerUserId: string,
  ): Promise<{ job: WashJobRow; distanceM: number; offeredAt: Date; pricePaise: number }[]> {
    /**
     * Joined to the partner's *own* menu row, because the card shows their
     * earnings and the job carries no price until somebody accepts. Three
     * partners looking at this job may each be quoting a different number, so
     * there is no job-level figure that would be right for more than one of
     * them.
     *
     * An inner join, so an offer whose menu row was deactivated after it went
     * out simply stops being listed — which is the same answer accept gives.
     */
    return this.db
      .select({
        job: washJobs,
        distanceM: washJobOffers.distanceM,
        offeredAt: washJobOffers.offeredAt,
        pricePaise: washServices.pricePaise,
      })
      .from(washJobOffers)
      .innerJoin(washJobs, eq(washJobs.id, washJobOffers.jobId))
      .innerJoin(
        washServices,
        and(
          eq(washServices.washerUserId, washJobOffers.washerUserId),
          eq(washServices.serviceName, washJobs.serviceName),
          eq(washServices.vehicleType, washJobs.vehicleType),
          eq(washServices.isActive, true),
        ),
      )
      .where(
        and(
          eq(washJobOffers.washerUserId, washerUserId),
          eq(washJobOffers.outcome, 'pending'),
          eq(washJobs.status, 'offered'),
        ),
      )
      .orderBy(asc(washJobOffers.distanceM));
  }

  async findOfferFor(
    jobId: string,
    washerUserId: string,
  ): Promise<{ id: string; outcome: string } | undefined> {
    const [offer] = await this.db
      .select({ id: washJobOffers.id, outcome: washJobOffers.outcome })
      .from(washJobOffers)
      .where(and(eq(washJobOffers.jobId, jobId), eq(washJobOffers.washerUserId, washerUserId)));
    return offer;
  }

  /** One `won`, the rest `lost`, in two statements rather than N. */
  async resolveOffers(tx: TxHandle, jobId: string, winnerUserId: string): Promise<void> {
    const respondedAt = new Date();

    await tx
      .update(washJobOffers)
      .set({ outcome: 'won', respondedAt, updatedAt: respondedAt })
      .where(
        and(
          eq(washJobOffers.jobId, jobId),
          eq(washJobOffers.washerUserId, winnerUserId),
          eq(washJobOffers.outcome, 'pending'),
        ),
      );

    await tx
      .update(washJobOffers)
      .set({ outcome: 'lost', respondedAt, updatedAt: respondedAt })
      .where(
        and(
          eq(washJobOffers.jobId, jobId),
          eq(washJobOffers.outcome, 'pending'),
          sql`${washJobOffers.washerUserId} <> ${winnerUserId}`,
        ),
      );
  }

  /**
   * Attaches a before or after photo without moving the job.
   *
   * Separate from the status change because the upload is the slow,
   * failure-prone half on a phone outdoors: a partner who uploads and then
   * loses signal should not have to upload again to retry the transition.
   *
   * The status condition sits in the same UPDATE as the ownership one, so
   * there is no read-then-write window in which the job can move between the
   * check and the write (T7-S1). The DB's photo-gate CHECK only requires the
   * photos to exist at completion; this is what makes them stop changing.
   *
   * `undefined` means "not this partner's job" and becomes a 404 — never a
   * 409 that would confirm the job exists (R-SEC-04). Only the owner learns
   * that the slot is closed.
   */
  async attachPhoto(
    jobId: string,
    washerUserId: string,
    slot: 'before' | 'after',
    photoId: string,
  ): Promise<WashJobRow | undefined> {
    const mine = and(eq(washJobs.id, jobId), eq(washJobs.washerUserId, washerUserId));

    const [updated] = await this.db
      .update(washJobs)
      .set({
        ...(slot === 'before' ? { beforePhotoId: photoId } : { afterPhotoId: photoId }),
        updatedAt: new Date(),
      })
      .where(and(mine, inArray(washJobs.status, [...PHOTO_SLOT_OPEN_STATUSES[slot]])))
      .returning();
    if (updated !== undefined) return updated;

    // Nothing written: say why, without saying more than the caller may know.
    const [owned] = await this.db.select({ id: washJobs.id }).from(washJobs).where(mine);
    if (owned === undefined) return undefined;
    throw new PhotoSlotClosedError();
  }

  /**
   * The assigned partner, as a driver is allowed to see them.
   *
   * Selects columns explicitly rather than the whole row, because `users` holds
   * a phone number and a `SELECT *` here is one careless spread away from
   * putting it in a response (security.md §5.3).
   *
   * The name is the one the partner registered under (ruling T10-C2):
   * `business_name` holds a gig partner's own name too, and nothing writes
   * `users.name`. Both null means a row made outside registration, and the
   * card's parse refuses it loudly rather than showing a blank partner.
   */
  async washerCard(washerUserId: string): Promise<WasherCard | null> {
    const [row] = await this.db
      .select({
        userId: washerProfiles.userId,
        name: sql<string | null>`coalesce(${washerProfiles.businessName}, ${users.name})`,
        partnerType: washerProfiles.partnerType,
        businessName: washerProfiles.businessName,
        ratingAvgBp: washerProfiles.ratingAvgBp,
        ratingCount: washerProfiles.ratingCount,
      })
      .from(washerProfiles)
      .innerJoin(users, eq(users.id, washerProfiles.userId))
      .where(eq(washerProfiles.userId, washerUserId));

    return row === undefined ? null : washerCardSchema.parse(row);
  }

  async profileFor(washerUserId: string): Promise<WasherProfileView | null> {
    const [row] = await this.db
      .select()
      .from(washerProfiles)
      .where(eq(washerProfiles.userId, washerUserId));

    return row === undefined ? null : toProfileView(row);
  }

  /**
   * Submitting documents moves verification back to `pending` and takes the
   * partner offline.
   *
   * Offline is the part worth stating: re-submitting while online would leave a
   * partner in the candidate pool on the strength of the document they are
   * replacing — which is exactly the window a rejected document is re-submitted
   * in.
   */
  async submitDocuments(
    washerUserId: string,
    input: { idDocumentId: string; businessPhotoIds?: string[] },
  ): Promise<WasherProfileView> {
    const [row] = await this.db
      .update(washerProfiles)
      .set({
        idDocumentId: input.idDocumentId,
        verificationStatus: 'pending',
        isOnline: false,
        ...(input.businessPhotoIds === undefined
          ? {}
          : { businessPhotoIds: input.businessPhotoIds }),
        updatedAt: new Date(),
      })
      .where(eq(washerProfiles.userId, washerUserId))
      .returning();

    if (row === undefined) throw new WasherProfileNotFoundError();
    return toProfileView(row);
  }

  async isVerifiedWasher(washerUserId: string): Promise<boolean> {
    const [profile] = await this.db
      .select({ verificationStatus: washerProfiles.verificationStatus })
      .from(washerProfiles)
      .where(eq(washerProfiles.userId, washerUserId));
    return profile?.verificationStatus === 'verified';
  }
}

const toProfileView = (row: typeof washerProfiles.$inferSelect): WasherProfileView =>
  washerProfileViewSchema.parse({
    partnerType: row.partnerType,
    businessName: row.businessName,
    gstin: row.gstin,
    businessPhotoIds: row.businessPhotoIds,
    operatingHours: row.operatingHours ?? null,
    capabilities: row.capabilities,
    idDocumentId: row.idDocumentId,
    verificationStatus: row.verificationStatus,
    isOnline: row.isOnline,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    ratingAvgBp: row.ratingAvgBp,
    ratingCount: row.ratingCount,
  });
