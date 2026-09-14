import MockAdapter from 'axios-mock-adapter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';

import { searchSpaces } from '../api/spaces';

vi.mock('@/lib/secure-storage', () => ({
  secureStorage: {
    read: vi.fn(() => Promise.resolve(null)),
    write: vi.fn(),
    clear: vi.fn(),
  },
}));

const mock = new MockAdapter(api);

const ITEM = {
  id: '0192f1b3-0000-7000-8000-000000000001',
  title: 'Basement Parking',
  addressLine: '5th Cross, Koramangala',
  location: { lat: 12.9345, lng: 77.6266 },
  distanceM: 450,
  thumbnail: null,
  rating: 4.2,
  reviewCount: 18,
  amenities: ['covered'],
  availableSlots: { car: 1, twoWheeler: 3 },
  basePricePaise: 3000,
  surgeMultiplier: 1,
  effectivePricePaise: 3000,
  isOpenNow: true,
};

const META = { limit: 20, hasMore: true, nextCursor: 'cursor-2' };

beforeEach(() => {
  mock.reset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('searchSpaces', () => {
  it('returns the envelope data and meta', async () => {
    mock.onGet('/driver/spaces').reply(200, { data: [ITEM], meta: META });

    const page = await searchSpaces({ lat: 12.9, lng: 77.6 });

    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.title).toBe('Basement Parking');
    expect(page.meta.nextCursor).toBe('cursor-2');
  });

  it('sends the filters as query parameters', async () => {
    mock.onGet('/driver/spaces').reply(200, { data: [], meta: { limit: 20, hasMore: false } });

    await searchSpaces({ lat: 12.9, lng: 77.6, amenities: 'covered,cctv', vehicleType: 'car' });

    expect(mock.history.get[0]?.params).toMatchObject({
      lat: 12.9,
      amenities: 'covered,cctv',
      vehicleType: 'car',
    });
  });

  it('forwards the cursor for the next page', async () => {
    mock.onGet('/driver/spaces').reply(200, { data: [], meta: { limit: 20, hasMore: false } });

    await searchSpaces({ lat: 12.9, lng: 77.6, cursor: 'cursor-2' });

    expect(mock.history.get[0]?.params).toMatchObject({ cursor: 'cursor-2' });
  });

  it('rejects a response that does not match the contract (R-VAL-01)', async () => {
    mock
      .onGet('/driver/spaces')
      .reply(200, { data: [{ ...ITEM, basePricePaise: 30.5 }], meta: META });

    await expect(searchSpaces({ lat: 12.9, lng: 77.6 })).rejects.toThrow();
  });

  it('surfaces a transport failure rather than swallowing it (R-FAIL-01)', async () => {
    mock.onGet('/driver/spaces').networkError();

    await expect(searchSpaces({ lat: 12.9, lng: 77.6 })).rejects.toThrow();
  });
});
