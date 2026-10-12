import MockAdapter from 'axios-mock-adapter';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';

import {
  cancelValet,
  cancelWash,
  createWashOrder,
  fetchValetJob,
  fetchWashJob,
  requestValet,
  requestValetReturn,
  requestWash,
} from '../api/addons';

vi.mock('@/lib/secure-storage', () => ({
  secureStorage: {
    read: vi.fn(() => Promise.resolve(null)),
    write: vi.fn(),
    clear: vi.fn(),
  },
}));

const mock = new MockAdapter(api);

import {
  BOOKING_ID,
  VALET_ID,
  VALET_JOB_WIRE as VALET_JOB,
  WASH_ID,
  WASH_JOB_WIRE as WASH_JOB,
} from './addon-fixtures';

const INTENT = { idempotencyKey: '0192f1c0-1111-7000-8000-00000000000a' };
const PICKUP = { lat: 12.93, lng: 77.62, address: 'Gate 2, Forum Mall' };

afterEach(() => {
  mock.reset();
});

/**
 * The driver add-on calls, against the real axios instance. Each write carries
 * the caller's intent as its Idempotency-Key (R-FE-05), sends exactly what the
 * contract takes — no price, ever — and every response is parsed.
 */
describe('driver add-on api', () => {
  it('requests a valet with the booking and a nested pickup, keyed by the intent', async () => {
    mock.onPost('/driver/valet/requests').reply((config) => {
      expect(config.headers?.['Idempotency-Key']).toBe(INTENT.idempotencyKey);
      expect(JSON.parse(config.data as string)).toEqual({ bookingId: BOOKING_ID, pickup: PICKUP });
      return [201, { data: VALET_JOB }];
    });

    const job = await requestValet(BOOKING_ID, PICKUP, INTENT);
    expect(job.id).toBe(VALET_ID);
    expect(job.offeredTo).toBe(3);
  });

  it('reads a valet job and refuses a body that does not match the contract', async () => {
    mock.onGet(`/driver/valet/requests/${VALET_ID}`).replyOnce(200, { data: VALET_JOB });
    await expect(fetchValetJob(VALET_ID)).resolves.toMatchObject({ status: 'offered' });

    mock.onGet(`/driver/valet/requests/${VALET_ID}`).replyOnce(200, '<html></html>');
    await expect(fetchValetJob(VALET_ID)).rejects.toThrow();
  });

  it('asks for the car back with a drop location', async () => {
    mock.onPost(`/driver/valet/requests/${VALET_ID}/return`).reply((config) => {
      expect(JSON.parse(config.data as string)).toEqual({ dropLocation: PICKUP });
      return [200, { data: { ...VALET_JOB, status: 'return_requested' } }];
    });
    await expect(requestValetReturn(VALET_ID, PICKUP, INTENT)).resolves.toMatchObject({
      status: 'return_requested',
    });
  });

  it('cancels a valet with an empty body', async () => {
    mock.onPost(`/driver/valet/requests/${VALET_ID}/cancel`).reply((config) => {
      expect(JSON.parse(config.data as string)).toEqual({});
      return [200, { data: { ...VALET_JOB, status: 'cancelled', cancellable: false } }];
    });
    await expect(cancelValet(VALET_ID, INTENT)).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('requests a wash naming the service and vehicle, never a price', async () => {
    mock.onPost('/driver/carwash/requests').reply((config) => {
      const body = JSON.parse(config.data as string) as Record<string, unknown>;
      expect(body).toEqual({
        bookingId: BOOKING_ID,
        serviceName: 'premium_wash',
        vehicleType: 'car',
      });
      return [201, { data: { ...WASH_JOB, status: 'offered', pricePaise: null } }];
    });
    const job = await requestWash(
      { bookingId: BOOKING_ID, serviceName: 'premium_wash', vehicleType: 'car' },
      INTENT,
    );
    expect(job.status).toBe('offered');
  });

  it('reads a wash, mints its order and cancels it', async () => {
    mock.onGet(`/driver/carwash/requests/${WASH_ID}`).reply(200, { data: WASH_JOB });
    await expect(fetchWashJob(WASH_ID)).resolves.toMatchObject({ driverTotalPaise: 47200 });

    mock.onPost(`/driver/carwash/requests/${WASH_ID}/order`).reply((config) => {
      expect(config.headers?.['Idempotency-Key']).toBe(INTENT.idempotencyKey);
      return [
        201,
        {
          data: {
            razorpayOrderId: 'order_1',
            amountPaise: 47200,
            currency: 'INR',
            keyId: 'rzp_test_1',
            serviceLabel: 'Premium Wash',
            washJobId: WASH_ID,
          },
        },
      ];
    });
    await expect(createWashOrder(WASH_ID, INTENT)).resolves.toMatchObject({ amountPaise: 47200 });

    mock.onPost(`/driver/carwash/requests/${WASH_ID}/cancel`).reply(200, {
      data: { ...WASH_JOB, status: 'cancelled', cancellable: false },
    });
    await expect(cancelWash(WASH_ID, INTENT)).resolves.toMatchObject({ status: 'cancelled' });
  });
});
