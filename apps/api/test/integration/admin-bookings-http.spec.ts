import { HttpException } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminBookingQueries } from '../../src/domains/booking/admin-booking.queries.js';

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
import { actingAs, type HttpApp, startHttpApp, stopHttpApp } from './http-harness.js';

const BASE = '/api/v1/admin/bookings';

interface Envelope {
  readonly data?: unknown;
  readonly meta?: { readonly page: number; readonly pageSize: number; readonly total: number };
  readonly error?: { readonly code: string; readonly message: string; readonly traceId: string };
}

interface Detail {
  readonly id: string;
  readonly status: string;
  readonly driver: { id: string; name: string | null; phone: string };
  readonly space: { id: string; title: string; ownerName: string | null };
  readonly totalPaise: number;
  readonly ledger: {
    txnId: string;
    account: string;
    direction: string;
    amountPaise: number;
    bookingId: string | null;
    description: string;
  }[];
  readonly payments: { id: string; status: string; amountPaise: number }[];
  readonly refunds: { id: string; amountPaise: number; status: string; reason: string | null }[];
  readonly refundablePaise: number;
  readonly refundOptions: { option: string; amountPaise: number }[];
}

interface ListItem {
  readonly id: string;
  readonly status: string;
  readonly driverName: string | null;
  readonly spaceTitle: string;
  readonly totalPaise: number;
}

const envelope = (r: { body: unknown }): Envelope => r.body as Envelope;
const detailOf = (r: { body: unknown }): Detail => envelope(r).data as Detail;
const errorCode = (r: { body: unknown }): string | undefined => envelope(r).error?.code;

/**
 * Admin booking inspection, cancellation and refund (task 18a), through the real Fastify pipeline
 * against a real database. Every refund assertion reads the money back from the tables: the
 * `refunds` row, the ledger posting, the undispatched outbox message and the audit row. The
 * Razorpay double is `{}`, so a gateway call inside the request would throw — the refund leaves
 * only through the outbox.
 */
describe('admin bookings HTTP', () => {
  let h: Harness;
  let http: HttpApp;
  let stack: BookingStack;
  let adminId: string;

  const asAdmin = () => {
    actingAs.user = { id: adminId, roles: ['admin'], activeRole: 'admin' };
  };

  const write = (url: string, payload: unknown, key: string = crypto.randomUUID()) =>
    http.request({ method: 'POST', url, payload, headers: { 'idempotency-key': key } });
  const read = (url: string) => http.request({ method: 'GET', url });
  const refund = (bookingId: string, payload: unknown, key?: string) =>
    write(`${BASE}/${bookingId}/refund`, payload, key);

  /** A booking the driver paid for in full. `surge` 1.5 over two hours makes it ₹97.02. */
  const paidBooking = async (
    opts: { status?: string; title?: string; hoursAhead?: number } = {},
  ): Promise<{ id: string; totalPaise: number; driverId: string; spaceId: string }> => {
    const spaceId = await seedSpace(h, {
      lat: 12.9345,
      lng: 77.6266,
      carSlots: 1,
      ...(opts.title === undefined ? {} : { title: opts.title }),
    });
    const driverId = await seedUser(h, 'driver');
    await h.redis.set(`surge:${await zoneOf(h, spaceId)}`, surgePayload(1.5));
    const window = windowFromNow(opts.hoursAhead ?? 2, 2);
    const { booking } = await stack.create.execute({
      driverId,
      spaceId,
      vehicleType: 'car',
      durationType: 'hourly',
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      vehicleNumber: 'KA-01-AB-1234',
    });
    h.redis.clear();

    await h.sql`UPDATE bookings SET status = ${opts.status ?? 'completed'} WHERE id = ${booking.id}`;
    // slice(-12): a UUIDv7's leading bits are its timestamp, so two ids minted in the same
    // millisecond would share a prefix and collide on the unique gateway-id index.
    await h.sql`
      INSERT INTO payments (booking_id, user_id, razorpay_order_id, razorpay_payment_id,
                            expected_total_paise, captured_paise, status, captured_at)
      VALUES (${booking.id}, ${driverId}, ${`order_${booking.id.slice(-12)}`},
              ${`pay_${booking.id.slice(-12)}`}, ${booking.totalPaise}, ${booking.totalPaise},
              'captured', now())
    `;
    return { id: booking.id, totalPaise: booking.totalPaise, driverId, spaceId };
  };

  const refundRows = (bookingId: string) =>
    h.sql<{ id: string; amount_paise: number; reason: string | null; status: string }[]>`
      SELECT r.id, r.amount_paise::int AS amount_paise, r.reason, r.status
      FROM refunds r JOIN payments p ON p.id = r.payment_id
      WHERE p.booking_id = ${bookingId}
      ORDER BY r.created_at, r.id`;

  const ledgerCount = async (): Promise<number> => {
    const [row] = await h.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ledger_entries`;
    return row?.n ?? -1;
  };

  /** The `ledger-balance` invariant, table-wide: every txn_id balances. */
  const unbalancedTxns = () =>
    h.sql<{ txn_id: string }[]>`
      SELECT txn_id FROM ledger_entries GROUP BY txn_id
      HAVING coalesce(sum(amount_paise) FILTER (WHERE direction = 'debit'), 0)
          <> coalesce(sum(amount_paise) FILTER (WHERE direction = 'credit'), 0)`;

  const auditRows = (action: string, targetId: string) =>
    h.sql<
      {
        actor_user_id: string;
        actor_role: string;
        target_type: string;
        before: Record<string, unknown> | null;
        after: Record<string, unknown> | null;
        ip_address: string | null;
      }[]
    >`SELECT actor_user_id, actor_role, target_type, before, after, ip_address
        FROM audit_log WHERE action = ${action} AND target_id = ${targetId}`;

  const outboxRows = (type: string) =>
    h.sql<{ payload: Record<string, unknown>; status: string; dispatched_at: Date | null }[]>`
      SELECT payload, status, dispatched_at FROM outbox_messages WHERE type = ${type}`;

  beforeAll(async () => {
    h = await startHarness();
    http = await startHttpApp(h);
    stack = buildBookingStack(h);
    adminId = await seedUser(h, 'admin');
  }, 300_000);

  afterAll(async () => {
    await stopHttpApp(http);
    await stopHarness(h);
  });

  beforeEach(async () => {
    // CASCADE takes payments, refunds and ledger_entries with the bookings.
    await truncateSpaces(h);
    await h.sql`TRUNCATE audit_log, idempotency_keys, outbox_messages`;
    await h.sql`TRUNCATE commission_waivers`;
    asAdmin();
  });

  describe('inspection', () => {
    it('lists bookings with the driver and space, filtered by status and text', async () => {
      const done = await paidBooking({ title: 'Koramangala Basement' });
      const live = await paidBooking({
        status: 'confirmed',
        title: 'Indiranagar Lot',
        hoursAhead: 6,
      });

      const all = await read(BASE);
      expect(all.status).toBe(200);
      expect(envelope(all).meta).toMatchObject({ page: 1, total: 2 });
      const items = envelope(all).data as ListItem[];
      expect(items.map((i) => i.id).sort()).toEqual([done.id, live.id].sort());
      expect(items.find((i) => i.id === done.id)).toMatchObject({
        status: 'completed',
        spaceTitle: 'Koramangala Basement',
        totalPaise: 9702,
      });

      const confirmed = envelope(await read(`${BASE}?status=confirmed`)).data as ListItem[];
      expect(confirmed.map((i) => i.id)).toEqual([live.id]);

      const byTitle = envelope(await read(`${BASE}?q=koramangala`)).data as ListItem[];
      expect(byTitle.map((i) => i.id)).toEqual([done.id]);

      const byId = envelope(await read(`${BASE}?q=${live.id}`)).data as ListItem[];
      expect(byId.map((i) => i.id)).toEqual([live.id]);
    });

    it("returns the booking's own ledger rows, a masked phone and the refund options", async () => {
      const booking = await paidBooking();

      const response = await read(`${BASE}/${booking.id}`);
      expect(response.status).toBe(200);
      const detail = detailOf(response);

      expect(detail.totalPaise).toBe(9702);
      expect(detail.refundablePaise).toBe(9702);
      expect(detail.refundOptions).toEqual([
        { option: 'full_minus_fee', amountPaise: 8702 },
        { option: 'half', amountPaise: 4851 },
      ]);
      expect(detail.payments).toEqual([
        expect.objectContaining({ status: 'captured', amountPaise: 9702 }),
      ]);
      expect(detail.driver.id).toBe(booking.driverId);
      expect(detail.driver.phone).toMatch(/^\+91 \d+\*\*\*\d+$/);

      // The receivable posting from booking creation, and nothing that is not this booking's.
      expect(detail.ledger.length).toBeGreaterThanOrEqual(4);
      expect(detail.ledger.every((e) => e.bookingId === booking.id)).toBe(true);
      const debit = detail.ledger.find(
        (e) => e.account === 'driver_receivable' && e.direction === 'debit',
      );
      expect(debit?.amountPaise).toBe(9702);
    });

    it('offers no options on a live booking: cancelling is its refund', async () => {
      const booking = await paidBooking({ status: 'confirmed' });
      const detail = detailOf(await read(`${BASE}/${booking.id}`));
      expect(detail.refundablePaise).toBe(9702);
      expect(detail.refundOptions).toEqual([]);
    });

    it('answers 404 for a booking that does not exist', async () => {
      const response = await read(`${BASE}/${crypto.randomUUID()}`);
      expect(response.status).toBe(404);
    });
  });

  describe('refund', () => {
    it('a failed re-read after the refund commits is not a 500, and a retry does not refund again', async () => {
      const booking = await paidBooking();
      const queries = http.app.get(AdminBookingQueries);
      const detail = vi.spyOn(queries, 'detail').mockRejectedValueOnce(new Error('read failed'));
      const key = crypto.randomUUID();

      const first = await refund(booking.id, { option: 'half', reason: 'flooded' }, key);
      expect(first.status).toBe(200);
      detail.mockRestore();

      const retry = await refund(booking.id, { option: 'half', reason: 'flooded' }, key);
      expect(retry.status).toBe(200);
      const [row] = await h.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM refunds r JOIN payments p ON p.id = r.payment_id
        WHERE p.booking_id = ${booking.id}`;
      expect(row?.n).toBe(1);
    });

    it('posts full_minus_fee ledger-first, then refuses 1001 and takes the last 1000', async () => {
      const booking = await paidBooking();

      const first = await refund(booking.id, { option: 'full_minus_fee', reason: 'spot flooded' });
      expect(first.status).toBe(200);
      expect(detailOf(first).refundablePaise).toBe(1000);
      expect(detailOf(first).refundOptions).toEqual([{ option: 'half', amountPaise: 500 }]);

      const rows = await refundRows(booking.id);
      expect(rows).toEqual([
        expect.objectContaining({ amount_paise: 8702, reason: 'admin', status: 'pending' }),
      ]);

      // The refund's own posting balances, and credits the driver's refund liability in full.
      const posting = await h.sql<{ account: string; direction: string; amount_paise: number }[]>`
        SELECT account, direction, amount_paise::int AS amount_paise
        FROM ledger_entries WHERE booking_id = ${booking.id} AND description = 'refund: admin'`;
      const sum = (direction: string) =>
        posting.filter((e) => e.direction === direction).reduce((s, e) => s + e.amount_paise, 0);
      expect(sum('debit')).toBe(8702);
      expect(sum('credit')).toBe(8702);
      expect(posting).toContainEqual({
        account: 'refunds_payable',
        direction: 'credit',
        amount_paise: 8702,
      });

      // Undispatched: the gateway is the worker's job, after commit.
      const messages = await outboxRows('payment.issue-refund');
      expect(messages).toHaveLength(1);
      expect(messages[0]?.dispatched_at).toBeNull();
      expect(messages[0]?.payload).toEqual({
        refundId: rows[0]?.id,
        paymentId: detailOf(first).payments[0]?.id,
        bookingId: booking.id,
        razorpayPaymentId: `pay_${booking.id.slice(-12)}`,
        amountPaise: 8702,
      });

      const audits = await auditRows('booking.refund', booking.id);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        actor_user_id: adminId,
        actor_role: 'admin',
        target_type: 'booking',
        before: { refundedPaise: 0 },
        after: {
          refundedPaise: 8702,
          amountPaise: 8702,
          option: 'full_minus_fee',
          reason: 'spot flooded',
        },
      });
      expect(audits[0]?.ip_address).not.toBeNull();

      // Over the balance: a domain refusal, and nothing written.
      const ledgerBefore = await ledgerCount();
      const over = await refund(booking.id, { option: 'custom', amountPaise: 1001, reason: 'x' });
      expect(over.status).toBe(422);
      expect(errorCode(over)).toBe('REFUND_EXCEEDS_BALANCE');
      expect(await ledgerCount()).toBe(ledgerBefore);
      expect(await refundRows(booking.id)).toHaveLength(1);
      expect(await auditRows('booking.refund', booking.id)).toHaveLength(1);

      const last = await refund(booking.id, {
        option: 'custom',
        amountPaise: 1000,
        reason: 'rest',
      });
      expect(last.status).toBe(200);
      expect(detailOf(last).refundablePaise).toBe(0);
      expect(detailOf(last).refundOptions).toEqual([]);
      expect(detailOf(last).payments[0]?.status).toBe('refunded');
      expect((await refundRows(booking.id)).map((r) => r.amount_paise)).toEqual([8702, 1000]);

      expect(await unbalancedTxns()).toEqual([]);
    });

    it('refunds once for the same Idempotency-Key sent twice', async () => {
      const booking = await paidBooking();
      const key = crypto.randomUUID();
      const body = { option: 'half', reason: 'late arrival' };

      const first = await refund(booking.id, body, key);
      expect(first.status).toBe(200);
      // The interceptor stores the response detached from the request (learnings.md).
      await vi.waitFor(async () => {
        const [row] = await h.sql<{ response_status: number | null }[]>`
          SELECT response_status FROM idempotency_keys WHERE key = ${key}`;
        expect(row?.response_status).toBe(200);
      });

      const replay = await refund(booking.id, body, key);
      expect(replay.status).toBe(200);
      expect(replay.body).toEqual(first.body);
      expect(await refundRows(booking.id)).toHaveLength(1);
      expect(await outboxRows('payment.issue-refund')).toHaveLength(1);
    });

    it('serialises two concurrent refunds: one lands, the other sees it and is refused', async () => {
      const booking = await paidBooking();
      expect(booking.totalPaise).toBe(9702);

      const body = (reason: string) => ({ option: 'custom', amountPaise: 6000, reason });
      const responses = await Promise.all([
        refund(booking.id, body('agent one')),
        refund(booking.id, body('agent two')),
      ]);

      expect(responses.map((r) => r.status).sort()).toEqual([200, 422]);
      expect(errorCode(responses.find((r) => r.status === 422) ?? { body: null })).toBe(
        'REFUND_EXCEEDS_BALANCE',
      );

      const rows = await refundRows(booking.id);
      expect(rows.map((r) => r.amount_paise)).toEqual([6000]);
      expect(rows.reduce((s, r) => s + r.amount_paise, 0)).toBeLessThanOrEqual(9702);
      expect(await auditRows('booking.refund', booking.id)).toHaveLength(1);
      expect(await unbalancedTxns()).toEqual([]);
    });

    it('refuses a live booking, an unpaid one and a missing one, writing nothing', async () => {
      const live = await paidBooking({ status: 'confirmed' });
      const liveRefund = await refund(live.id, { option: 'half', reason: 'x' });
      expect(liveRefund.status).toBe(409);
      expect(errorCode(liveRefund)).toBe('BOOKING_NOT_SETTLED');

      const unpaid = await paidBooking({ hoursAhead: 8 });
      await h.sql`DELETE FROM payments WHERE booking_id = ${unpaid.id}`;
      const unpaidRefund = await refund(unpaid.id, { option: 'half', reason: 'x' });
      expect(unpaidRefund.status).toBe(409);
      expect(errorCode(unpaidRefund)).toBe('NO_CAPTURED_PAYMENT');

      const missing = await refund(crypto.randomUUID(), { option: 'half', reason: 'x' });
      expect(missing.status).toBe(404);

      expect(await h.sql`SELECT 1 FROM refunds`).toHaveLength(0);
      expect(await h.sql`SELECT 1 FROM audit_log WHERE action = 'booking.refund'`).toHaveLength(0);
    });

    it('nothing is refundable after a cancellation that reversed the booking in full', async () => {
      const booking = await paidBooking({ status: 'confirmed', hoursAhead: 12 });
      // A driver cancelling before the start: the ₹10 tier, a full reversal.
      await stack.cancel.execute({
        bookingId: booking.id,
        reason: null,
        by: { kind: 'driver', driverId: booking.driverId },
      });

      const detail = detailOf(await read(`${BASE}/${booking.id}`));
      expect(detail.status).toBe('cancelled');
      expect(detail.refundablePaise).toBe(0);
      expect(detail.refundOptions).toEqual([]);

      const response = await refund(booking.id, {
        option: 'custom',
        amountPaise: 1000,
        reason: 'x',
      });
      expect(response.status).toBe(422);
      expect(errorCode(response)).toBe('REFUND_EXCEEDS_BALANCE');
    });

    it('answers 400 VALIDATION_FAILED to a malformed body', async () => {
      const booking = await paidBooking();
      const noReason = await refund(booking.id, { option: 'half' });
      expect(noReason.status).toBe(400);
      expect(errorCode(noReason)).toBe('VALIDATION_FAILED');

      const zero = await refund(booking.id, { option: 'custom', amountPaise: 0, reason: 'x' });
      expect(zero.status).toBe(400);
      // A preset never carries a client amount; an extra field is stripped, not obeyed.
      const sneaky = await refund(booking.id, { option: 'half', amountPaise: 9702, reason: 'x' });
      expect(sneaky.status).toBe(200);
      expect(await refundRows(booking.id)).toEqual([
        expect.objectContaining({ amount_paise: 4851 }),
      ]);
    });

    it('is admin-only', async () => {
      const booking = await paidBooking();
      actingAs.user = { id: booking.driverId, roles: ['driver'], activeRole: 'driver' };
      const response = await refund(booking.id, { option: 'half', reason: 'x' });
      expect(response.status).toBe(403);
      expect(await refundRows(booking.id)).toHaveLength(0);
    });
  });

  describe('cancel', () => {
    it('cancels a confirmed booking at the admin tier, audited in the same transaction', async () => {
      const booking = await paidBooking({ status: 'confirmed', hoursAhead: 12 });

      const response = await write(`${BASE}/${booking.id}/cancel`, { reason: 'owner unreachable' });
      expect(response.status).toBe(200);
      expect(detailOf(response).status).toBe('cancelled');

      // Not the driver's fault: refunded in full, at the tier admin and owner share.
      expect(await refundRows(booking.id)).toEqual([
        expect.objectContaining({ amount_paise: 9702, reason: 'owner_cancelled' }),
      ]);
      const [cancelled] = await outboxRows('booking.cancelled');
      expect(cancelled?.payload).toMatchObject({
        bookingId: booking.id,
        refundTier: 'owner_cancelled',
        refundPaise: 9702,
        reason: 'owner unreachable',
      });

      const audits = await auditRows('booking.cancel', booking.id);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        actor_user_id: adminId,
        actor_role: 'admin',
        target_type: 'booking',
        before: { status: 'confirmed' },
        after: {
          status: 'cancelled',
          reason: 'owner unreachable',
          refundPaise: 9702,
          refundTier: 'owner_cancelled',
        },
      });

      // Cancelling again is an illegal transition, and writes no second audit row.
      const again = await write(`${BASE}/${booking.id}/cancel`, { reason: 'twice' });
      expect(again.status).toBe(409);
      expect(await auditRows('booking.cancel', booking.id)).toHaveLength(1);
      expect(await refundRows(booking.id)).toHaveLength(1);
      expect(await unbalancedTxns()).toEqual([]);
    });

    it('answers 404 for a booking that does not exist, and needs a reason', async () => {
      const missing = await write(`${BASE}/${crypto.randomUUID()}/cancel`, { reason: 'x' });
      expect(missing.status).toBe(404);

      const booking = await paidBooking({ status: 'confirmed' });
      const noReason = await write(`${BASE}/${booking.id}/cancel`, {});
      expect(noReason.status).toBe(400);
      expect(errorCode(noReason)).toBe('VALIDATION_FAILED');
    });
  });

  /**
   * A booking is cancelled once, whoever asks and however many times at once. Each race runs ten
   * times on a fresh booking: one lucky interleaving that happens to serialise proves nothing.
   */
  describe('cancel races', () => {
    const RUNS = 10;

    /** One refund row, one cancellation posting, one `booking.cancelled` message. */
    const expectCancelledOnce = async (bookingId: string) => {
      expect(await refundRows(bookingId)).toHaveLength(1);
      const postings = await h.sql<{ txn_id: string }[]>`
        SELECT DISTINCT txn_id FROM ledger_entries
        WHERE booking_id = ${bookingId} AND description LIKE 'refund: %'`;
      expect(postings).toHaveLength(1);
      const cancelled = await h.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM outbox_messages
        WHERE type = 'booking.cancelled' AND payload->>'bookingId' = ${bookingId}`;
      expect(cancelled[0]?.n).toBe(1);
      const [row] = await h.sql<
        { status: string }[]
      >`SELECT status FROM bookings WHERE id = ${bookingId}`;
      expect(row?.status).toBe('cancelled');
    };

    const statusOf = (outcome: PromiseSettledResult<unknown>): number => {
      if (outcome.status === 'fulfilled') return 200;
      return outcome.reason instanceof HttpException ? outcome.reason.getStatus() : 500;
    };

    it('driver and admin cancelling together: one cancels, the other is refused 409', async () => {
      for (let run = 0; run < RUNS; run += 1) {
        const booking = await paidBooking({ status: 'confirmed', hoursAhead: 12 });

        const outcomes = await Promise.allSettled([
          stack.cancel.execute({
            bookingId: booking.id,
            reason: null,
            by: { kind: 'driver', driverId: booking.driverId },
          }),
          stack.cancel.execute({
            bookingId: booking.id,
            reason: 'admin',
            by: { kind: 'admin', actor: { userId: adminId, ipAddress: null } },
          }),
        ]);

        expect(outcomes.map(statusOf).sort()).toEqual([200, 409]);
        await expectCancelledOnce(booking.id);
        // The audit row exists exactly when the admin's cancel was the one that landed.
        const adminWon = outcomes[1]?.status === 'fulfilled';
        expect(await auditRows('booking.cancel', booking.id)).toHaveLength(adminWon ? 1 : 0);
      }
      expect(await unbalancedTxns()).toEqual([]);
    });

    it('two driver cancels with different keys: one 201, one 409', async () => {
      for (let run = 0; run < RUNS; run += 1) {
        const booking = await paidBooking({ status: 'confirmed', hoursAhead: 12 });
        actingAs.user = { id: booking.driverId, roles: ['driver'], activeRole: 'driver' };

        const url = `/api/v1/driver/bookings/${booking.id}/cancel`;
        const responses = await Promise.all([write(url, {}), write(url, {})]);

        expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
        await expectCancelledOnce(booking.id);
      }
      expect(await unbalancedTxns()).toEqual([]);
    });
  });

  describe('cancel refunds the parking payment, never a wash on the same booking', () => {
    it.each(['driver', 'admin'] as const)('%s cancel', async (kind) => {
      const booking = await paidBooking({ status: 'active', hoursAhead: 12 });
      const [parking] = await h.sql<{ id: string }[]>`
        SELECT id FROM payments WHERE booking_id = ${booking.id}`;

      // A wash bought on the same booking and captured AFTER the parking: the newest capture.
      const [job] = await h.sql<{ id: string }[]>`
        INSERT INTO wash_jobs (booking_id, driver_user_id, status, service_name, vehicle_type,
                               space_location, commission_rate)
        VALUES (${booking.id}, ${booking.driverId}, 'offered', 'premium_wash', 'car',
                ST_SetSRID(ST_MakePoint(77.6266, 12.9345), 4326)::geography, 0.200)
        RETURNING id`;
      await h.sql`
        INSERT INTO payments (booking_id, user_id, razorpay_order_id, razorpay_payment_id,
                              expected_total_paise, captured_paise, status, captured_at,
                              purpose, wash_job_id)
        VALUES (${booking.id}, ${booking.driverId}, ${`order_w_${booking.id.slice(-12)}`},
                ${`pay_w_${booking.id.slice(-12)}`}, 39900, 39900, 'captured',
                now() + interval '1 minute', 'carwash', ${job?.id ?? null})`;

      await stack.cancel.execute({
        bookingId: booking.id,
        reason: null,
        by:
          kind === 'driver'
            ? { kind: 'driver', driverId: booking.driverId }
            : { kind: 'admin', actor: { userId: adminId, ipAddress: null } },
      });

      const refunds = await h.sql<{ payment_id: string; amount_paise: number }[]>`
        SELECT r.payment_id, r.amount_paise::int AS amount_paise
        FROM refunds r JOIN payments p ON p.id = r.payment_id
        WHERE p.booking_id = ${booking.id}`;
      expect(refunds).toHaveLength(1);
      expect(refunds[0]?.payment_id).toBe(parking?.id);
      const [issue] = await outboxRows('payment.issue-refund');
      expect(issue?.payload).toMatchObject({
        paymentId: parking?.id,
        razorpayPaymentId: `pay_${booking.id.slice(-12)}`,
      });
    });
  });

  /**
   * A second parking payment that `reconcile-orphan.job.ts` already refunded in full — a late
   * capture on a failed order, or the loser of two concurrent create-order calls. Its capture is
   * the NEWEST on the booking, so a "latest capture" lookup picks it; none of these may.
   */
  describe('an orphan-refunded payment on the same booking', () => {
    const addOrphan = async (bookingId: string, driverId: string): Promise<string> => {
      const [orphan] = await h.sql<{ id: string }[]>`
        INSERT INTO payments (booking_id, user_id, razorpay_order_id, razorpay_payment_id,
                              expected_total_paise, captured_paise, status, captured_at)
        VALUES (${bookingId}, ${driverId}, ${`order_o_${bookingId.slice(-12)}`},
                ${`pay_o_${bookingId.slice(-12)}`}, 9702, 9702, 'refunded',
                now() + interval '1 minute')
        RETURNING id`;
      if (orphan === undefined) throw new Error('failed to seed orphan payment');
      await h.sql`
        INSERT INTO refunds (payment_id, amount_paise, reason, status)
        VALUES (${orphan.id}, 9702, 'orphan_capture', 'pending')`;
      return orphan.id;
    };

    const realPaymentOf = async (bookingId: string): Promise<string | undefined> => {
      const [row] = await h.sql<{ id: string }[]>`
        SELECT id FROM payments WHERE booking_id = ${bookingId} AND status <> 'refunded'
        ORDER BY created_at LIMIT 1`;
      return row?.id;
    };

    const nonOrphanRefunds = (bookingId: string) =>
      h.sql<{ payment_id: string; amount_paise: number; reason: string }[]>`
        SELECT r.payment_id, r.amount_paise::int AS amount_paise, r.reason
        FROM refunds r JOIN payments p ON p.id = r.payment_id
        WHERE p.booking_id = ${bookingId} AND r.reason <> 'orphan_capture'`;

    it('driver cancel answers 201 and refunds the real captured payment', async () => {
      const booking = await paidBooking({ status: 'confirmed', hoursAhead: 12 });
      const real = await realPaymentOf(booking.id);
      await addOrphan(booking.id, booking.driverId);

      actingAs.user = { id: booking.driverId, roles: ['driver'], activeRole: 'driver' };
      const response = await write(`/api/v1/driver/bookings/${booking.id}/cancel`, {});
      expect(response.status).toBe(201);

      const rows = await nonOrphanRefunds(booking.id);
      expect(rows).toEqual([{ payment_id: real, amount_paise: 8702, reason: 'before_start' }]);
      expect(await unbalancedTxns()).toEqual([]);
    });

    it('admin refund on a completed booking still offers, and takes, the full balance', async () => {
      const booking = await paidBooking();
      const real = await realPaymentOf(booking.id);
      await addOrphan(booking.id, booking.driverId);

      const detail = detailOf(await read(`${BASE}/${booking.id}`));
      expect(detail.refundablePaise).toBe(9702);
      expect(detail.refundOptions).toEqual([
        { option: 'full_minus_fee', amountPaise: 8702 },
        { option: 'half', amountPaise: 4851 },
      ]);

      const response = await refund(booking.id, { option: 'full_minus_fee', reason: 'flooded' });
      expect(response.status).toBe(200);
      expect(await nonOrphanRefunds(booking.id)).toEqual([
        { payment_id: real, amount_paise: 8702, reason: 'admin' },
      ]);
      expect(detailOf(response).refundablePaise).toBe(1000);
    });
  });
});
