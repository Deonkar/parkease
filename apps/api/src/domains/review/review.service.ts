import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { ReviewReportReason, ReviewTargetType } from '@parkease/contracts/enums';
import {
  bookings,
  reviewReports,
  reviews,
  spaces,
  users,
  valetJobs,
  washJobs,
} from '@parkease/db/schema';
import { and, count, desc, eq, inArray, isNull, lt, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';

import { DB, type Database } from '../../platform/db/db.module.js';
import type { TxHandle } from '../../platform/db/transaction.js';

import { type Participants, REVIEW_WINDOW_MS } from './eligibility.js';

export type ReviewRecord = typeof reviews.$inferSelect;

/** A review and the name of whoever wrote it. The view formats the name; the domain does not. */
export interface ReviewRow {
  readonly review: ReviewRecord;
  readonly reviewerName: string | null;
}

export interface Page<T> {
  readonly items: T[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

export interface PageQuery {
  readonly limit: number;
  readonly cursor?: string | undefined;
}

export type StarCounts = Record<1 | 2 | 3 | 4 | 5, number>;

export interface Summary {
  readonly ratingAvgBp: number | null;
  readonly ratingCount: number;
  readonly distribution: StarCounts;
}

export interface OwnerSpaceSummary {
  readonly spaceId: string;
  readonly spaceTitle: string;
  readonly ratingAvgBp: number | null;
  ratingCount: number;
  readonly distribution: StarCounts;
  reportedCount: number;
}

export interface PendingBooking {
  readonly participants: Participants;
  readonly reviewed: ReadonlySet<string>;
}

export interface QueueItem {
  readonly review: ReviewRecord;
  readonly reports: { reason: ReviewReportReason; detail: string | null; createdAt: Date }[];
}

const cursorSchema = z.string().uuid();
const reportReasonSchema = z.enum(['spam_or_fake', 'inappropriate', 'irrelevant', 'other']);

const emptyCounts = (): StarCounts => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });

/** Visible to the public: not removed. A reported review stays visible until an admin acts. */
const visible = (): SQL =>
  and(eq(reviews.moderationStatus, 'visible'), isNull(reviews.deletedAt)) as SQL;

/**
 * Reads, ownership-scoped (task 17 §17.6, §17.8). Writes are the commands'.
 *
 * Lists page on `id` alone, newest first: ids are UUIDv7, so id order is creation order, and a
 * uuid cursor sidesteps both traps a timestamp cursor has here (learnings: an untyped `Date`
 * bind, and microseconds that a JS `Date` cannot carry).
 */
@Injectable()
export class ReviewService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** The booking and everyone on it who can be reviewed, or undefined for no such booking. */
  async participantsOf(bookingId: string): Promise<Participants | undefined> {
    const [booking] = await this.db
      .select({
        id: bookings.id,
        status: bookings.status,
        completedAt: bookings.completedAt,
        driverId: bookings.driverId,
        spaceId: bookings.spaceId,
        spaceTitle: spaces.title,
        ownerId: spaces.ownerId,
      })
      .from(bookings)
      .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
      .where(and(eq(bookings.id, bookingId), isNull(bookings.deletedAt)));
    if (booking === undefined) return undefined;

    const [valets, washers] = await Promise.all([
      this.db
        .selectDistinct({ userId: users.id, name: users.name })
        .from(valetJobs)
        .innerJoin(users, eq(users.id, valetJobs.assignedUserId))
        .where(and(eq(valetJobs.bookingId, bookingId), eq(valetJobs.status, 'completed'))),
      this.db
        .selectDistinct({ userId: users.id, name: users.name })
        .from(washJobs)
        .innerJoin(users, eq(users.id, washJobs.washerUserId))
        .where(and(eq(washJobs.bookingId, bookingId), eq(washJobs.status, 'completed'))),
    ]);

    return { booking, valets, washers };
  }

  async insert(tx: TxHandle, row: typeof reviews.$inferInsert): Promise<ReviewRecord> {
    const [inserted] = await tx.insert(reviews).values(row).returning();
    if (inserted === undefined) throw new Error('review insert returned no row');
    return inserted;
  }

  async nameOf(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, userId));
    return row?.name ?? null;
  }

  /** A review that has not been removed, or undefined. */
  async findVisible(id: string): Promise<ReviewRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(reviews)
      .where(and(eq(reviews.id, id), visible()));
    return row;
  }

  /** The review, if it is about a space this owner owns. */
  async findOnOwnersSpace(id: string, ownerId: string): Promise<ReviewRecord | undefined> {
    const [row] = await this.db
      .select({ review: reviews })
      .from(reviews)
      .innerJoin(spaces, and(eq(reviews.targetType, 'space'), eq(spaces.id, reviews.targetId)))
      .where(and(eq(reviews.id, id), eq(spaces.ownerId, ownerId), visible()));
    return row?.review;
  }

  async findForUpdate(tx: TxHandle, id: string): Promise<ReviewRecord | undefined> {
    const [row] = await tx.select().from(reviews).where(eq(reviews.id, id)).for('update');
    return row;
  }

  listForTarget(targetType: ReviewTargetType, targetId: string, q: PageQuery) {
    return this.page(
      q,
      and(eq(reviews.targetType, targetType), eq(reviews.targetId, targetId), visible()) as SQL,
    );
  }

  listByReviewer(userId: string, q: PageQuery) {
    return this.page(q, and(eq(reviews.reviewerUserId, userId), visible()) as SQL);
  }

  /** Reviews about this owner's spaces, optionally one space (ownership checked by the caller). */
  listForOwner(ownerId: string, q: PageQuery & { spaceId?: string | undefined }) {
    const ownSpaces = this.db
      .select({ id: spaces.id })
      .from(spaces)
      .where(
        and(
          eq(spaces.ownerId, ownerId),
          q.spaceId === undefined ? undefined : eq(spaces.id, q.spaceId),
        ),
      );
    return this.page(
      q,
      and(eq(reviews.targetType, 'space'), inArray(reviews.targetId, ownSpaces), visible()) as SQL,
    );
  }

  /**
   * The average is the read model's (recency-weighted); the distribution counts opinions, so its
   * bars sum to `ratingCount`. The two can look inconsistent, by design (§17.8).
   */
  async summaryForSpace(spaceId: string): Promise<Summary> {
    const [space] = await this.db
      .select({ ratingAvgBp: spaces.ratingAvgBp })
      .from(spaces)
      .where(eq(spaces.id, spaceId));

    const rows = await this.db
      .select({ rating: reviews.rating, n: count() })
      .from(reviews)
      .where(and(eq(reviews.targetType, 'space'), eq(reviews.targetId, spaceId), visible()))
      .groupBy(reviews.rating);

    const distribution = emptyCounts();
    for (const row of rows) distribution[starOf(row.rating)] = row.n;

    return {
      ratingAvgBp: space?.ratingAvgBp ?? null,
      ratingCount: rows.reduce((sum, row) => sum + row.n, 0),
      distribution,
    };
  }

  /** One summary per live space this owner has, in one query. */
  async summariesForOwner(ownerId: string): Promise<OwnerSpaceSummary[]> {
    const rows = await this.db
      .select({
        spaceId: spaces.id,
        spaceTitle: spaces.title,
        ratingAvgBp: spaces.ratingAvgBp,
        rating: reviews.rating,
        n: count(reviews.id),
        reported: sql<number>`count(*) filter (where ${reviews.isReported})::int`,
      })
      .from(spaces)
      .leftJoin(
        reviews,
        and(eq(reviews.targetType, 'space'), eq(reviews.targetId, spaces.id), visible()),
      )
      .where(and(eq(spaces.ownerId, ownerId), isNull(spaces.deletedAt)))
      .groupBy(spaces.id, reviews.rating)
      .orderBy(spaces.id);

    const bySpace = new Map<string, OwnerSpaceSummary>();
    for (const row of rows) {
      let entry = bySpace.get(row.spaceId);
      if (entry === undefined) {
        entry = {
          spaceId: row.spaceId,
          spaceTitle: row.spaceTitle,
          ratingAvgBp: row.ratingAvgBp,
          ratingCount: 0,
          distribution: emptyCounts(),
          reportedCount: 0,
        };
        bySpace.set(row.spaceId, entry);
      }
      // A space with no reviews joins one row with a NULL rating.
      if (row.rating === null) continue;
      entry.distribution[starOf(row.rating)] = row.n;
      entry.ratingCount += row.n;
      entry.reportedCount += row.reported;
    }
    return [...bySpace.values()];
  }

  /** Completed bookings still inside their review window, with what this driver has reviewed. */
  async pendingFor(driverId: string, now: Date): Promise<PendingBooking[]> {
    const since = new Date(now.getTime() - REVIEW_WINDOW_MS).toISOString();
    const recent = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.driverId, driverId),
          eq(bookings.status, 'completed'),
          sql`${bookings.completedAt} >= ${since}::timestamptz`,
          isNull(bookings.deletedAt),
        ),
      )
      .orderBy(desc(bookings.completedAt));
    if (recent.length === 0) return [];

    const ids = recent.map((b) => b.id);
    const written = await this.db
      .select({ bookingId: reviews.bookingId, targetId: reviews.targetId })
      .from(reviews)
      .where(and(inArray(reviews.bookingId, ids), eq(reviews.reviewerUserId, driverId)));

    // ponytail: one participants lookup per booking. A driver completes a handful a week; batch
    // this if the window or the volume grows.
    const pending: PendingBooking[] = [];
    for (const id of ids) {
      const participants = await this.participantsOf(id);
      if (participants === undefined) continue;
      const reviewed = new Set(written.filter((w) => w.bookingId === id).map((w) => w.targetId));
      pending.push({ participants, reviewed });
    }
    return pending;
  }

  /** Reported and not removed, oldest first: the queue an admin works through. */
  async moderationQueue(q: PageQuery): Promise<Page<QueueItem>> {
    const after = q.cursor === undefined ? undefined : this.cursorOf(q.cursor);
    const rows = await this.db
      .select()
      .from(reviews)
      .where(
        and(
          eq(reviews.isReported, true),
          isNull(reviews.deletedAt),
          after === undefined ? undefined : sql`${reviews.id} > ${after}::uuid`,
        ),
      )
      .orderBy(reviews.id)
      .limit(q.limit + 1);

    const hasMore = rows.length > q.limit;
    const items = hasMore ? rows.slice(0, q.limit) : rows;
    const reports =
      items.length === 0
        ? []
        : await this.db
            .select()
            .from(reviewReports)
            .where(
              and(
                inArray(
                  reviewReports.reviewId,
                  items.map((r) => r.id),
                ),
                isNull(reviewReports.dismissedAt),
              ),
            )
            .orderBy(reviewReports.createdAt);

    return {
      items: items.map((review) => ({
        review,
        reports: reports
          .filter((r) => r.reviewId === review.id)
          .map((r) => ({
            reason: reportReasonSchema.parse(r.reason),
            detail: r.detail,
            createdAt: r.createdAt,
          })),
      })),
      hasMore,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  private async page(q: PageQuery, where: SQL): Promise<Page<ReviewRow>> {
    const before = q.cursor === undefined ? undefined : this.cursorOf(q.cursor);
    const rows = await this.db
      .select({ review: reviews, reviewerName: users.name })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.reviewerUserId))
      .where(and(where, before === undefined ? undefined : lt(reviews.id, before)))
      .orderBy(desc(reviews.id))
      .limit(q.limit + 1);

    const hasMore = rows.length > q.limit;
    const items = hasMore ? rows.slice(0, q.limit) : rows;
    return { items, hasMore, nextCursor: hasMore ? (items.at(-1)?.review.id ?? null) : null };
  }

  private cursorOf(raw: string): string {
    const parsed = cursorSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        error: 'INVALID_CURSOR',
        message: 'That page link is no longer valid. Pull to refresh.',
      });
    }
    return parsed.data;
  }
}

/** `reviews_rating_check` keeps this in 1..5; anything else is a broken database, not input. */
function starOf(rating: number): 1 | 2 | 3 | 4 | 5 {
  if (rating === 1 || rating === 2 || rating === 3 || rating === 4 || rating === 5) return rating;
  throw new Error(`review rating out of range: ${String(rating)}`);
}
