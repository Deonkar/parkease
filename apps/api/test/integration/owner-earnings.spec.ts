import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { istDays, istStartOfToday } from '../../src/domains/ledger/period-bound.js';
import { OwnerBalanceQuery } from '../../src/domains/ledger/queries/owner-balance.js';

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

  const rawNet = async (): Promise<number> => {
    const [row] = await h.sql<{ net: string }[]>`
      SELECT coalesce(sum(le.amount_paise) FILTER (WHERE le.direction = 'credit'), 0)
           - coalesce(sum(le.amount_paise) FILTER (WHERE le.direction = 'debit'), 0) AS net
      FROM ledger_entries le
      JOIN bookings b ON b.id = le.booking_id
      JOIN spaces s ON s.id = b.space_id
      WHERE le.account = 'owner_payable' AND s.owner_id = ${h.ownerId}
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
    await stack.cancel.execute({ bookingId: booking.id, driverId: h.driverId, reason: null });

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
