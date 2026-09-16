import {
  type PgTestContext,
  runMigrations,
  startPgContainer,
  stopPgContainer,
} from '@parkease/testing';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JobDeps } from '../../src/deps.js';
import { issueRefund } from '../../src/jobs/payment/issue-refund.job.js';
import type { RefundGateway } from '../../src/jobs/payment/razorpay.js';
import { reconcileOrphanCapture } from '../../src/jobs/payment/reconcile-orphan.job.js';

let pg: PgTestContext;
let deps: JobDeps;

/**
 * Seeds a confirmed booking with a captured payment, directly.
 *
 * The worker has no access to the API's command stack and does not need one:
 * what these jobs are responsible for is the guard, the transaction and the
 * gateway call, all of which are visible from the rows.
 *
 * The money columns are the no-surge two-hour quote — base 6000, fee 900, GST
 * 162, total 6162, owner 5100.
 */
async function seedCapturedBooking(): Promise<{
  bookingId: string;
  paymentId: string;
  driverId: string;
}> {
  const unique = () => String(Math.floor(Math.random() * 90_000_000) + 10_000_000);

  const [driver] = await pg.sql<{ id: string }[]>`
    INSERT INTO users (phone, firebase_uid, name)
    VALUES (${`+9198${unique()}`}, ${`fb-${String(Math.random())}`}, 'Ravi K.')
    RETURNING id
  `;
  const [owner] = await pg.sql<{ id: string }[]>`
    INSERT INTO users (phone, firebase_uid, name)
    VALUES (${`+9197${unique()}`}, ${`fb-${String(Math.random())}`}, 'Priya S.')
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

  const [booking] = await pg.sql<{ id: string }[]>`
    INSERT INTO bookings (driver_id, space_id, vehicle_type, duration_type,
                          starts_at, ends_at, base_paise, surge_premium_paise,
                          parkease_fee_paise, gst_paise, total_paise,
                          owner_earnings_paise, status)
    VALUES (${driver.id}, ${space.id}, 'car', 'hourly',
            now() + interval '1 hour', now() + interval '3 hours',
            6000, 0, 900, 162, 6162, 5100, 'confirmed')
    RETURNING id
  `;
  if (booking === undefined) throw new Error('failed to seed booking');

  const [payment] = await pg.sql<{ id: string }[]>`
    INSERT INTO payments (booking_id, user_id, razorpay_order_id, razorpay_payment_id,
                          expected_total_paise, captured_paise, status, captured_at)
    VALUES (${booking.id}, ${driver.id}, ${`order_${String(Math.random()).slice(2, 14)}`},
            ${`pay_${String(Math.random()).slice(2, 14)}`}, 6162, 6162, 'captured', now())
    RETURNING id
  `;
  if (payment === undefined) throw new Error('failed to seed payment');

  return { bookingId: booking.id, paymentId: payment.id, driverId: driver.id };
}

async function seedPendingRefund(paymentId: string, amountPaise = 5162): Promise<string> {
  const [refund] = await pg.sql<{ id: string }[]>`
    INSERT INTO refunds (payment_id, amount_paise, reason, status)
    VALUES (${paymentId}, ${amountPaise}, 'before_start', 'pending')
    RETURNING id
  `;
  if (refund === undefined) throw new Error('failed to seed refund');
  return refund.id;
}

function gatewayDouble(overrides: Partial<RefundGateway> = {}): RefundGateway {
  return {
    findByReference: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation(({ amountPaise }: { amountPaise: number }) =>
      Promise.resolve({
        id: `rfnd_${String(Math.random()).slice(2, 12)}`,
        amountPaise,
        status: 'pending',
      }),
    ),
    ...overrides,
  } as RefundGateway;
}

beforeAll(async () => {
  pg = await startPgContainer();
  await runMigrations(pg.connectionString);
  deps = {
    db: drizzle(pg.sql) as unknown as JobDeps['db'],
    boss: {} as JobDeps['boss'],
    // No payment job touches the cache; only surge does.
    redis: {} as JobDeps['redis'],
  };
}, 300_000);

afterAll(async () => {
  await stopPgContainer(pg);
});

beforeEach(async () => {
  // TRUNCATE, not DELETE: `ledger_entries` carries a BEFORE DELETE trigger that
  // refuses row deletion outright (R-MONEY-07), and TRUNCATE does not fire row
  // triggers. A cleanup written as DELETE fails here — which is the append-only
  // rule working, asserted directly in the API's ledger-balance suite.
  await pg.sql`
    TRUNCATE outbox_messages, refunds, ledger_entries, payments, booking_slots,
             bookings, space_slots, spaces, user_roles, users CASCADE
  `;
  vi.clearAllMocks();
});

describe('payment.issue-refund', () => {
  it('sends the refund and records the gateway id', async () => {
    const { bookingId, paymentId } = await seedCapturedBooking();
    const refundId = await seedPendingRefund(paymentId);
    const gateway = gatewayDouble();

    await issueRefund(
      deps,
      {
        refundId,
        paymentId,
        bookingId,
        razorpayPaymentId: 'pay_abc123',
        amountPaise: 5162,
      },
      gateway,
    );

    expect(gateway.create).toHaveBeenCalledTimes(1);

    const [row] = await pg.sql<{ razorpay_refund_id: string | null }[]>`
      SELECT razorpay_refund_id FROM refunds WHERE id = ${refundId}
    `;
    expect(row?.razorpay_refund_id).toMatch(/^rfnd_/);
  });

  it('does not refund twice when the job is delivered twice', async () => {
    // Delivery is at-least-once. A second refund is money we cannot get back,
    // so this is the assertion the whole job exists to satisfy.
    const { bookingId, paymentId } = await seedCapturedBooking();
    const refundId = await seedPendingRefund(paymentId);
    const gateway = gatewayDouble();
    const payload = {
      refundId,
      paymentId,
      bookingId,
      razorpayPaymentId: 'pay_abc123',
      amountPaise: 5162,
    };

    await issueRefund(deps, payload, gateway);
    await issueRefund(deps, payload, gateway);
    await issueRefund(deps, payload, gateway);

    expect(gateway.create).toHaveBeenCalledTimes(1);
  });

  it('adopts a refund the gateway already holds rather than sending a second', async () => {
    // The window a local guard cannot close: a previous run called Razorpay and
    // died before writing the id down. Asking the gateway is the only way to
    // know, and it is why every refund carries our own id in its notes.
    const { bookingId, paymentId } = await seedCapturedBooking();
    const refundId = await seedPendingRefund(paymentId);
    const gateway = gatewayDouble({
      findByReference: vi
        .fn()
        .mockResolvedValue({ id: 'rfnd_already_there', amountPaise: 5162, status: 'processed' }),
    });

    await issueRefund(
      deps,
      { refundId, paymentId, bookingId, razorpayPaymentId: 'pay_abc123', amountPaise: 5162 },
      gateway,
    );

    expect(gateway.create).not.toHaveBeenCalled();

    const [row] = await pg.sql<{ razorpay_refund_id: string | null }[]>`
      SELECT razorpay_refund_id FROM refunds WHERE id = ${refundId}
    `;
    expect(row?.razorpay_refund_id).toBe('rfnd_already_there');
  });

  it("writes no ledger entry — settlement is the webhook's job", async () => {
    const { bookingId, paymentId } = await seedCapturedBooking();
    const refundId = await seedPendingRefund(paymentId);

    await issueRefund(
      deps,
      { refundId, paymentId, bookingId, razorpayPaymentId: 'pay_abc123', amountPaise: 5162 },
      gatewayDouble(),
    );

    const rows = await pg.sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM ledger_entries
    `;
    expect(rows[0]?.count).toBe('0');
  });

  it('refuses a malformed payload rather than calling the gateway with undefined', async () => {
    const gateway = gatewayDouble();

    await expect(issueRefund(deps, { refundId: 'not-a-uuid' }, gateway)).rejects.toThrow(
      /Malformed payment.issue-refund payload/,
    );
    expect(gateway.create).not.toHaveBeenCalled();
  });

  it('fails loudly when the refund row does not exist', async () => {
    await expect(
      issueRefund(
        deps,
        {
          refundId: '0192f1c0-0000-7000-8000-00000000dead',
          paymentId: '0192f1c0-0000-7000-8000-00000000beef',
          bookingId: '0192f1c0-0000-7000-8000-00000000cafe',
          razorpayPaymentId: 'pay_abc123',
          amountPaise: 5162,
        },
        gatewayDouble(),
      ),
    ).rejects.toThrow(/does not exist/);
  });
});

describe('payment.orphan-capture', () => {
  const orphanPayload = (bookingId: string, paymentId: string) => ({
    bookingId,
    paymentId,
    razorpayPaymentId: 'pay_abc123',
    capturedPaise: 6162,
    bookingStatus: 'cancelled',
  });

  it('records a full refund and a balanced posting', async () => {
    const { bookingId, paymentId } = await seedCapturedBooking();
    await pg.sql`UPDATE bookings SET status = 'cancelled' WHERE id = ${bookingId}`;

    await reconcileOrphanCapture(deps, orphanPayload(bookingId, paymentId));

    const [refund] = await pg.sql<{ amount_paise: string; reason: string }[]>`
      SELECT amount_paise::text AS amount_paise, reason FROM refunds WHERE payment_id = ${paymentId}
    `;
    expect(refund?.amount_paise).toBe('6162');
    expect(refund?.reason).toBe('orphan_capture');

    // We hold their money and we owe it back. `refund.processed` closes both.
    const entries = await pg.sql<{ account: string; direction: string; amount_paise: string }[]>`
      SELECT account, direction, amount_paise::text AS amount_paise
      FROM ledger_entries WHERE booking_id = ${bookingId} ORDER BY account
    `;
    expect(entries).toEqual([
      { account: 'driver_receivable', direction: 'debit', amount_paise: '6162' },
      { account: 'refunds_payable', direction: 'credit', amount_paise: '6162' },
    ]);
  });

  it('enqueues the gateway call rather than making it', async () => {
    const { bookingId, paymentId } = await seedCapturedBooking();
    await reconcileOrphanCapture(deps, orphanPayload(bookingId, paymentId));

    const outbox = await pg.sql<{ type: string }[]>`
      SELECT type FROM outbox_messages WHERE type = 'payment.issue-refund'
    `;
    expect(outbox).toHaveLength(1);
  });

  it('does nothing on a second delivery', async () => {
    const { bookingId, paymentId } = await seedCapturedBooking();
    const payload = orphanPayload(bookingId, paymentId);

    await reconcileOrphanCapture(deps, payload);
    await reconcileOrphanCapture(deps, payload);
    await reconcileOrphanCapture(deps, payload);

    const refundRows = await pg.sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM refunds WHERE payment_id = ${paymentId}
    `;
    expect(refundRows[0]?.count).toBe('1');

    const ledgerRows = await pg.sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM ledger_entries WHERE booking_id = ${bookingId}
    `;
    expect(ledgerRows[0]?.count).toBe('2');
  });

  it('marks the payment refunded and records what was captured', async () => {
    // confirm-payment never reached markCaptured on this path, so without this
    // the row would claim a refund of money it has no record of receiving — and
    // task 16 would have no gateway payment id to match Route's report against.
    const { bookingId, paymentId } = await seedCapturedBooking();
    await pg.sql`
      UPDATE payments SET razorpay_payment_id = NULL, captured_paise = NULL,
                          captured_at = NULL, status = 'created'
      WHERE id = ${paymentId}
    `;

    await reconcileOrphanCapture(deps, orphanPayload(bookingId, paymentId));

    const [row] = await pg.sql<
      { status: string; razorpay_payment_id: string | null; captured_paise: string | null }[]
    >`
      SELECT status, razorpay_payment_id, captured_paise::text AS captured_paise
      FROM payments WHERE id = ${paymentId}
    `;
    expect(row?.status).toBe('refunded');
    expect(row?.razorpay_payment_id).toBe('pay_abc123');
    expect(row?.captured_paise).toBe('6162');
  });
});
