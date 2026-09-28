import {
  ownerBookingSchema,
  ownerDashboardSchema,
  ownerEarningsViewSchema,
  statementLineSchema,
} from '@parkease/contracts/owner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchDashboard, fetchEarnings, fetchSpaceBookings, fetchTransactions } from '../api/owner';
import { isOwnerDevMock } from '../dev-mock';

/**
 * Fixture mode is OFF unless a dev-mock session says otherwise (ruling
 * T11-W1, extended to owner in task 7b). Every owner call goes to the network
 * by default; only a `__DEV__` build holding a dev-mock session is served the
 * fixtures, and a release build never even asks.
 *
 * Mirrors `features/washer/__tests__/dev-mock-wiring.test.ts` — same door,
 * same three properties to prove: a rejected session read resolves false and
 * logs at warn rather than rejecting (R-FAIL-01); outside `__DEV__` the
 * session is never even read; and under a dev-mock session none of
 * `api.get/post/put/patch` is called by any fetcher.
 */

const m = vi.hoisted(() => ({
  isDevMockSession: vi.fn<() => Promise<boolean>>(),
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/lib/dev-mock', () => ({ isDevMockSession: m.isDevMockSession }));

vi.mock('@/lib/log', () => ({ warn: m.warn }));

vi.mock('@/lib/api', () => ({
  api: { get: m.get, post: m.post, put: m.put, patch: m.patch },
}));

const networkDashboard = ownerDashboardSchema.parse({
  greetingName: 'Network Owner',
  owedPaise: 0,
  today: { netPaise: 0, bookings: 0 },
  month: { netPaise: 0, growthBp: null },
  activeBookings: 0,
  statement: [],
  spaces: [],
});

const networkEarnings = ownerEarningsViewSchema.parse({
  period: 'week',
  netPaise: 0,
  grossPaise: 0,
  reversedPaise: 0,
  bookings: 0,
  days: [],
});

const networkLine = statementLineSchema.parse({
  bookingId: '0192f2a1-0000-7000-8000-0000000000ab',
  occurredAt: '2026-09-24T06:00:00.000Z',
  driverName: 'Network Driver',
  spaceName: 'Network Space',
  durationLabel: '1 hr',
  basePaise: 1_000,
  feePaise: 150,
  reversedPaise: 0,
  netPaise: 850,
});

const networkBooking = ownerBookingSchema.parse({
  bookingId: '0192f2a1-0000-7000-8000-0000000000ac',
  driverName: 'Network Driver',
  vehicleType: 'car',
  slotIndex: null,
  startsAt: '2026-09-24T06:00:00.000Z',
  endsAt: '2026-09-24T07:00:00.000Z',
  status: 'active',
  earnedPaise: 0,
});

beforeEach(() => {
  for (const fn of [m.isDevMockSession, m.get, m.post, m.put, m.patch, m.warn]) fn.mockReset();
  vi.stubGlobal('__DEV__', true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('with no dev-mock session', () => {
  beforeEach(() => {
    m.isDevMockSession.mockResolvedValue(false);
  });

  it('is not in fixture mode', async () => {
    await expect(isOwnerDevMock()).resolves.toBe(false);
  });

  it('reads the dashboard from the network', async () => {
    m.get.mockResolvedValue({ data: { data: networkDashboard } });

    await expect(fetchDashboard()).resolves.toEqual(networkDashboard);
    expect(m.get).toHaveBeenCalledWith('/owner/dashboard', expect.anything());
  });

  it('reads earnings from the network', async () => {
    m.get.mockResolvedValue({ data: { data: networkEarnings } });

    await expect(fetchEarnings('week')).resolves.toEqual(networkEarnings);
    expect(m.get).toHaveBeenCalledWith('/owner/earnings', expect.anything());
  });

  it('reads transactions from the network', async () => {
    m.get.mockResolvedValue({
      data: { data: [networkLine], meta: { limit: 20, hasMore: false, nextCursor: null } },
    });

    await expect(fetchTransactions('week', undefined)).resolves.toEqual({
      data: [networkLine],
      meta: { limit: 20, hasMore: false, nextCursor: null },
    });
    expect(m.get).toHaveBeenCalledWith('/owner/earnings/transactions', expect.anything());
  });

  it('reads space bookings from the network', async () => {
    m.get.mockResolvedValue({ data: { data: [networkBooking] } });

    await expect(fetchSpaceBookings('space-1', 'active')).resolves.toEqual([networkBooking]);
    expect(m.get).toHaveBeenCalledWith('/owner/spaces/space-1/bookings', expect.anything());
  });
});

describe('when the session cannot be read', () => {
  it('is not in fixture mode, and says so at warn rather than rejecting', async () => {
    m.isDevMockSession.mockRejectedValue(new Error('keystore unavailable'));

    await expect(isOwnerDevMock()).resolves.toBe(false);
    expect(m.warn).toHaveBeenCalledTimes(1);
  });
});

describe('outside a __DEV__ build', () => {
  it('never asks for the session, and goes to the network', async () => {
    vi.stubGlobal('__DEV__', false);
    m.isDevMockSession.mockResolvedValue(true);
    m.get.mockResolvedValue({ data: { data: networkDashboard } });

    await expect(isOwnerDevMock()).resolves.toBe(false);
    await expect(fetchDashboard()).resolves.toEqual(networkDashboard);
    expect(m.isDevMockSession).not.toHaveBeenCalled();
  });
});

describe('under a dev-mock session', () => {
  beforeEach(() => {
    m.isDevMockSession.mockResolvedValue(true);
  });

  afterEach(() => {
    expect(m.get).not.toHaveBeenCalled();
    expect(m.post).not.toHaveBeenCalled();
    expect(m.put).not.toHaveBeenCalled();
    expect(m.patch).not.toHaveBeenCalled();
  });

  it('is in fixture mode', async () => {
    await expect(isOwnerDevMock()).resolves.toBe(true);
  });

  it('serves the dashboard from the fixtures, not the network', async () => {
    const dashboard = await fetchDashboard();
    expect(dashboard.greetingName).toBe('Priya');
    expect(dashboard.spaces).toEqual([]);
  });

  it('serves earnings from the fixtures, not the network', async () => {
    const earnings = await fetchEarnings('week');
    expect(earnings.period).toBe('week');
  });

  it('serves paged transactions from the fixtures, not the network', async () => {
    const page = await fetchTransactions('month', undefined);
    expect(page.data).toHaveLength(5);
    expect(page.meta).toEqual({ limit: 5, hasMore: true, nextCursor: '5' });
  });

  it('serves space bookings from the fixtures, not the network', async () => {
    const active = await fetchSpaceBookings('space-1', 'active');
    const upcoming = await fetchSpaceBookings('space-1', 'upcoming');
    const past = await fetchSpaceBookings('space-1', 'past');

    expect(active).toHaveLength(2);
    expect(upcoming).toHaveLength(1);
    expect(past).toHaveLength(2);
  });
});
