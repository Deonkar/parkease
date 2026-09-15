import { createHmac } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { type BookingStack, buildBookingStack, windowFromNow } from './booking-harness.js';
import { type Harness, seedSpace, startHarness, stopHarness, truncateSpaces } from './harness.js';
import { actingAs, type HttpApp, startHttpApp, stopHttpApp } from './http-harness.js';

const WEBHOOK_URL = '/api/v1/webhooks/razorpay';
const WEBHOOK_SECRET = 'fake_webhook_secret_000';
const ORDER_ID = 'order_QK7xVv9pLm2Zab';
const GATEWAY_PAYMENT_ID = 'pay_QK7xVv9pLm2Zab';

const sign = (body: string): string =>
  createHmac('sha256', WEBHOOK_SECRET).update(Buffer.from(body, 'utf8')).digest('hex');

/** Spaced the way a sender might emit it, so a round trip is detectable. */
const capturedBody = (amountPaise: number): string =>
  `{"entity": "event", "event": "payment.captured", "payload": {"payment": {"entity": ` +
  `{"id": "${GATEWAY_PAYMENT_ID}", "order_id": "${ORDER_ID}", "amount": ${String(amountPaise)}, ` +
  `"currency": "INR", "status": "captured", "method": "upi"}}}}`;

/**
 * The webhook, driven end to end through the real Fastify pipeline: the same
 * content-type parser `main.ts` registers, the real controller, the real
 * exception filter, the real idempotency table.
 *
 * None of this is reachable from a test that calls `WebhookService` directly.
 * The parser is the whole point — a signature verified against bytes a test
 * handed the service proves nothing about bytes that came off a socket.
 */
describe('razorpay webhook over HTTP', () => {
  let h: Harness;
  let http: HttpApp;
  let stack: BookingStack;
  const razorpay = {
    fetchOrder: vi.fn(),
    createOrder: vi.fn(),
    createRefund: vi.fn(),
    findRefundByReference: vi.fn(),
  };

  beforeAll(async () => {
    h = await startHarness();
    http = await startHttpApp(h, razorpay);
    stack = buildBookingStack(h);
  }, 300_000);

  afterAll(async () => {
    await stopHttpApp(http);
    await stopHarness(h);
  });

  beforeEach(async () => {
    await truncateSpaces(h);
    await h.sql`TRUNCATE idempotency_keys`;
    await h.sql`TRUNCATE outbox_messages`;
    await h.sql`TRUNCATE audit_log`;
    await h.sql`DELETE FROM payments`;
    vi.clearAllMocks();
  });

  const post = (body: string, headers: Record<string, string> = {}) =>
    http.request({ method: 'POST', url: WEBHOOK_URL, rawPayload: body, headers });

  describe('signature, over the exact bytes', () => {
    const body = capturedBody(9702);

    it('rejects an absent signature with 401', async () => {
      expect((await post(body)).status).toBe(401);
    });

    it('rejects one altered byte of the body with 401', async () => {
      const signature = sign(body);
      const tampered = body.replace('9702', '9701');

      expect((await post(tampered, { 'x-razorpay-signature': signature })).status).toBe(401);
    });

    it('rejects one altered character of the signature with 401', async () => {
      const signature = sign(body);
      const tampered = `${signature.slice(0, -1)}${signature.endsWith('a') ? 'b' : 'a'}`;

      expect((await post(body, { 'x-razorpay-signature': tampered })).status).toBe(401);
    });

    it('rejects a non-hex signature with 401, not a 500 from timingSafeEqual', async () => {
      // The distinction the status code makes: 401 means we rejected it, 500
      // means it crashed us. `timingSafeEqual` throws on a length mismatch, so
      // this is one line of defensive code away from being an outage.
      const response = await post(body, { 'x-razorpay-signature': 'not-hex-at-all' });

      expect(response.status).toBe(401);
    });

    it('rejects the same JSON re-serialised — the v1 bug, over the wire', async () => {
      // v1 verified against JSON.stringify(req.body). This request carries a
      // valid signature for the original bytes and a body that means the same
      // thing; anything reading the parsed object instead of the raw buffer
      // accepts it.
      const reserialised = JSON.stringify(JSON.parse(body));
      expect(reserialised).not.toBe(body);

      const response = await post(reserialised, { 'x-razorpay-signature': sign(body) });
      expect(response.status).toBe(401);
    });

    it('accepts a correct signature over the original bytes', async () => {
      // No local payment row, so nothing is confirmed — but the signature
      // passed, which is what this asserts. A 401 here would mean the parser
      // never kept the bytes.
      const response = await post(body, { 'x-razorpay-signature': sign(body) });

      expect(response.status).toBe(200);
    });

    it('leaves ordinary routes parsing their bodies normally', async () => {
      // `rawBody: true` wraps the JSON parser for every route, so the risk it
      // introduces is not to the webhook — it is to everything else. A route
      // that validates its body must still see a parsed object, and answer 400
      // for a bad field rather than 500 from a body it could not read.
      actingAs.user = { id: h.driverId, roles: ['driver'], activeRole: 'driver' };

      const other = await http.request({
        method: 'POST',
        url: '/api/v1/driver/bookings',
        payload: { spaceId: 'not-a-uuid' },
        headers: { 'idempotency-key': crypto.randomUUID() },
      });

      actingAs.user = null;
      expect(other.status).toBe(400);
    });
  });

  describe('the idempotency interceptor', () => {
    it('does not demand an Idempotency-Key header from Razorpay', async () => {
      // The global interceptor 400s every other non-GET request without a UUID
      // header. Razorpay sends no such header, so an unexempted route would
      // reject every event before the controller ever ran.
      const body = capturedBody(9702);
      const response = await post(body, { 'x-razorpay-signature': sign(body) });

      expect(response.status).not.toBe(400);
    });

    it('still demands one on a driver route', async () => {
      const response = await http.request({
        method: 'POST',
        url: '/api/v1/driver/bookings',
        payload: {},
      });

      expect(response.status).toBe(400);
    });
  });

  describe('deduplication', () => {
    const body = capturedBody(9702);

    it('claims the event id and answers a redelivery without re-running', async () => {
      const headers = { 'x-razorpay-signature': sign(body), 'x-razorpay-event-id': 'evt_dedup_1' };

      expect((await post(body, headers)).status).toBe(200);
      expect((await post(body, headers)).status).toBe(200);
      expect((await post(body, headers)).status).toBe(200);

      const rows = await h.sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM idempotency_keys WHERE key = 'evt_dedup_1'
      `;
      expect(rows[0]?.count).toBe('1');
    });

    it('stores the claim with no user, which only the webhook prefix may do', async () => {
      const headers = { 'x-razorpay-signature': sign(body), 'x-razorpay-event-id': 'evt_dedup_2' };
      await post(body, headers);

      const rows = await h.sql<{ user_id: string | null; endpoint: string }[]>`
        SELECT user_id, endpoint FROM idempotency_keys WHERE key = 'evt_dedup_2'
      `;
      expect(rows[0]?.user_id).toBeNull();
      expect(rows[0]?.endpoint).toBe('POST /api/v1/webhooks/razorpay');
    });

    it('refuses the same event id carrying different bytes with 422', async () => {
      const headers = { 'x-razorpay-signature': sign(body), 'x-razorpay-event-id': 'evt_dedup_3' };
      await post(body, headers);

      const other = capturedBody(9701);
      const response = await post(other, {
        'x-razorpay-signature': sign(other),
        'x-razorpay-event-id': 'evt_dedup_3',
      });

      expect(response.status).toBe(422);
    });

    it('falls back to hashing the body when no event id is sent at all', async () => {
      // Without a fallback there is no claim, and every redelivery re-runs.
      await post(body, { 'x-razorpay-signature': sign(body) });

      const rows = await h.sql<{ key: string }[]>`SELECT key FROM idempotency_keys`;
      expect(rows[0]?.key).toMatch(/^sha256:[0-9a-f]{64}$/);
    });
  });

  describe('a capture against a real booking', () => {
    /**
     * Books through the real CreateBookingCommand, then writes the payments row
     * CreateOrderCommand would have written.
     *
     * Inserting the booking with raw SQL would be quicker and would skip the
     * ledger posting task 8 makes — which is exactly the posting the redelivery
     * assertion below counts. A fixture that produces no ledger rows can only
     * prove that nothing happened twice by proving nothing happened at all.
     */
    async function bookAndOrder() {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
      const window = windowFromNow(2, 2);

      const { booking } = await stack.create.execute({
        driverId: h.driverId,
        spaceId,
        vehicleType: 'car',
        durationType: 'hourly',
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        vehicleNumber: 'KA-01-AB-1234',
      });

      await h.sql`
        INSERT INTO payments (booking_id, user_id, razorpay_order_id, expected_total_paise, status)
        VALUES (${booking.id}, ${h.driverId}, ${ORDER_ID}, ${booking.totalPaise}, 'created')
      `;

      return booking;
    }

    it('confirms the booking when the re-fetched order matches', async () => {
      const booking = await bookAndOrder();
      razorpay.fetchOrder.mockResolvedValue({
        id: ORDER_ID,
        amountPaise: booking.totalPaise,
        amountPaidPaise: booking.totalPaise,
        currency: 'INR',
        status: 'paid',
      });

      const body = capturedBody(booking.totalPaise);
      const response = await post(body, {
        'x-razorpay-signature': sign(body),
        'x-razorpay-event-id': 'evt_capture_ok',
      });

      expect(response.status).toBe(200);

      const [row] = await h.sql<{ status: string }[]>`
        SELECT status FROM bookings WHERE id = ${booking.id}
      `;
      expect(row?.status).toBe('confirmed');

      const [payment] = await h.sql<{ status: string; captured_paise: string; method: string }[]>`
        SELECT status, captured_paise::text AS captured_paise, method
        FROM payments WHERE booking_id = ${booking.id}
      `;
      expect(payment?.status).toBe('captured');
      expect(payment?.captured_paise).toBe(String(booking.totalPaise));
      expect(payment?.method).toBe('upi');
    });

    it('never trusts the amount in the webhook body — only the re-fetched order', async () => {
      // The body claims 1 paisa. The gateway, asked directly, says 9702. The
      // body's number must not reach the comparison at all (R-SEC-09).
      const booking = await bookAndOrder();
      razorpay.fetchOrder.mockResolvedValue({
        id: ORDER_ID,
        amountPaise: booking.totalPaise,
        amountPaidPaise: booking.totalPaise,
        currency: 'INR',
        status: 'paid',
      });

      const body = capturedBody(1);
      const response = await post(body, {
        'x-razorpay-signature': sign(body),
        'x-razorpay-event-id': 'evt_lying_body',
      });

      expect(response.status).toBe(200);
      const [row] = await h.sql<{ status: string }[]>`
        SELECT status FROM bookings WHERE id = ${booking.id}
      `;
      expect(row?.status).toBe('confirmed');
    });

    it('refuses a short capture, leaves the booking pending, and audits it', async () => {
      const booking = await bookAndOrder();
      razorpay.fetchOrder.mockResolvedValue({
        id: ORDER_ID,
        amountPaise: booking.totalPaise,
        amountPaidPaise: booking.totalPaise - 2,
        currency: 'INR',
        status: 'paid',
      });

      const body = capturedBody(9700);
      const response = await post(body, {
        'x-razorpay-signature': sign(body),
        'x-razorpay-event-id': 'evt_mismatch',
      });

      // The handler threw, so Razorpay sees a non-2xx and retries. What must not
      // happen is a confirmed booking.
      expect(response.status).toBe(403);

      const [row] = await h.sql<{ status: string }[]>`
        SELECT status FROM bookings WHERE id = ${booking.id}
      `;
      expect(row?.status).toBe('pending_payment');

      const audit = await h.sql<{ action: string; target_id: string; after: unknown }[]>`
        SELECT action, target_id, after FROM audit_log WHERE action = 'payment.amount_mismatch'
      `;
      expect(audit).toHaveLength(1);
      expect(audit[0]?.target_id).toBe(booking.id);
      expect(JSON.stringify(audit[0]?.after)).not.toContain(GATEWAY_PAYMENT_ID);
    });

    it('releases the claim after a failure, so the retry actually re-runs', async () => {
      // Holding the claim would leave the event permanently in_flight and drop
      // every redelivery — a capture that never confirms, silently.
      const booking = await bookAndOrder();
      razorpay.fetchOrder.mockResolvedValue({
        id: ORDER_ID,
        amountPaise: booking.totalPaise,
        amountPaidPaise: booking.totalPaise - 2,
        currency: 'INR',
        status: 'paid',
      });

      const body = capturedBody(9700);
      const headers = { 'x-razorpay-signature': sign(body), 'x-razorpay-event-id': 'evt_retry' };
      expect((await post(body, headers)).status).toBe(403);

      const rows = await h.sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM idempotency_keys WHERE key = 'evt_retry'
      `;
      expect(rows[0]?.count).toBe('0');

      // The gateway now agrees, and the retry lands.
      razorpay.fetchOrder.mockResolvedValue({
        id: ORDER_ID,
        amountPaise: booking.totalPaise,
        amountPaidPaise: booking.totalPaise,
        currency: 'INR',
        status: 'paid',
      });
      const good = capturedBody(9702);
      expect(
        (
          await post(good, {
            'x-razorpay-signature': sign(good),
            'x-razorpay-event-id': 'evt_retry',
          })
        ).status,
      ).toBe(200);

      const [row] = await h.sql<{ status: string }[]>`
        SELECT status FROM bookings WHERE id = ${booking.id}
      `;
      expect(row?.status).toBe('confirmed');
    });

    it('credits the owner exactly once across three redeliveries', async () => {
      // The assertion the whole dedup layer exists for.
      const booking = await bookAndOrder();
      razorpay.fetchOrder.mockResolvedValue({
        id: ORDER_ID,
        amountPaise: booking.totalPaise,
        amountPaidPaise: booking.totalPaise,
        currency: 'INR',
        status: 'paid',
      });

      const body = capturedBody(9702);
      const headers = { 'x-razorpay-signature': sign(body), 'x-razorpay-event-id': 'evt_thrice' };
      await post(body, headers);
      await post(body, headers);
      await post(body, headers);

      const [totals] = await h.sql<{ txns: string; owner_credited: string | null }[]>`
        SELECT count(DISTINCT txn_id)::text AS txns,
               coalesce(sum(amount_paise) FILTER (
                 WHERE account = 'owner_payable' AND direction = 'credit'), 0)::text
                 AS owner_credited
        FROM ledger_entries WHERE booking_id = ${booking.id}
      `;

      // One posting, from booking creation. Capture adds none — the ledger
      // records obligations, and capture does not change who owes whom. Three
      // deliveries of the same event therefore leave the owner credited once.
      expect(totals?.txns).toBe('1');
      expect(totals?.owner_credited).toBe(String(booking.ownerEarningsPaise));
    });

    it('does not cancel the booking when a payment fails', async () => {
      // The driver has a ten-minute hold and may pay on the second try.
      // Cancelling here would release a slot they are still trying to pay for.
      const booking = await bookAndOrder();

      const body =
        `{"entity": "event", "event": "payment.failed", "payload": {"payment": {"entity": ` +
        `{"id": "${GATEWAY_PAYMENT_ID}", "order_id": "${ORDER_ID}", "amount": 9702, ` +
        `"currency": "INR", "status": "failed", "error_description": "Payment declined by bank"}}}}`;

      const response = await post(body, {
        'x-razorpay-signature': sign(body),
        'x-razorpay-event-id': 'evt_failed',
      });

      expect(response.status).toBe(200);

      const [row] = await h.sql<{ status: string }[]>`
        SELECT status FROM bookings WHERE id = ${booking.id}
      `;
      expect(row?.status).toBe('pending_payment');

      const [payment] = await h.sql<{ status: string; failure_reason: string }[]>`
        SELECT status, failure_reason FROM payments WHERE booking_id = ${booking.id}
      `;
      expect(payment?.status).toBe('failed');
      expect(payment?.failure_reason).toBe('Payment declined by bank');
    });

    it('does not overwrite a captured payment with a late failure event', async () => {
      const booking = await bookAndOrder();
      razorpay.fetchOrder.mockResolvedValue({
        id: ORDER_ID,
        amountPaise: booking.totalPaise,
        amountPaidPaise: booking.totalPaise,
        currency: 'INR',
        status: 'paid',
      });

      const captured = capturedBody(9702);
      await post(captured, {
        'x-razorpay-signature': sign(captured),
        'x-razorpay-event-id': 'evt_ordered_1',
      });

      const failed =
        `{"entity": "event", "event": "payment.failed", "payload": {"payment": {"entity": ` +
        `{"id": "${GATEWAY_PAYMENT_ID}", "order_id": "${ORDER_ID}", "amount": 9702, ` +
        `"currency": "INR", "status": "failed"}}}}`;
      await post(failed, {
        'x-razorpay-signature': sign(failed),
        'x-razorpay-event-id': 'evt_ordered_2',
      });

      const [payment] = await h.sql<{ status: string }[]>`
        SELECT status FROM payments WHERE booking_id = ${booking.id}
      `;
      expect(payment?.status).toBe('captured');
    });

    it('refunds rather than confirms a capture against a cancelled booking', async () => {
      const booking = await bookAndOrder();
      await h.sql`UPDATE bookings SET status = 'cancelled' WHERE id = ${booking.id}`;

      razorpay.fetchOrder.mockResolvedValue({
        id: ORDER_ID,
        amountPaise: booking.totalPaise,
        amountPaidPaise: booking.totalPaise,
        currency: 'INR',
        status: 'paid',
      });

      const body = capturedBody(9702);
      expect(
        (
          await post(body, {
            'x-razorpay-signature': sign(body),
            'x-razorpay-event-id': 'evt_orphan',
          })
        ).status,
      ).toBe(200);

      const [row] = await h.sql<{ status: string }[]>`
        SELECT status FROM bookings WHERE id = ${booking.id}
      `;
      expect(row?.status).toBe('cancelled');

      const outbox = await h.sql<{ type: string }[]>`
        SELECT type FROM outbox_messages WHERE type = 'payment.orphan-capture'
      `;
      expect(outbox).toHaveLength(1);
    });
  });

  describe('events we do not handle', () => {
    it('answers 200 rather than retrying forever', async () => {
      const body = '{"entity": "event", "event": "settlement.processed", "payload": {}}';
      const response = await post(body, { 'x-razorpay-signature': sign(body) });

      expect(response.status).toBe(200);
    });

    it('rejects a malformed payment.captured instead of treating it as unhandled', async () => {
      // No order_id. It must fail the strict schema rather than slip through the
      // permissive branch, which is what the old z.record(z.unknown()) allowed.
      const body =
        '{"entity": "event", "event": "payment.captured", "payload": {"payment": {"entity": {"id": "pay_x", "amount": 9702, "currency": "INR", "status": "captured"}}}}';
      const response = await post(body, { 'x-razorpay-signature': sign(body) });

      expect(response.status).toBe(400);
    });
  });
});
