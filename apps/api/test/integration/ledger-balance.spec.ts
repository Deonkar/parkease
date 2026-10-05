import { LedgerAccount } from '@parkease/contracts/enums';
import {
  computeValetLegFee,
  type DatedRate,
  type LedgerEntryDraft,
  payoutEntries,
  reverseEntries,
  routeDischargeEntries,
  settlementClearedEntries,
  valetLegEntries,
} from '@parkease/contracts/money';
import { toPaise, toRate } from '@parkease/contracts/primitives';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
 * One of the four tests that must stay green for any task to ship (R-TEST-03).
 *
 * The invariant is not "the code that writes the ledger is correct" — it is
 * "no `txn_id` in the table is unbalanced, whatever produced it". So this drives
 * every flow the system can currently reach and then asks the table, rather than
 * asserting against the compositions it already knows about.
 */
describe('ledger balance', () => {
  let h: Harness;
  let stack: BookingStack;
  let ownerBalance: OwnerBalanceQuery;

  beforeAll(async () => {
    h = await startHarness();
    stack = buildBookingStack(h);
    ownerBalance = new OwnerBalanceQuery(h.db);
  }, 300_000);

  afterAll(async () => {
    await stopHarness(h);
  });

  beforeEach(async () => {
    await truncateSpaces(h);
    await h.sql`DELETE FROM payments`;
    // A waiver left behind would add a promo_expense leg to every later booking (task 16c).
    await h.sql`TRUNCATE commission_waivers`;
  });

  const unbalancedTxns = async () =>
    h.sql<{ txn_id: string }[]>`
      SELECT txn_id
      FROM ledger_entries
      GROUP BY txn_id
      HAVING coalesce(sum(amount_paise) FILTER (WHERE direction = 'debit'), 0)
          <> coalesce(sum(amount_paise) FILTER (WHERE direction = 'credit'), 0)
    `;

  const book = async (spaceId: string, driverId: string, hoursAhead: number, hours: number) => {
    const window = windowFromNow(hoursAhead, hours);
    return stack.create.execute({
      driverId,
      spaceId,
      vehicleType: 'car',
      durationType: 'hourly',
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      vehicleNumber: 'KA-01-AB-1234',
    });
  };

  /** Puts a captured payment behind a booking, so refunds take the tiered path. */
  const capture = async (bookingId: string, driverId: string, totalPaise: number) => {
    await h.sql`UPDATE bookings SET status = 'confirmed' WHERE id = ${bookingId}`;
    await h.sql`
      INSERT INTO payments (booking_id, user_id, razorpay_order_id, razorpay_payment_id,
                            expected_total_paise, captured_paise, status, captured_at)
      VALUES (${bookingId}, ${driverId}, ${`order_${bookingId.slice(0, 12)}`},
              ${`pay_${bookingId.slice(0, 12)}`}, ${totalPaise}, ${totalPaise},
              'captured', now())
    `;
  };

  it('balances every txn_id across every flow the system can reach', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 4 });

    // A plain booking, and one at surge, so the surge premium's path is covered.
    const plain = await book(spaceId, h.driverId, 2, 2);

    await h.redis.set(`surge:${await zoneOf(h, spaceId)}`, surgePayload(1.5));
    const driverSurge = await seedUser(h, 'driver');
    const surged = await book(spaceId, driverSurge, 30, 2);
    h.redis.clear();

    // An extension, which posts the delta rather than a fresh receivable.
    await h.sql`UPDATE bookings SET status = 'confirmed' WHERE id = ${plain.booking.id}`;
    await stack.extend.execute({
      bookingId: plain.booking.id,
      driverId: h.driverId,
      newEndsAt: new Date(windowFromNow(2, 2).endsAt.getTime() + 3_600_000),
    });

    // Cancelled before the start, with money captured: the ₹10 tier.
    const driverB = await seedUser(h, 'driver');
    const beforeStart = await book(spaceId, driverB, 40, 2);
    await capture(beforeStart.booking.id, driverB, beforeStart.booking.totalPaise);
    await stack.cancel.execute({
      bookingId: beforeStart.booking.id,
      driverId: driverB,
      reason: 'plans changed',
    });

    // Cancelled with nothing captured: a full reversal, not a refund.
    const driverC = await seedUser(h, 'driver');
    const unpaid = await book(spaceId, driverC, 50, 2);
    await h.sql`UPDATE bookings SET status = 'confirmed' WHERE id = ${unpaid.booking.id}`;
    await stack.cancel.execute({ bookingId: unpaid.booking.id, driverId: driverC, reason: null });

    expect(await unbalancedTxns()).toEqual([]);
    expect(surged.booking.surgePremiumPaise).toBeGreaterThan(0);
  });

  it('balances a commission-free owner: booking, extension and both cancellations (task 16c)', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 4 });
    await h.sql`INSERT INTO commission_waivers (owner_id, slot, starts_at, ends_at)
                VALUES (${h.ownerId}, 1, now() - interval '1 day', now() + interval '30 days')`;
    const promoNet = async (bookingId: string) => {
      const [row] = await h.sql<{ net: string }[]>`
        SELECT coalesce(sum(CASE direction WHEN 'debit' THEN amount_paise ELSE -amount_paise END), 0)::text AS net
        FROM ledger_entries WHERE booking_id = ${bookingId} AND account = 'promo_expense'`;
      return Number(row?.net);
    };

    // Kept, then extended: promo_expense carries both waivers.
    const kept = await book(spaceId, h.driverId, 2, 2);
    await h.sql`UPDATE bookings SET status = 'confirmed' WHERE id = ${kept.booking.id}`;
    await stack.extend.execute({
      bookingId: kept.booking.id,
      driverId: h.driverId,
      newEndsAt: new Date(windowFromNow(2, 2).endsAt.getTime() + 3_600_000),
    });
    const [keptRow] = await h.sql<{ waiver: number }[]>`
      SELECT commission_waiver_paise::int AS waiver FROM bookings WHERE id = ${kept.booking.id}`;
    expect(keptRow?.waiver).toBeGreaterThan(kept.booking.commissionWaiverPaise);

    // Captured, then cancelled before the start: the waiver goes back in full.
    const driverB = await seedUser(h, 'driver');
    const paid = await book(spaceId, driverB, 40, 2);
    await capture(paid.booking.id, driverB, paid.booking.totalPaise);
    await stack.cancel.execute({ bookingId: paid.booking.id, driverId: driverB, reason: null });

    // Never paid, cancelled: the receivable reversed, the waiver with it.
    const driverC = await seedUser(h, 'driver');
    const unpaid = await book(spaceId, driverC, 50, 2);
    await h.sql`UPDATE bookings SET status = 'confirmed' WHERE id = ${unpaid.booking.id}`;
    await stack.cancel.execute({ bookingId: unpaid.booking.id, driverId: driverC, reason: null });

    expect(await unbalancedTxns()).toEqual([]);
    expect(await promoNet(kept.booking.id)).toBe(keptRow?.waiver);
    expect(await promoNet(paid.booking.id)).toBe(0);
    expect(await promoNet(unpaid.booking.id)).toBe(0);
  });

  it('carries the sign in the direction, never in the amount', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    await book(spaceId, h.driverId, 2, 2);

    const [row] = await h.sql<{ bad: string }[]>`
      SELECT count(*)::text AS bad FROM ledger_entries WHERE amount_paise <= 0
    `;
    expect(row?.bad).toBe('0');
  });

  it('refuses an UPDATE and refuses a DELETE', async () => {
    // Append-only is enforced by a trigger and by revoked grants, not by the
    // absence of a method on LedgerService. A correction is a reversing entry
    // (R-MONEY-07).
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    const { booking } = await book(spaceId, h.driverId, 2, 2);

    await expect(
      h.sql`UPDATE ledger_entries SET amount_paise = 1 WHERE booking_id = ${booking.id}`,
    ).rejects.toThrow();

    await expect(
      h.sql`DELETE FROM ledger_entries WHERE booking_id = ${booking.id}`,
    ).rejects.toThrow();
  });

  it('posts the canonical booking as exactly four rows, to the paise', async () => {
    // ₹30/hr × 2 hrs at 1.5× surge. The example every document in this repo
    // uses, asserted against the database rather than against the composer.
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    await h.redis.set(`surge:${await zoneOf(h, spaceId)}`, surgePayload(1.5));

    const { booking } = await book(spaceId, h.driverId, 2, 2);
    h.redis.clear();

    const rows = await h.sql<{ account: string; direction: string; amount_paise: string }[]>`
      SELECT account, direction, amount_paise::text AS amount_paise
      FROM ledger_entries WHERE booking_id = ${booking.id} ORDER BY account
    `;

    expect(rows).toHaveLength(4);
    expect(
      Object.fromEntries(rows.map((r) => [r.account, `${r.direction} ${r.amount_paise}`])),
    ).toEqual({
      driver_receivable: `debit ${String(booking.totalPaise)}`,
      owner_payable: `credit ${String(booking.ownerEarningsPaise)}`,
      platform_revenue: `credit ${String(booking.parkeaseFeePaise)}`,
      gst_payable: `credit ${String(booking.gstPaise)}`,
    });

    // The line that made v1's three modules disagree: the owner's credit is
    // base − 15%, and contains no surge at all.
    expect(booking.ownerEarningsPaise).toBe(
      booking.basePaise - Math.round(booking.basePaise * 0.15),
    );
    expect(booking.parkeaseFeePaise).toBe(
      Math.round(booking.basePaise * 0.15) + booking.surgePremiumPaise,
    );
  });

  it('answers owner earnings from the ledger, and surge never reaches them', async () => {
    const ownerId = h.ownerId;
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 2 });

    const plain = await book(spaceId, h.driverId, 2, 2);
    const withoutSurge = await ownerBalance.forBooking(plain.booking.id);

    await h.redis.set(`surge:${await zoneOf(h, spaceId)}`, surgePayload(1.5));
    const driverB = await seedUser(h, 'driver');
    const surged = await book(spaceId, driverB, 60, 2);
    h.redis.clear();

    const withSurge = await ownerBalance.forBooking(surged.booking.id);

    // Same window, same rate, 1.5× surge on the second — and the owner is due
    // exactly the same. Surge is 100% platform revenue (ADR-009).
    expect(surged.booking.surgePremiumPaise).toBeGreaterThan(0);
    expect(withSurge).toBe(withoutSurge);

    // And the owner-level total is the sum of the two, positive because
    // owner_payable is a liability we owe.
    expect(await ownerBalance.balance(ownerId)).toBe(withoutSurge + withSurge);
  });

  it('nets the owner to nothing when a cancellation reverses the booking', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    const { booking } = await book(spaceId, h.driverId, 2, 2);
    await h.sql`UPDATE bookings SET status = 'confirmed' WHERE id = ${booking.id}`;

    await stack.cancel.execute({ bookingId: booking.id, driverId: h.driverId, reason: null });

    expect(await ownerBalance.forBooking(booking.id)).toBe(0);
    expect(await unbalancedTxns()).toEqual([]);
  });

  it('balances the settlement lifecycle, and clears settlement_clearing to zero (task 16a)', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    const { booking } = await book(spaceId, h.driverId, 2, 2);
    const valet = await seedUser(h, 'valet');
    const oneRate: readonly DatedRate[] = [
      { rate: toRate(0.01), effectiveFrom: '2026-01-01', note: 'test: 1%' },
    ];

    await withTransaction(h.db, async (tx) => {
      const post = (entries: readonly LedgerEntryDraft[], bookingId?: string) =>
        stack.ledger.post(tx, { entries, ...(bookingId === undefined ? {} : { bookingId }) });

      // Route pays the owner at capture, then reconciliation confirms it.
      await post(routeDischargeEntries(booking.ownerEarningsPaise, h.driverId), booking.id);
      await post(settlementClearedEntries(booking.ownerEarningsPaise));

      // A valet earns, is paid with TCS and TDS withheld, and the payout clears.
      await post(valetLegEntries(computeValetLegFee(10_000, toRate(0.2)), valet, 'valet leg'));
      const paid = payoutEntries(toPaise(12_000), valet, new Date(), {
        tcs: oneRate,
        tds: oneRate,
      });
      await post(paid.entries);
      await post(settlementClearedEntries(paid.netPaise));

      // A second payout fails and is reversed: the valet is owed it again.
      await post(valetLegEntries(computeValetLegFee(10_000, toRate(0.2)), valet, 'valet leg'));
      const failed = payoutEntries(toPaise(12_000), valet, new Date());
      await post(failed.entries);
      await post(reverseEntries(failed.entries, 'payout failed'));
    });

    expect(await unbalancedTxns()).toEqual([]);
    expect(await ownerBalance.balance(h.ownerId)).toBe(0);

    const [totals] = await h.sql<{ clearing: string; valet: string; tax: string }[]>`
      SELECT
        coalesce(sum(CASE direction WHEN 'credit' THEN amount_paise ELSE -amount_paise END)
          FILTER (WHERE account = 'settlement_clearing'), 0)::text AS clearing,
        coalesce(sum(CASE direction WHEN 'credit' THEN amount_paise ELSE -amount_paise END)
          FILTER (WHERE account = 'owner_payable' AND counterparty_user_id = ${valet}), 0)::text AS valet,
        coalesce(sum(amount_paise) FILTER (WHERE account IN ('tcs_payable','tds_payable')), 0)::text AS tax
      FROM ledger_entries`;
    expect(totals).toEqual({ clearing: '0', valet: '12000', tax: '240' });
  });

  it('only ever writes accounts that exist in the chart', async () => {
    // The CHECK constraint covers the column; this covers the chart, which is
    // what every balance query reads `normalBalance` from.
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    await book(spaceId, h.driverId, 2, 2);

    const rows = await h.sql<{ account: string }[]>`
      SELECT DISTINCT account FROM ledger_entries
    `;
    const known = new Set<string>(Object.values(LedgerAccount));
    for (const row of rows) expect(known.has(row.account)).toBe(true);
  });
});
