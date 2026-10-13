import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PaymentService } from '../../src/domains/payment/payment.service.js';
import { withTransaction } from '../../src/platform/db/transaction.js';

import { seedBooking, seedSpace, startHarness, stopHarness, type Harness } from './harness.js';

/** S-19: moving a payment to refunded is checked like the refund insert beside it. */
describe('PaymentService.markRefunded', () => {
  let h: Harness;
  let service: PaymentService;

  beforeAll(async () => {
    h = await startHarness();
    service = new PaymentService(h.db);
  }, 300_000);

  afterAll(async () => {
    await stopHarness(h);
  });

  const paymentIn = async (status: string): Promise<string> => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    const bookingId = await seedBooking(h, {
      spaceId,
      vehicleType: 'car',
      slotIndex: 0,
      slotStatus: 'confirmed',
    });
    const [row] = await h.sql<{ id: string }[]>`
      INSERT INTO payments (booking_id, user_id, razorpay_order_id, expected_total_paise, status,
                            captured_paise, captured_at)
      VALUES (${bookingId}, ${h.driverId}, ${`order_${crypto.randomUUID().slice(0, 12)}`}, 3000,
              ${status}, ${status === 'created' ? null : 3000},
              ${status === 'created' ? null : new Date().toISOString()}::timestamptz)
      RETURNING id`;
    return row?.id ?? '';
  };

  it('moves a captured payment, and the write is visible', async () => {
    const id = await paymentIn('captured');

    await withTransaction(h.db, (tx) => service.markRefunded(tx, id, true));

    const [row] = await h.sql<{ status: string }[]>`SELECT status FROM payments WHERE id = ${id}`;
    expect(row?.status).toBe('refunded');
  });

  it('throws, rolling its transaction back, for a payment that is already refunded', async () => {
    const id = await paymentIn('refunded');

    await expect(
      withTransaction(h.db, (tx) => service.markRefunded(tx, id, false)),
    ).rejects.toThrow(/could not be marked refunded/);
  });

  it('throws for a payment that does not exist', async () => {
    await expect(
      withTransaction(h.db, (tx) => service.markRefunded(tx, crypto.randomUUID(), true)),
    ).rejects.toThrow(/could not be marked refunded/);
  });
});
