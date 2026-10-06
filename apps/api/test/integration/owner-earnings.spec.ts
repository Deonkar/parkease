import {
  computeValetLegFee,
  computeWashFee,
  routeDischargeEntries,
  valetLegEntries,
  washEntries,
} from '@parkease/contracts/money';
import { toPaise, toRate } from '@parkease/contracts/primitives';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { istDays, istStartOfToday } from '../../src/domains/ledger/period-bound.js';
import { OwnerBalanceQuery } from '../../src/domains/ledger/queries/owner-balance.js';
import { withTransaction } from '../../src/platform/db/transaction.js';

import { type BookingStack, buildBookingStack, windowFromNow, zoneOf } from './booking-harness.js';
import {
  type Harness,
  seedSpace,
  seedUser,
  startHarness,
  stopHarness,
  surgePayload,
  truncateSpaces,
} from './harness.js';

/**
 * R-MONEY-05 at the query layer. The HTTP spec proves the wiring; this proves
 * the numbers, against real postings from the real booking commands.
 */
describe('owner earnings reads', () => {
  let h: Harness;
  let stack: BookingStack;
  let earnings: OwnerBalanceQuery;

  beforeAll(async () => {
    h = await startHarness();
    stack = buildBookingStack(h);
    earnings = new OwnerBalanceQuery(h.db);
  }, 300_000);

  afterAll(async () => {
    await stopHarness(h);
  });

  beforeEach(async () => {
    await truncateSpaces(h);
  });

  const book = async (spaceId: string, driverId: string, hoursAhead: number, hours: number) => {
    const window = windowFromNow(hoursAhead, hours);
    return stack.create.execute({
      driverId,
      spaceId,
      vehicleType: 'car',
      durationType: 'hourly',
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      vehicleNumber: null,
    });
  };

  const confirm = async (bookingId: string) => {
    await h.sql`UPDATE bookings SET status = 'confirmed' WHERE id = ${bookingId}`;
  };

  /**
   * Must match `OwnerBalanceQuery`'s definition of an owner-side row exactly:
   * `owner_payable`, on a booking at one of the owner's spaces, stamped with that
   * booking's DRIVER as counterparty. Washer and valet legs post to the same
   * account under the same booking id with the partner as counterparty (C1).
   */
  const rawNet = async (): Promise<number> => {
    const [row] = await h.sql<{ net: string }[]>`
      SELECT coalesce(sum(le.amount_paise) FILTER (WHERE le.direction = 'credit'), 0)
           - coalesce(sum(le.amount_paise) FILTER (WHERE le.direction = 'debit'), 0) AS net
      FROM ledger_entries le
      JOIN bookings b ON b.id = le.booking_id
      JOIN spaces s ON s.id = b.space_id
      WHERE le.account = 'owner_payable' AND s.owner_id = ${h.ownerId}
        AND le.counterparty_user_id = b.driver_id
    `;
    return Number(row?.net ?? 0);
  };

  it('month movement equals a raw SUM over owner_payable for the owner', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 2 });
    await book(spaceId, h.driverId, 2, 2);
    await book(spaceId, await seedUser(h, 'driver'), 6, 3);

    const month = await earnings.movement(h.ownerId, undefined);
    expect(month.netPaise).toBe(await rawNet());
    expect(month.netPaise).toBeGreaterThan(0);
  });

  it('shows a surged ₹97.02 booking as 6000 base, 900 fee, 5100 net', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    await h.redis.set(`surge:${await zoneOf(h, spaceId)}`, surgePayload(1.5));
    const { booking } = await book(spaceId, h.driverId, 2, 2);
    h.redis.clear();
    await confirm(booking.id);

    expect(booking.totalPaise).toBe(9702);
    const page = await earnings.statementPage(h.ownerId, { period: 'month', limit: 10 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      basePaise: 6000,
      feePaise: 900,
      reversedPaise: 0,
      netPaise: 5100,
    });
  });

  it('keeps never-paid bookings off the statement', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    await book(spaceId, h.driverId, 2, 2); // stays pending_payment

    const page = await earnings.statementPage(h.ownerId, { period: 'month', limit: 10 });
    expect(page.items).toEqual([]);
    expect(await earnings.statementCount(h.ownerId, 'month')).toBe(0);
  });

  it('shows a refund as reversed paise that lowers net', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    const { booking } = await book(spaceId, h.driverId, 48, 2);
    await confirm(booking.id);
    await h.sql`
      INSERT INTO payments (booking_id, user_id, razorpay_order_id, razorpay_payment_id,
                            expected_total_paise, captured_paise, status, captured_at)
      VALUES (${booking.id}, ${h.driverId}, ${`order_${booking.id.slice(0, 12)}`},
              ${`pay_${booking.id.slice(0, 12)}`}, ${booking.totalPaise}, ${booking.totalPaise},
              'captured', now())
    `;
    await stack.cancel.execute({
      bookingId: booking.id,
      reason: null,
      by: { kind: 'driver', driverId: h.driverId },
    });

    const [line] = (await earnings.statementPage(h.ownerId, { period: 'month', limit: 10 })).items;
    expect(line?.reversedPaise).toBeGreaterThan(0);
    expect(line?.netPaise).toBe(booking.ownerEarningsPaise - (line?.reversedPaise ?? 0));
    expect((await earnings.movement(h.ownerId, undefined)).netPaise).toBe(await rawNet());
  });

  it('pages by cursor with a correct hasMore', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 3 });
    for (const hours of [2, 6, 10]) {
      const { booking } = await book(spaceId, await seedUser(h, 'driver'), hours, 2);
      await confirm(booking.id);
    }

    const first = await earnings.statementPage(h.ownerId, { period: 'month', limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();

    const second = await earnings.statementPage(h.ownerId, {
      period: 'month',
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    const ids = [...first.items, ...second.items].map((row) => row.bookingId);
    expect(new Set(ids).size).toBe(3);
  });

  it('pages every booking exactly once when first credits tie inside one millisecond (I1)', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    // ledger_entries is append-only (migration 0007 rejects UPDATE), so the
    // instants are set at INSERT: one base millisecond, three microsecond-distinct
    // offsets, and one exact tie with the last — the rows a millisecond-truncated
    // cursor skips.
    const [base] = await h.sql<{ t: string }[]>`
      SELECT (date_trunc('milliseconds', now()) - interval '1 minute')::text AS t`;
    if (base === undefined) throw new Error('no base instant');
    const ids: string[] = [];
    for (const micros of [1, 2, 3, 3]) {
      const [booking] = await h.sql<{ id: string }[]>`
        INSERT INTO bookings (driver_id, space_id, vehicle_type, duration_type, starts_at, ends_at,
          status, base_paise, surge_premium_paise, parkease_fee_paise, gst_paise, total_paise,
          owner_earnings_paise)
        VALUES (${h.driverId}, ${spaceId}, 'car', 'hourly', now() + interval '1 day',
          now() + interval '1 day 2 hours', 'confirmed', 6000, 0, 900, 0, 6000, 5100)
        RETURNING id`;
      if (booking === undefined) throw new Error('failed to seed booking');
      ids.push(booking.id);
      await h.sql`
        INSERT INTO ledger_entries (txn_id, account, direction, amount_paise, booking_id,
          counterparty_user_id, description, occurred_at)
        SELECT t, acct, dir, 5100, ${booking.id}, ${h.driverId}, 'tie fixture',
               ${base.t}::timestamptz + ${micros} * interval '1 microsecond'
        FROM (SELECT uuidv7() AS t) txn,
             (VALUES ('owner_payable', 'credit'), ('driver_receivable', 'debit')) AS legs(acct, dir)`;
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      // 'all', not 'month': the rows sit a minute in the past, which is last
      // month during the first minute of an IST month.
      const page = await earnings.statementPage(h.ownerId, { period: 'all', limit: 1, cursor });
      seen.push(...page.items.map((row) => row.bookingId));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(seen.sort()).toEqual([...ids].sort());
  });

  it('ignores washer and valet legs posted under the owner’s booking (C1)', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    const { booking } = await book(spaceId, h.driverId, 2, 2);
    await confirm(booking.id);

    const snapshot = async () => ({
      movement: await earnings.movement(h.ownerId, undefined),
      days: await earnings.days(h.ownerId, 'month'),
      statement: await earnings.statementPage(h.ownerId, { period: 'month', limit: 10 }),
      count: await earnings.statementCount(h.ownerId, 'month'),
      byBooking: [...(await earnings.netByBooking(h.ownerId, [booking.id]))],
      balance: await earnings.balance(h.ownerId),
      forBooking: await earnings.forBooking(booking.id),
      raw: await rawNet(),
    });
    const before = await snapshot();

    // Exactly the postings accept-wash and accept-job make: the partner is the
    // row-level counterparty on owner_payable, under the PARKING booking's id.
    const washer = await seedUser(h, 'washer');
    const valet = await seedUser(h, 'valet');
    await withTransaction(h.db, async (tx) => {
      await stack.ledger.post(tx, {
        bookingId: booking.id,
        entries: washEntries(
          computeWashFee(toPaise(39900), toRate(0.2)),
          washer,
          'car wash service',
        ),
      });
      await stack.ledger.post(tx, {
        bookingId: booking.id,
        entries: valetLegEntries(
          computeValetLegFee(3000, toRate(0.2)),
          valet,
          'valet outbound leg',
        ),
      });
    });

    const after = await snapshot();
    expect(after).toEqual(before);
    expect(after.movement.netPaise).toBe(booking.ownerEarningsPaise);
    expect(after.statement.items[0]?.feePaise).toBeGreaterThanOrEqual(0);
  });

  it('a Route discharge moves no earnings figure and zeroes what is owed (ADR-030)', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    const { booking } = await book(spaceId, h.driverId, 2, 2);
    await confirm(booking.id);

    const snapshot = async () => ({
      movement: await earnings.movement(h.ownerId, undefined),
      days: await earnings.days(h.ownerId, 'month'),
      statement: await earnings.statementPage(h.ownerId, { period: 'month', limit: 10 }),
      count: await earnings.statementCount(h.ownerId, 'month'),
      byBooking: [...(await earnings.netByBooking(h.ownerId, [booking.id]))],
      forBooking: await earnings.forBooking(booking.id),
    });
    const before = await snapshot();
    expect(await earnings.balance(h.ownerId)).toBe(booking.ownerEarningsPaise);

    // Exactly what capture posts: the driver-stamped discharge under the booking.
    await withTransaction(h.db, async (tx) => {
      await stack.ledger.post(tx, {
        bookingId: booking.id,
        entries: routeDischargeEntries(booking.ownerEarningsPaise, h.driverId),
      });
    });

    // Earned is still earned — a transfer is not a reversal.
    expect(await snapshot()).toEqual(before);
    expect(before.statement.items[0]?.reversedPaise).toBe(0);
    // Owed is what Route has not yet paid.
    expect(await earnings.balance(h.ownerId)).toBe(0);
  });

  it('refuses a forged cursor as a 400, not a 500', async () => {
    await expect(
      earnings.statementPage(h.ownerId, { period: 'month', limit: 2, cursor: 'not-a-cursor' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('buckets days in IST and fills the empty ones with zero', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    const { booking } = await book(spaceId, h.driverId, 2, 2);

    const days = await earnings.days(h.ownerId, 'month');
    expect(days.map((d) => d.date)).toEqual(istDays('month'));
    expect(days.at(-1)?.netPaise).toBe(booking.ownerEarningsPaise);
    expect(days.reduce((sum, d) => sum + d.netPaise, 0)).toBe(booking.ownerEarningsPaise);
  });

  it('netByBooking is owner-scoped — another owner gets nothing for it (F1)', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    const { booking } = await book(spaceId, h.driverId, 2, 2);
    await confirm(booking.id);
    const otherOwner = await seedUser(h, 'owner');

    const mine = await earnings.netByBooking(h.ownerId, [booking.id]);
    expect(mine.get(booking.id)).toBeGreaterThan(0);

    const theirs = await earnings.netByBooking(otherOwner, [booking.id]);
    expect(theirs.has(booking.id)).toBe(false);
  });

  it('is the only module reading owner_payable (R-MONEY-05)', async () => {
    const { spawnSync } = await import('node:child_process');
    // `:/` anchors the pathspec at the repo root whatever vitest's cwd is.
    // spawnSync, not execSync: git grep exits 1 on "no match", which is fine.
    const out = spawnSync(
      'git',
      ['grep', '-l', '-E', 'LedgerAccount\\.OWNER_PAYABLE', '--', ':/apps/api/src'],
      { encoding: 'utf8' },
    ).stdout;
    const hits = out
      .split('\n')
      .filter(Boolean)
      .filter((file) => !file.includes('domains/ledger/'))
      .filter((file) => !file.includes('/queries/'));
    // The chart (ledger/accounts.ts) names the account; only a queries/ file
    // may read it. Comments may say "owner_payable" — code may not.
    expect(hits).toEqual([]);
  });

  it('istDays starts the week on Monday and the month on the 1st', () => {
    const wed = new Date('2026-09-09T06:00:00.000Z'); // Wed 9 Sep, 11:30 IST
    expect(istDays('today', wed)).toEqual(['2026-09-09']);
    expect(istDays('week', wed)).toEqual(['2026-09-07', '2026-09-08', '2026-09-09']);
    expect(istDays('month', wed)[0]).toBe('2026-09-01');
    // 20:00 UTC on the 9th is already the 10th in IST.
    expect(istDays('today', new Date('2026-09-09T20:00:00.000Z'))).toEqual(['2026-09-10']);
    // Same instant, as an instant: IST midnight of the 10th.
    expect(istStartOfToday(new Date('2026-09-09T20:00:00.000Z'))).toEqual(
      new Date('2026-09-09T18:30:00.000Z'),
    );
  });
});
