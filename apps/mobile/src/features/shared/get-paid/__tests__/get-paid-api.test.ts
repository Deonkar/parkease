import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchBankDetails, fetchRouteOnboarding } from '../api';

const m = vi.hoisted(() => ({ get: vi.fn(), warn: vi.fn() }));

vi.mock('@/lib/dev-mock', () => ({ isDevMockSession: () => Promise.resolve(false) }));
vi.mock('@/lib/log', () => ({ warn: m.warn }));
vi.mock('@/lib/api', () => ({ api: { get: m.get } }));

const notFound = (code?: string) => ({
  response: {
    status: 404,
    data:
      code === undefined
        ? { message: 'Route GET:/api/v1/me/route-onboarding not found' }
        : { error: { code, message: 'Not yet.', traceId: 't-1' } },
  },
});

/**
 * "Not set up yet" is the server's domain 404, by code — not any 404. A misrouted base URL or
 * a deploy without the route answers a bare 404 too, and reading that as "none" would ask a
 * payee who is already set up to enter their PAN and bank again.
 */
describe('Get paid reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the domain 404 as not set up yet', async () => {
    m.get.mockRejectedValueOnce(notFound('ROUTE_ONBOARDING_NOT_FOUND'));
    await expect(fetchRouteOnboarding()).resolves.toBeNull();

    m.get.mockRejectedValueOnce(notFound('BANK_DETAILS_NOT_FOUND'));
    await expect(fetchBankDetails()).resolves.toBeNull();
  });

  it('throws any other 404 to the error state', async () => {
    const bare = notFound();
    m.get.mockRejectedValueOnce(bare);
    await expect(fetchRouteOnboarding()).rejects.toBe(bare);

    const wrongCode = notFound('ROUTE_ONBOARDING_NOT_FOUND');
    m.get.mockRejectedValueOnce(wrongCode);
    await expect(fetchBankDetails()).rejects.toBe(wrongCode);
  });
});
