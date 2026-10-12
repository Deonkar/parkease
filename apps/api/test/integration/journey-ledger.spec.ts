import { MINIMUM_PAYOUT_PAISE } from '@parkease/contracts/money';
import { uuidv7 } from '@parkease/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { JobDeps } from '../../../worker/src/deps.js';
import { runWeeklyPayouts } from '../../../worker/src/jobs/payout/run-weekly.job.js';

import { type BookingStack, buildBookingStack, windowFromNow } from './booking-harness.js';
import {
  type Harness,
  HOURLY_ONLY,
  OPEN_ALWAYS,
  seedSpace,
  seedUser,
  startHarness,
  stopHarness,
} from './harness.js';
import { actingAs, type HttpApp, startHttpApp, stopHttpApp } from './http-harness.js';

/**
 * §21.2 (S-155): zero unbalanced `txn_id`s after the whole journey — bookings, valet, car wash,
 * an admin refund and a payout run — each through its real command, route or job, on one
 * database. `ledger-balance.spec.ts` covers the booking flows and posts the valet and payout
 * compositions directly; this drives the rest of the system the way production does.
 */
describe('the ledger after a full journey', () => {
  let h: Harness;
  let http: HttpApp;
  let stack: BookingStack;
  let spaceId: string;

  const SPACE = { lat: 12.9352, lng: 77.6245 };

  beforeAll(async () => {
    h = await startHarness();
    http = await startHttpApp(h);
    stack = buildBookingStack(h);
    spaceId = await seedSpace(h, {
      ...SPACE,
      pricing: HOURLY_ONLY,
      schedule: OPEN_ALWAYS,
      carSlots: 6,
    });
  }, 300_000);

  afterAll(async () => {
    await stopHttpApp(http);
    await stopHarness(h);
  });

  const as = (id: string, role: string) => {
    actingAs.user = { id, roles: [role], activeRole: role };
  };

  const post = async (url: string, payload: unknown) => {
    const res = await http.request({
      method: 'POST',
      url: `/api/v1${url}`,
      headers: { 'idempotency-key': uuidv7() },
      payload,
    });
    if (res.status >= 300) throw new Error(`${url} answered ${String(res.status)}`);
    return (res.body as { data: { id: string } }).data;
  };

  let hoursAhead = 1;
  /** A booking of the harness driver's, created by the real command, in `status`. */
  const booking = async (status: string): Promise<string> => {
    const window = windowFromNow(hoursAhead, 2);
    hoursAhead += 3;
    const { booking: created } = await stack.create.execute({
      driverId: h.driverId,
      spaceId,
      vehicleType: 'car',
      durationType: 'hourly',
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      vehicleNumber: 'KA-01-AB-1234',
    });
    await h.sql`UPDATE bookings SET status = ${status} WHERE id = ${created.id}`;
    return created.id;
  };

  const unbalancedTxns = () =>
    h.sql<{ txn_id: string }[]>`
      SELECT txn_id FROM ledger_entries GROUP BY txn_id
      HAVING coalesce(sum(amount_paise) FILTER (WHERE direction = 'debit'), 0)
          <> coalesce(sum(amount_paise) FILTER (WHERE direction = 'credit'), 0)`;

  it('balances every txn_id after valet, car wash, an admin refund and a payout run', async () => {
    // Valet: a verified valet nearby accepts three jobs. The driver cancels the first two after
    // dispatch, which frees the valet and leaves them the call-out (the cancellation posting).
    // No Linked Account, so the weekly RazorpayX run pays them.
    const valetId = await seedUser(h, 'valet');
    await h.sql`
      INSERT INTO valet_profiles (user_id, verification_status, is_online, last_seen_at,
                                  current_location, rating_count)
      VALUES (${valetId}, 'verified', true, now(),
              ST_SetSRID(ST_MakePoint(77.6250, 12.9360), 4326)::geography, 0)`;
    for (let i = 0; i < 3; i += 1) {
      const bookingId = await booking('confirmed');
      as(h.driverId, 'driver');
      const job = await post('/driver/valet/requests', {
        bookingId,
        pickup: { ...SPACE, address: 'Forum Mall, Koramangala' },
      });
      as(valetId, 'valet');
      await post(`/valet/jobs/${job.id}/accept`, { from: { lat: 12.9361, lng: 77.6229 } });
      if (i < 2) {
        as(h.driverId, 'driver');
        await post(`/driver/valet/requests/${job.id}/cancel`, {});
      }
    }

    // Car wash: an onboarded partner accepts a wash on an active booking.
    const washerId = await seedUser(h, 'washer');
    await h.sql`
      INSERT INTO washer_profiles (user_id, partner_type, verification_status, is_online,
                                   last_seen_at, current_location, rating_count)
      VALUES (${washerId}, 'gig', 'verified', true, now(),
              ST_SetSRID(ST_MakePoint(77.6290, 12.9352), 4326)::geography, 0)`;
    await h.sql`
      INSERT INTO wash_services (washer_user_id, service_name, vehicle_type, price_paise,
                                 duration_minutes)
      VALUES (${washerId}, 'premium_wash', 'car', 39900, 40)`;
    await h.sql`
      INSERT INTO linked_accounts (user_id, razorpay_account_id, kyc_status)
      VALUES (${washerId}, ${`acc_${washerId.slice(-12)}`}, 'activated')`;
    const washBooking = await booking('active');
    as(h.driverId, 'driver');
    const wash = await post('/driver/carwash/requests', {
      bookingId: washBooking,
      serviceName: 'premium_wash',
      vehicleType: 'car',
    });
    as(washerId, 'washer');
    await post(`/washer/jobs/${wash.id}/accept`, {});

    // Admin refund: half of a completed, captured booking.
    const refunded = await booking('completed');
    const [total] = await h.sql<{ total: number }[]>`
      SELECT total_paise::int AS total FROM bookings WHERE id = ${refunded}`;
    await h.sql`
      INSERT INTO payments (booking_id, user_id, razorpay_order_id, razorpay_payment_id,
                            expected_total_paise, captured_paise, status, captured_at)
      VALUES (${refunded}, ${h.driverId}, ${`order_${refunded.slice(-12)}`},
              ${`pay_${refunded.slice(-12)}`}, ${total?.total ?? 0}, ${total?.total ?? 0},
              'captured', now())`;
    as(await seedUser(h, 'admin'), 'admin');
    await post(`/admin/bookings/${refunded}/refund`, { option: 'half', reason: 'flooded bay' });

    // Payout: the real weekly job pays the valet their whole balance through RazorpayX.
    await h.sql`
      INSERT INTO bank_details (user_id, account_number_encrypted, ifsc_encrypted,
                                account_holder_name, last4, ifsc_prefix,
                                razorpayx_contact_id, razorpayx_fund_account_id)
      VALUES (${valetId}, 'x.y.z', 'x.y.z', 'Valet', '6789', 'HDFC', 'cont_journey',
              'fa_journey')`;
    const [owed] = await h.sql<{ net: number }[]>`
      SELECT coalesce(sum(CASE direction WHEN 'credit' THEN amount_paise ELSE -amount_paise END),
                      0)::int AS net
      FROM ledger_entries WHERE account = 'owner_payable' AND counterparty_user_id = ${valetId}`;
    expect(owed?.net ?? 0).toBeGreaterThanOrEqual(MINIMUM_PAYOUT_PAISE);
    await runWeeklyPayouts({ db: h.db, boss: {}, redis: {} } as unknown as JobDeps, {
      accountNumber: '2323230000000001',
      now: new Date(),
    });

    // Every flow actually posted something, and nothing anywhere is one-sided.
    const [counts] = await h.sql<
      { valet: number; wash: number; refunds: number; payouts: number }[]
    >`
      SELECT (SELECT count(*)::int FROM valet_jobs WHERE txn_id IS NOT NULL) AS valet,
             (SELECT count(*)::int FROM wash_jobs WHERE txn_id IS NOT NULL) AS wash,
             (SELECT count(*)::int FROM refunds) AS refunds,
             (SELECT count(*)::int FROM payouts WHERE user_id = ${valetId}) AS payouts`;
    expect(counts).toEqual({ valet: 3, wash: 1, refunds: 1, payouts: 1 });
    expect(await unbalancedTxns()).toEqual([]);
  });
});
