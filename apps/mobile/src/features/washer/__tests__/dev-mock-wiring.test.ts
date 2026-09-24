import { upsertWashServiceSchema, washJobOfferSchema } from '@parkease/contracts/washer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acceptOffer,
  advanceJob,
  attachPhoto,
  fetchActiveJob,
  fetchEarnings,
  fetchMenu,
  fetchOffers,
  fetchProfile,
  setAvailability,
  upsertService,
} from '../api/washer';
import { isWasherDevMock } from '../dev-mock';

/**
 * Fixture mode is OFF unless a dev-mock session says otherwise (ruling
 * T11-W1). Every washer call goes to the network by default; only a `__DEV__`
 * build holding a dev-mock session is served the in-memory store, and a release
 * build never even asks.
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

const intent = { idempotencyKey: '018f5e2a-0000-7000-8000-000000000001' };

const networkOffer = washJobOfferSchema.parse({
  jobId: '0192f2a1-0000-7000-8000-0000000000aa',
  bookingId: '0192f2a1-0000-7000-8000-0000000000bb',
  serviceName: 'basic_exterior',
  vehicleType: 'car',
  spaceLocation: { lat: 12.97, lng: 77.59 },
  distanceM: 900,
  earningsPaise: 23_920,
  offeredAt: '2026-09-24T06:00:00.000Z',
  expiresAt: '2026-09-24T06:05:00.000Z',
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
    await expect(isWasherDevMock()).resolves.toBe(false);
  });

  it('reads offers from the network', async () => {
    m.get.mockResolvedValue({ data: { data: [networkOffer] } });

    await expect(fetchOffers()).resolves.toEqual([networkOffer]);
    expect(m.get).toHaveBeenCalledWith('/washer/jobs/offers', expect.anything());
  });

  it('sends presence as a real PATCH', async () => {
    m.patch.mockResolvedValue({ data: null });

    await setAvailability(true, intent, { lat: 12.97, lng: 77.59 });

    expect(m.patch).toHaveBeenCalledTimes(1);
  });
});

describe('when the session cannot be read', () => {
  it('is not in fixture mode, and says so at warn rather than rejecting', async () => {
    m.isDevMockSession.mockRejectedValue(new Error('keystore unavailable'));

    await expect(isWasherDevMock()).resolves.toBe(false);
    expect(m.warn).toHaveBeenCalledTimes(1);
  });
});

describe('outside a __DEV__ build', () => {
  it('never asks for the session, and goes to the network', async () => {
    vi.stubGlobal('__DEV__', false);
    m.isDevMockSession.mockResolvedValue(true);
    m.get.mockResolvedValue({ data: { data: [networkOffer] } });

    await expect(isWasherDevMock()).resolves.toBe(false);
    await expect(fetchOffers()).resolves.toEqual([networkOffer]);
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
    await expect(isWasherDevMock()).resolves.toBe(true);
  });

  it('serves every read from the fixtures', async () => {
    expect((await fetchProfile()).verificationStatus).toBe('verified');
    expect((await fetchMenu()).services.length).toBeGreaterThan(0);
    expect((await fetchEarnings('week')).period).toBe('week');
    expect(await fetchActiveJob()).toBeNull();
    expect((await fetchOffers()).length).toBeGreaterThan(0);
  });

  it('goes online without a PATCH, and the profile says so', async () => {
    await setAvailability(true, intent, { lat: 12.97, lng: 77.59 });
    expect((await fetchProfile()).isOnline).toBe(true);

    await setAvailability(false, intent);
    expect((await fetchProfile()).isOnline).toBe(false);
  });

  it('walks a job through the store, not the network', async () => {
    const [offer] = await fetchOffers();
    if (offer === undefined) throw new Error('no fixture offer');

    let job = await acceptOffer(offer.jobId, intent);
    expect(await fetchActiveJob()).toEqual(job);

    job = await advanceJob(job.id, 'en_route', intent);
    job = await attachPhoto(job.id, 'before', 'dev-photo-before', intent);
    job = await advanceJob(job.id, 'start_washing', intent);
    job = await attachPhoto(job.id, 'after', 'dev-photo-after', intent);
    job = await advanceJob(job.id, 'complete', intent);

    expect(job.status).toBe('completed');
    expect((await fetchEarnings('today')).lines.map((l) => l.jobId)).toContain(job.id);
  });

  it('saves a menu row into the store', async () => {
    const menu = await upsertService(
      'quick_wipe',
      upsertWashServiceSchema.parse({
        carPricePaise: 19_900,
        bikePricePaise: 9_900,
        durationMinutes: 15,
        isActive: true,
      }),
      intent,
    );

    expect(menu.services.some((s) => s.serviceName === 'quick_wipe')).toBe(true);
    expect(await fetchMenu()).toEqual(menu);
  });
});
