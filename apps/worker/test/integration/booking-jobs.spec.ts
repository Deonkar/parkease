import {
  type PgTestContext,
  runMigrations,
  startPgContainer,
  stopPgContainer,
} from '@parkease/testing';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { JobDeps } from '../../src/deps.js';
import { completeBooking } from '../../src/jobs/booking/complete.job.js';
import { expireUnpaid } from '../../src/jobs/booking/expire-unpaid.job.js';
import { remindBooking } from '../../src/jobs/booking/remind.job.js';

let pg: PgTestContext;
let deps: JobDeps;

/**
 * Seeds a booking directly, because the worker has no access to the API's
 * command stack and does not need one: what these jobs are responsible for is
 * the guard and the transaction, both of which are visible from the rows.
 *
 * The money columns are the no-surge two-hour quote — base 6000, fee 900, GST
 * 162, total 6162, owner 5100 — and they matter, because the expiry job reverses
 * exactly these numbers and the reversal has to balance.
 */
async function seedBooking(opts: {
  status: string;
  slotStatus?: string;
  startsInMinutes?: number;
  endsInMinutes?: number;
}): Promise<{ bookingId: string; driverId: string; spaceId: string }> {
  const startsIn = opts.startsInMinutes ?? 60;
  const endsIn = opts.endsInMinutes ?? 180;

  const [driver] = await pg.sql<{ id: string }[]>`
    INSERT INTO users (phone, firebase_uid, name)
    VALUES (${`+9198${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`},
            ${`fb-${String(Math.random())}`}, 'Ravi K.')
    RETURNING id
  `;
  const [owner] = await pg.sql<{ id: string }[]>`
    INSERT INTO users (phone, firebase_uid, name)
    VALUES (${`+9197${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`},
            ${`fb-${String(Math.random())}`}, 'Priya S.')
    RETURNING id
  `;
  if (driver === undefined || owner === undefined) throw new Error('failed to seed users');

  const [space] = await pg.sql<{ id: string }[]>`
    INSERT INTO spaces (
      owner_id, title, address_line, city, state, pincode, location, zone_id,
      pricing, schedule, amenities, approval_status
    ) VALUES (
      ${owner.id}, 'Basement Parking, 5th Cross', '5th Cross', 'Bengaluru', 'Karnataka', '560034',
      ST_SetSRID(ST_MakePoint(77.6266, 12.9345), 4326)::geography,
      ST_GeoHash(ST_SetSRID(ST_MakePoint(77.6266, 12.9345), 4326)::geometry, 6),
      ${JSON.stringify({ car: { hourlyPaise: 3000 } })}::jsonb,
      ${JSON.stringify({ is24x7: true })}::jsonb,
      '[]'::jsonb, 'active'
    ) RETURNING id
  `;
  if (space === undefined) throw new Error('failed to seed space');

  await pg.sql`INSERT INTO space_slots (space_id, vehicle_type, slot_index)
               VALUES (${space.id}, 'car', 0)`;

  const checkedIn = opts.status === 'active';
  const [booking] = await pg.sql<{ id: string }[]>`
    INSERT INTO bookings (
      driver_id, space_id, vehicle_type, duration_type, starts_at, ends_at, status,
      base_paise, surge_premium_paise, parkease_fee_paise, gst_paise, total_paise,
      owner_earnings_paise, checked_in_at, check_in_method
    ) VALUES (
      ${driver.id}, ${space.id}, 'car', 'hourly',
      now() + make_interval(mins => ${startsIn}),
      now() + make_interval(mins => ${endsIn}),
      ${opts.status},
      6000, 0, 900, 162, 6162, 5100,
      ${checkedIn ? new Date().toISOString() : null}::timestamptz,
      ${checkedIn ? 'owner_scan' : null}
    ) RETURNING id
  `;
  if (booking === undefined) throw new Error('failed to seed booking');

  await pg.sql`
    INSERT INTO booking_slots (booking_id, space_id, vehicle_type, slot_index, period, status)
    VALUES (
      ${booking.id}, ${space.id}, 'car', 0,
      tstzrange(now() + make_interval(mins => ${startsIn}),
                now() + make_interval(mins => ${endsIn}), '[)'),
      ${opts.slotStatus ?? 'confirmed'}
    )
  `;

  // The receivable the expiry job will reverse.
  await pg.sql`
    INSERT INTO ledger_entries (txn_id, account, direction, amount_paise, description, booking_id)
    VALUES
      (gen_random_uuid(), 'driver_receivable', 'debit',  6162, 'booking created', ${booking.id}),
      (gen_random_uuid(), 'owner_payable',     'credit', 5100, 'booking created', ${booking.id})
  `;

  return { bookingId: booking.id, driverId: driver.id, spaceId: space.id };
}

const bookingRow = async (id: string) => {
  const rows = await pg.sql<
    { status: string; cancellation_reason: string | null; completed_at: string | null }[]
  >`SELECT status, cancellation_reason, completed_at::text FROM bookings WHERE id = ${id}`;
  return rows[0];
};

const slotStatus = async (id: string) => {
  const rows = await pg.sql<{ status: string }[]>`
    SELECT status FROM booking_slots WHERE booking_id = ${id}
  `;
  return rows[0]?.status;
};

const outbox = async () => {
  const rows = await pg.sql<{ type: string }[]>`SELECT type FROM outbox_messages ORDER BY type`;
  return rows.map((r) => r.type);
};

const reversalTxns = async (id: string) => {
  const rows = await pg.sql<{ n: number }[]>`
    SELECT count(DISTINCT txn_id)::int AS n
    FROM ledger_entries WHERE booking_id = ${id} AND description LIKE 'booking expired%'
  `;
  return rows[0]?.n ?? 0;
};

describe('booking worker jobs', () => {
  beforeAll(async () => {
    pg = await startPgContainer();
    await runMigrations(pg.connectionString);
    deps = {
      db: drizzle(pg.sql) as unknown as JobDeps['db'],
      boss: {} as JobDeps['boss'],
      // No booking job touches the cache; only surge does.
      redis: {} as JobDeps['redis'],
    };
  }, 300_000);

  afterAll(async () => {
    await stopPgContainer(pg);
  });

  beforeEach(async () => {
    await pg.sql`TRUNCATE ledger_entries, booking_slots, bookings, space_slots, spaces,
                          outbox_messages, user_roles, users CASCADE`;
  });

  describe('payload validation', () => {
    it.each([
      ['an empty payload', {}],
      ['a missing id', { bookingId: undefined }],
      ['a non-uuid id', { bookingId: 'not-a-uuid' }],
      ['a null payload', null],
      ['a string payload', 'booking-1'],
    ])('rejects %s rather than acting on it', async (_label, payload) => {
      // R-VAL-01: a job payload crossed a process boundary and sat in a table.
      // A relay bug must fail loudly here, not reach a cancel path with
      // `undefined` and quietly match no rows.
      await expect(expireUnpaid(deps, payload)).rejects.toThrow(/Malformed booking job payload/);
    });
  });

  describe('expire-unpaid', () => {
    it('cancels an unpaid booking, releases the slot and reverses the receivable', async () => {
      const { bookingId } = await seedBooking({ status: 'pending_payment' });

      await expireUnpaid(deps, { bookingId });

      const row = await bookingRow(bookingId);
      expect(row?.status).toBe('cancelled');
      expect(row?.cancellation_reason).toBe('payment_timeout');
      expect(await slotStatus(bookingId)).toBe('released');
      expect(await outbox()).toEqual(['booking.expired']);

      const balanced = await pg.sql<{ txn_id: string }[]>`
        SELECT txn_id FROM ledger_entries
        WHERE description LIKE 'booking expired%'
        GROUP BY txn_id
        HAVING sum(CASE WHEN direction = 'debit' THEN amount_paise ELSE 0 END)
            <> sum(CASE WHEN direction = 'credit' THEN amount_paise ELSE 0 END)
      `;
      expect(balanced).toHaveLength(0);
    });

    it('frees the slot for the same window the instant it commits', async () => {
      const { bookingId, spaceId } = await seedBooking({ status: 'pending_payment' });
      await expireUnpaid(deps, { bookingId });

      // The released row leaves the constraint predicate, so an identical range
      // on the same slot_index now inserts. Before the release this would be a
      // 23P01. No cleanup sweep ran in between.
      await expect(
        pg.sql`
          INSERT INTO booking_slots (booking_id, space_id, vehicle_type, slot_index, period, status)
          SELECT ${bookingId}, ${spaceId}, 'car', 0, period, 'confirmed'
          FROM booking_slots WHERE booking_id = ${bookingId} LIMIT 1
        `,
      ).resolves.toBeDefined();
    });

    it('is a no-op the second time, writing no second reversal', async () => {
      const { bookingId } = await seedBooking({ status: 'pending_payment' });

      await expireUnpaid(deps, { bookingId });
      await expireUnpaid(deps, { bookingId });

      // At-least-once delivery is the normal case, not the exception.
      expect(await reversalTxns(bookingId)).toBe(1);
      const messages = await outbox();
      expect(messages.filter((t) => t === 'booking.expired')).toHaveLength(1);
    });

    it('leaves a booking that was paid in the meantime alone', async () => {
      const { bookingId } = await seedBooking({ status: 'confirmed' });

      await expireUnpaid(deps, { bookingId });

      expect((await bookingRow(bookingId))?.status).toBe('confirmed');
      expect(await slotStatus(bookingId)).toBe('confirmed');
      expect(await reversalTxns(bookingId)).toBe(0);
      expect(await outbox()).toEqual([]);
    });

    it('tolerates a booking that no longer exists', async () => {
      await expect(
        expireUnpaid(deps, { bookingId: '01920000-0000-7000-8000-000000000000' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('complete', () => {
    it('completes an active booking and releases the slot', async () => {
      const { bookingId } = await seedBooking({
        status: 'active',
        slotStatus: 'active',
        startsInMinutes: -120,
        endsInMinutes: -1,
      });

      await completeBooking(deps, { bookingId });

      const row = await bookingRow(bookingId);
      expect(row?.status).toBe('completed');
      expect(row?.completed_at).not.toBeNull();
      expect(await slotStatus(bookingId)).toBe('released');
      expect(await outbox()).toEqual(['booking.completed']);
    });

    it('is a no-op on a booking that was cancelled mid-stay', async () => {
      const { bookingId } = await seedBooking({ status: 'cancelled', slotStatus: 'released' });

      await completeBooking(deps, { bookingId });

      expect((await bookingRow(bookingId))?.status).toBe('cancelled');
      expect(await outbox()).toEqual([]);
    });

    it('is a no-op the second time', async () => {
      const { bookingId } = await seedBooking({
        status: 'active',
        slotStatus: 'active',
        startsInMinutes: -120,
        endsInMinutes: -1,
      });

      await completeBooking(deps, { bookingId });
      await completeBooking(deps, { bookingId });

      expect(await outbox()).toEqual(['booking.completed']);
    });

    it('never completes a booking nobody checked into', async () => {
      // The reason completion is scheduled at check-in and not at creation: a
      // `confirmed` booking that nobody arrived for must not settle itself.
      const { bookingId } = await seedBooking({ status: 'confirmed' });

      await completeBooking(deps, { bookingId });

      expect((await bookingRow(bookingId))?.status).toBe('confirmed');
      expect(await outbox()).toEqual([]);
    });
  });

  describe('remind', () => {
    it('enqueues the nudge for a confirmed booking', async () => {
      const { bookingId, driverId } = await seedBooking({ status: 'confirmed' });

      await remindBooking(deps, { bookingId });

      const rows = await pg.sql<{ type: string; payload: Record<string, unknown> }[]>`
        SELECT type, payload FROM outbox_messages
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.type).toBe('notification.dispatch');
      expect(rows[0]?.payload).toMatchObject({
        userId: driverId,
        type: 'booking_reminder',
        title: 'Parking in 30 min ⏰',
      });
    });

    it('stays quiet for a booking that was never paid for', async () => {
      const { bookingId } = await seedBooking({ status: 'pending_payment' });
      await remindBooking(deps, { bookingId });
      expect(await outbox()).toEqual([]);
    });

    it('stays quiet for a cancelled booking', async () => {
      const { bookingId } = await seedBooking({ status: 'cancelled', slotStatus: 'released' });
      await remindBooking(deps, { bookingId });
      expect(await outbox()).toEqual([]);
    });

    it('tolerates a booking that no longer exists', async () => {
      await expect(
        remindBooking(deps, { bookingId: '01920000-0000-7000-8000-000000000000' }),
      ).resolves.toBeUndefined();
    });
  });
});
