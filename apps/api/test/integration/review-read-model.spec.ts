import { ageingReviewTargets, recomputeRatingAggregate } from '@parkease/db/queries';
import { reviews } from '@parkease/db/schema';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  type Harness,
  seedBooking,
  seedSpace,
  seedUser,
  startHarness,
  stopHarness,
  truncateSpaces,
} from './harness.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The read model (task 17 §17.2, §17.6): `spaces.rating_avg_bp` / `rating_count`, recomputed from
 * `reviews` by the one function both the API and the worker call.
 */
describe('review read model', () => {
  let h: Harness;
  let spaceId: string;
  let bookingId: string;

  beforeAll(async () => {
    h = await startHarness();
  });

  afterAll(async () => {
    await stopHarness(h);
  });

  beforeEach(async () => {
    await h.sql`TRUNCATE review_reports, reviews CASCADE`;
    await truncateSpaces(h);
    spaceId = await seedSpace(h, { lat: 12.9352, lng: 77.6245 });
    bookingId = await seedBooking(h, {
      spaceId,
      vehicleType: 'car',
      slotIndex: 0,
      slotStatus: 'released',
    });
  });

  /** Each review from a different driver: the key is one opinion per counterparty per booking. */
  async function addSpaceReview(rating: number, ageDays = 0): Promise<string> {
    const reviewer = await seedUser(h, 'driver');
    const createdAt = new Date(Date.now() - ageDays * DAY_MS).toISOString();
    const rows = await h.sql<{ id: string }[]>`
      INSERT INTO reviews (booking_id, reviewer_user_id, reviewer_role, target_type, target_id,
                           rating, created_at)
      VALUES (${bookingId}, ${reviewer}, 'driver', 'space', ${spaceId}, ${rating},
              ${createdAt}::timestamptz)
      RETURNING id`;
    return rows[0]!.id;
  }

  const recompute = () => h.db.transaction((tx) => recomputeRatingAggregate(tx, 'space', spaceId));

  async function readModel(): Promise<{ avg: number | null; count: number }> {
    const [row] = await h.sql<{ avg: number | null; count: number }[]>`
      SELECT rating_avg_bp AS avg, rating_count AS count FROM spaces WHERE id = ${spaceId}`;
    return row!;
  }

  it('refuses a read model that disagrees with itself', async () => {
    // Awaited inside a function: postgres.js queries are lazy thenables, and handing one straight
    // to `expect().rejects` resolved it without the constraint ever firing.
    const sqlState = async (run: () => Promise<unknown>): Promise<string> =>
      run().then(
        () => 'ok',
        (error: { code?: string }) => error.code ?? 'unknown',
      );

    expect(
      await sqlState(
        async () =>
          await h.sql`UPDATE spaces SET rating_count = 0, rating_avg_bp = 30000 WHERE id = ${spaceId}`,
      ),
    ).toBe('23514');
    expect(
      await sqlState(
        async () =>
          await h.sql`UPDATE spaces SET rating_count = 2, rating_avg_bp = NULL WHERE id = ${spaceId}`,
      ),
    ).toBe('23514');
  });

  it('recomputes from visible reviews only, and is idempotent', async () => {
    for (const rating of [5, 5, 5]) await addSpaceReview(rating);
    const oneStar = await addSpaceReview(1);

    expect(await recompute()).toEqual({ ratingAvgBp: 40_000, ratingCount: 4 });
    expect(await readModel()).toEqual({ avg: 40_000, count: 4 });

    await h.sql`UPDATE reviews SET moderation_status = 'removed', deleted_at = now()
                WHERE id = ${oneStar}`;
    await recompute();
    expect(await readModel()).toEqual({ avg: 50_000, count: 3 });

    await recompute();
    expect(await readModel()).toEqual({ avg: 50_000, count: 3 });
  });

  it('weights reviews inside 30 days twice', async () => {
    await addSpaceReview(5, 10);
    await addSpaceReview(1, 100);
    await recompute();
    expect(await readModel()).toEqual({ avg: 36_667, count: 2 });
  });

  it('loses no review when two commit at once', async () => {
    // Both transactions insert, THEN both recompute: without the row lock each sees only its own
    // insert and the later write leaves rating_count = 1.
    const reviewers = [await seedUser(h, 'driver'), await seedUser(h, 'driver')];
    let arrived = 0;
    let release: () => void = () => undefined;
    const bothInserted = new Promise<void>((resolve) => (release = resolve));

    await Promise.all(
      reviewers.map((reviewer) =>
        h.db.transaction(async (tx) => {
          await tx.insert(reviews).values({
            bookingId,
            reviewerUserId: reviewer,
            reviewerRole: 'driver',
            targetType: 'space',
            targetId: spaceId,
            rating: 4,
          });
          arrived += 1;
          if (arrived === 2) release();
          await bothInserted;
          await recomputeRatingAggregate(tx, 'space', spaceId);
        }),
      ),
    );

    expect(await readModel()).toEqual({ avg: 40_000, count: 2 });
  });

  it('keeps no read model for drivers', async () => {
    const result = await h.db.transaction((tx) =>
      recomputeRatingAggregate(tx, 'driver', h.driverId),
    );
    expect(result).toEqual({ ratingAvgBp: null, ratingCount: 0 });
  });

  it('finds targets whose review crossed the 30-day window in the last day', async () => {
    const other = await seedSpace(h, { lat: 12.94, lng: 77.62 });
    const third = await seedSpace(h, { lat: 12.95, lng: 77.61 });
    await addSpaceReview(5, 30.5);
    for (const [target, ageDays] of [
      [other, 29],
      [third, 32],
    ] as const) {
      const reviewer = await seedUser(h, 'driver');
      await h.sql`
        INSERT INTO reviews (booking_id, reviewer_user_id, reviewer_role, target_type, target_id,
                             rating, created_at)
        VALUES (${bookingId}, ${reviewer}, 'driver', 'space', ${target}, 3,
                now() - make_interval(secs => ${ageDays * 86_400}))`;
    }

    expect(await ageingReviewTargets(h.db)).toEqual([{ targetType: 'space', targetId: spaceId }]);
  });
});
