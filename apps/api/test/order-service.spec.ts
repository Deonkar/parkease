import { describe, expect, it, vi } from 'vitest';

import { TransferExceedsCaptureError } from '../src/domains/payment/errors.js';
import { OrderService } from '../src/domains/payment/order.service.js';
import type { RazorpayClient } from '../src/domains/payment/razorpay.client.js';

/** The canonical booking: 9702 to the driver, 5100 to the owner. */
const BOOKING = {
  id: '0192f1c0-0000-7000-8000-000000000001',
  driverId: '0192f1c0-0000-7000-8000-0000000000d1',
  totalPaise: 9702,
  ownerEarningsPaise: 5100,
};

const LINKED_ACCOUNT = 'acc_QK7l1nOwnerLinked';

/**
 * A `RazorpayClient` whose methods are spies. Typed as the intersection rather
 * than `Partial<RazorpayClient>` so `.mock.calls` stays reachable — spreading
 * overrides over it would widen each method back to the plain signature and lose
 * the spy, and the whole point of these tests is asserting what was sent and
 * what was never called.
 */
type ClientDouble = {
  [K in keyof RazorpayClient]: ReturnType<typeof vi.fn>;
};

function clientDouble(): ClientDouble {
  return {
    createOrder: vi.fn().mockResolvedValue({
      id: 'order_QK7xVv9pLm2Zab',
      amountPaise: 9702,
      amountPaidPaise: 0,
      currency: 'INR',
      status: 'created',
    }),
    fetchOrder: vi.fn(),
    createRefund: vi.fn(),
    findRefundByReference: vi.fn(),
  };
}

const asClient = (double: ClientDouble): RazorpayClient => double as unknown as RazorpayClient;

describe('OrderService', () => {
  it('attaches exactly one transfer, of the owner earnings, to the owner account', async () => {
    const client = clientDouble();
    const order = await new OrderService(asClient(client)).createForBooking(
      BOOKING,
      LINKED_ACCOUNT,
    );

    expect(order.id).toBe('order_QK7xVv9pLm2Zab');
    expect(client.createOrder).toHaveBeenCalledTimes(1);

    const sent = client.createOrder.mock.calls[0]?.[0];
    expect(sent.amountPaise).toBe(9702);
    expect(sent.transfers).toHaveLength(1);
    expect(sent.transfers[0]).toMatchObject({ account: LINKED_ACCOUNT, amountPaise: 5100 });
  });

  it('names the booking on the order and on the transfer', async () => {
    // Route settlement reports are reconciled against our txn ids in task 16.
    // A transfer with no booking on it is a payment nobody can match back.
    const client = clientDouble();
    await new OrderService(asClient(client)).createForBooking(BOOKING, LINKED_ACCOUNT);

    const sent = client.createOrder.mock.calls[0]?.[0];
    expect(sent.receipt).toBe(BOOKING.id);
    expect(sent.notes.bookingId).toBe(BOOKING.id);
    expect(sent.transfers[0].notes.bookingId).toBe(BOOKING.id);
  });

  it('refuses before the SDK call when transfers would exceed the capture', async () => {
    // Ours is base − 15% against base + surge + GST, so it always clears. A
    // future promo or fee change could break it silently, and Route would answer
    // with a gateway error nobody could trace back to our arithmetic.
    const client = clientDouble();
    const overfunded = { ...BOOKING, ownerEarningsPaise: 9703 };

    await expect(
      new OrderService(asClient(client)).createForBooking(overfunded, LINKED_ACCOUNT),
    ).rejects.toThrow(TransferExceedsCaptureError);

    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('allows a transfer exactly equal to the capture', async () => {
    // The boundary Route itself enforces is "cannot exceed", not "must be less".
    const client = clientDouble();
    await new OrderService(asClient(client)).createForBooking(
      { ...BOOKING, ownerEarningsPaise: 9702 },
      LINKED_ACCOUNT,
    );

    expect(client.createOrder).toHaveBeenCalledTimes(1);
  });

  it('omits the transfer entirely when the owner earns nothing', async () => {
    // Razorpay rejects a zero-amount transfer. A fully discounted booking where
    // the owner's share is zero is not a reason to fail the order.
    const client = clientDouble();
    await new OrderService(asClient(client)).createForBooking(
      { ...BOOKING, ownerEarningsPaise: 0 },
      LINKED_ACCOUNT,
    );

    expect(client.createOrder.mock.calls[0]?.[0].transfers).toEqual([]);
  });

  it('never sends a fractional amount to the gateway', async () => {
    const client = clientDouble();
    await new OrderService(asClient(client)).createForBooking(BOOKING, LINKED_ACCOUNT);

    const sent = client.createOrder.mock.calls[0]?.[0];
    expect(Number.isInteger(sent.amountPaise)).toBe(true);
    expect(Number.isInteger(sent.transfers[0].amountPaise)).toBe(true);
  });
});
