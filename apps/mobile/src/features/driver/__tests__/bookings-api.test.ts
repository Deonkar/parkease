import MockAdapter from 'axios-mock-adapter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';

import {
  cancelBooking,
  createBooking,
  extendBooking,
  fetchBooking,
  fetchQuote,
  listBookings,
} from '../api/bookings';

vi.mock('@/lib/secure-storage', () => ({
  secureStorage: {
    read: vi.fn(() => Promise.resolve(null)),
    write: vi.fn(),
    clear: vi.fn(),
  },
}));

const mock = new MockAdapter(api);

const INTENT = { idempotencyKey: '0192f1c0-1111-7000-8000-00000000000a' };

const QUOTE = {
  basePaise: 6000,
  surgePremiumPaise: 3000,
  gstPaise: 702,
  totalPaise: 9702,
  ownerEarningsPaise: 5100,
  surgeMultiplierBp: 15_000,
};

const BOOKING = {
  id: '0192f1c0-1111-7000-8000-000000000001',
  status: 'confirmed',
  space: {
    id: '0192f1b3-1111-7000-8000-000000000001',
    title: 'Basement Parking, 5th Cross',
    addressLine: '5th Cross, Koramangala',
    landmark: null,
    latitude: 12.9345,
    longitude: 77.6266,
    accessInstructions: null,
  },
  vehicleType: 'car',
  vehicleNumber: 'KA-01-AB-1234',
  durationType: 'hourly',
  startsAt: '2026-09-16T04:30:00.000Z',
  endsAt: '2026-09-16T06:30:00.000Z',
  slotIndex: 0,
  quote: QUOTE,
  qrToken: 'pk1.0192f1c0-1111-7000-8000-000000000001.1789459200000.sig',
  checkedInAt: null,
  checkInMethod: null,
  cancelledAt: null,
  cancellationReason: null,
  paymentDeadlineAt: null,
  createdAt: '2026-09-15T10:00:00.000Z',
};

const CREATE_BODY = {
  spaceId: BOOKING.space.id,
  vehicleType: 'car' as const,
  durationType: 'hourly' as const,
  startsAt: BOOKING.startsAt,
  endsAt: BOOKING.endsAt,
};

beforeEach(() => {
  mock.reset();
});

afterEach(() => {
  mock.reset();
});

describe('createBooking', () => {
  it('sends the Idempotency-Key from the intent it was given', async () => {
    mock.onPost('/driver/bookings').reply(201, { data: BOOKING });

    await createBooking(CREATE_BODY, INTENT);

    // R-FE-05: the key is minted per user intent, not per HTTP attempt. A retry
    // must carry the same one or the server reserves a second slot.
    expect(mock.history.post[0]?.headers?.['Idempotency-Key']).toBe(INTENT.idempotencyKey);
  });

  it('reuses the same key across a retry of the same intent', async () => {
    mock.onPost('/driver/bookings').replyOnce(500).onPost('/driver/bookings').reply(201, {
      data: BOOKING,
    });

    await createBooking(CREATE_BODY, INTENT).catch(() => undefined);
    await createBooking(CREATE_BODY, INTENT);

    const keys = mock.history.post.map((r) => String(r.headers?.['Idempotency-Key']));
    expect(new Set(keys).size).toBe(1);
  });

  it('omits vehicleNumber rather than sending undefined', async () => {
    mock.onPost('/driver/bookings').reply(201, { data: BOOKING });

    await createBooking(CREATE_BODY, INTENT);

    expect(JSON.parse(String(mock.history.post[0]?.data))).not.toHaveProperty('vehicleNumber');
  });

  /**
   * R-VAL-01. A response is data from outside the process, so it parses rather
   * than being asserted. A server that starts returning a string total must fail
   * here, loudly, and not reach a screen that renders "₹NaN" next to a Pay
   * button.
   */
  it('rejects a response whose total is not an integer', async () => {
    mock.onPost('/driver/bookings').reply(201, {
      data: { ...BOOKING, quote: { ...QUOTE, totalPaise: '9702' } },
    });

    await expect(createBooking(CREATE_BODY, INTENT)).rejects.toThrow();
  });

  it('rejects a response missing the envelope', async () => {
    mock.onPost('/driver/bookings').reply(201, BOOKING);
    await expect(createBooking(CREATE_BODY, INTENT)).rejects.toThrow();
  });

  it('rejects a response with an unknown booking status', async () => {
    mock.onPost('/driver/bookings').reply(201, { data: { ...BOOKING, status: 'refunded' } });
    await expect(createBooking(CREATE_BODY, INTENT)).rejects.toThrow();
  });
});

describe('fetchQuote', () => {
  it('is a GET, so it carries no Idempotency-Key', async () => {
    mock.onGet('/driver/quotes').reply(200, {
      data: { quote: QUOTE, startsAt: BOOKING.startsAt, endsAt: BOOKING.endsAt },
    });

    const result = await fetchQuote({
      spaceId: BOOKING.space.id,
      vehicleType: 'car',
      durationType: 'hourly',
      startsAt: BOOKING.startsAt,
      endsAt: BOOKING.endsAt,
    });

    expect(result.quote.totalPaise).toBe(9702);
    expect(mock.history.get[0]?.headers?.['Idempotency-Key']).toBeUndefined();
  });
});

describe('listBookings', () => {
  it('parses a cursor page and passes the filter through', async () => {
    mock.onGet('/driver/bookings').reply(200, {
      data: { items: [BOOKING], meta: { limit: 20, hasMore: false, nextCursor: null } },
    });

    const page = await listBookings({ filter: 'upcoming' });

    expect(page.items).toHaveLength(1);
    expect(page.meta.nextCursor).toBeNull();
    expect(mock.history.get[0]?.params).toMatchObject({ filter: 'upcoming' });
  });

  it('rejects a page whose meta is missing nextCursor', async () => {
    mock.onGet('/driver/bookings').reply(200, {
      data: { items: [], meta: { limit: 20, hasMore: false } },
    });
    await expect(listBookings({ filter: 'all' })).rejects.toThrow();
  });
});

describe('the mutating calls all carry their intent', () => {
  it.each([
    ['cancel', () => cancelBooking(BOOKING.id, 'changed my mind', INTENT)],
    ['extend', () => extendBooking(BOOKING.id, BOOKING.endsAt, INTENT)],
  ])('%s', async (_label, call) => {
    mock.onPost(new RegExp(`/driver/bookings/${BOOKING.id}/`)).reply(200, { data: BOOKING });

    await call();

    expect(mock.history.post[0]?.headers?.['Idempotency-Key']).toBe(INTENT.idempotencyKey);
  });

  it('sends no reason field when the driver gave none', async () => {
    mock.onPost(`/driver/bookings/${BOOKING.id}/cancel`).reply(200, { data: BOOKING });

    await cancelBooking(BOOKING.id, undefined, INTENT);

    expect(JSON.parse(String(mock.history.post[0]?.data))).toEqual({});
  });
});

describe('fetchBooking', () => {
  it('accepts a booking with no QR token yet', async () => {
    mock.onGet(`/driver/bookings/${BOOKING.id}`).reply(200, {
      data: { ...BOOKING, status: 'pending_payment', qrToken: null },
    });

    const booking = await fetchBooking(BOOKING.id);
    expect(booking.qrToken).toBeNull();
  });
});
