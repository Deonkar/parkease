import { describe, it, expect } from 'vitest';

import {
  DEFAULT_POLICY,
  RATE_LIMIT_POLICIES,
  resolvePolicy,
} from '../src/platform/ratelimit/policies.js';

describe('rate limit policies', () => {
  it('auth session routes fail closed', () => {
    const phonePolicy = RATE_LIMIT_POLICIES['POST /api/v1/auth/session:phone'];
    const ipPolicy = RATE_LIMIT_POLICIES['POST /api/v1/auth/session:ip'];
    const refreshPolicy = RATE_LIMIT_POLICIES['POST /api/v1/auth/refresh'];

    expect(phonePolicy?.failClosed).toBe(true);
    expect(ipPolicy?.failClosed).toBe(true);
    expect(refreshPolicy?.failClosed).toBe(true);
  });

  it('DEFAULT_POLICY is the strictest (10 per 60s)', () => {
    expect(DEFAULT_POLICY.limit).toBe(10);
    expect(DEFAULT_POLICY.windowSeconds).toBe(60);
  });

  it('booking limit is 10 per minute per user', () => {
    const policy = RATE_LIMIT_POLICIES['POST /api/v1/driver/bookings'];
    expect(policy).toBeDefined();
    expect(policy?.limit).toBe(10);
    expect(policy?.windowSeconds).toBe(60);
    expect(policy?.keyBy).toBe('user');
  });

  it('non-auth routes do NOT fail closed by default', () => {
    const policy = RATE_LIMIT_POLICIES['GET /api/v1/driver/spaces'];
    expect(policy?.failClosed).toBeUndefined();
  });
});

describe('resolvePolicy', () => {
  it('matches a literal route exactly', () => {
    expect(resolvePolicy('GET', '/api/v1/driver/spaces')).toBe(
      RATE_LIMIT_POLICIES['GET /api/v1/driver/spaces'],
    );
  });

  it('ignores the query string', () => {
    expect(resolvePolicy('GET', '/api/v1/driver/spaces?lat=12.93&lng=77.62')).toBe(
      RATE_LIMIT_POLICIES['GET /api/v1/driver/spaces'],
    );
  });

  it('matches a :param pattern against the real path segment', () => {
    // A request carries a zone id, not the word ":zoneId". A matcher that only
    // compared literals left every parameterised route on the strictest default
    // while its declared policy sat in the table doing nothing.
    expect(resolvePolicy('PATCH', '/api/v1/admin/surge/zones/tdr1v0')).toBe(
      RATE_LIMIT_POLICIES['PATCH /api/v1/admin/surge/zones/:zoneId'],
    );
  });

  it('prefers a literal route over a parameterised one of the same shape', () => {
    // `/admin/surge/zones` is a collection; `/admin/surge/zones/:zoneId` is not.
    expect(resolvePolicy('GET', '/api/v1/driver/spaces')).not.toBe(
      RATE_LIMIT_POLICIES['GET /api/v1/driver/spaces/:id'],
    );
  });

  it('does not let a collection policy swallow its own sub-resources', () => {
    // `POST /owner/spaces` is 10/min; `POST /owner/spaces/:id/photos` is 20.
    // Prefix matching gave the photo upload the listing's budget.
    expect(
      resolvePolicy('POST', '/api/v1/owner/spaces/0192f1b3-0000-7000-8000-000000000001/photos'),
    ).toBe(RATE_LIMIT_POLICIES['POST /api/v1/owner/spaces/:id/photos']);
  });

  it('falls back to the admin policy for an admin route with none of its own', () => {
    expect(resolvePolicy('GET', '/api/v1/admin/users')).toBe(RATE_LIMIT_POLICIES['ADMIN:*']);
  });

  it('falls back to the strictest default for anything unrecognised', () => {
    expect(resolvePolicy('POST', '/api/v1/something/new')).toBe(DEFAULT_POLICY);
  });

  it('gives every surge admin endpoint a policy of its own', () => {
    const routes = [
      ['GET', '/api/v1/admin/surge/config'],
      ['PUT', '/api/v1/admin/surge/config'],
      ['GET', '/api/v1/admin/surge/zones'],
      ['POST', '/api/v1/admin/surge/zones'],
      ['PATCH', '/api/v1/admin/surge/zones/tdr1v0'],
    ] as const;

    for (const [method, path] of routes) {
      expect(resolvePolicy(method, path)).not.toBe(RATE_LIMIT_POLICIES['ADMIN:*']);
      expect(resolvePolicy(method, path)).not.toBe(DEFAULT_POLICY);
    }
  });

  it('holds surge writes below the generic admin budget', () => {
    // A write here changes what every driver in a zone pays. It is a deliberate
    // operator action a handful of times a day, not a screen that polls.
    const adminDefault = RATE_LIMIT_POLICIES['ADMIN:*'];
    const writes = [
      ['PUT', '/api/v1/admin/surge/config'],
      ['POST', '/api/v1/admin/surge/zones'],
      ['PATCH', '/api/v1/admin/surge/zones/tdr1v0'],
    ] as const;

    for (const [method, path] of writes) {
      expect(resolvePolicy(method, path).limit).toBeLessThan(adminDefault?.limit ?? 0);
    }
  });

  it('keys every surge admin policy by user, so one admin cannot spend another admin budget', () => {
    expect(resolvePolicy('PUT', '/api/v1/admin/surge/config').keyBy).toBe('user');
    expect(resolvePolicy('GET', '/api/v1/admin/surge/config').keyBy).toBe('user');
  });
});

/**
 * Task 13. Every washer and driver car wash route has an explicit policy.
 *
 * Stated as a sweep over the route list rather than one assertion per route:
 * `resolvePolicy` falls back to `DEFAULT_POLICY` for anything unlisted, so a
 * route added later without a policy would silently inherit the strictest
 * default and be hard to tell from one that was priced deliberately. Naming
 * them here means adding a route without thinking about its budget fails.
 */
describe('car wash rate limit policies', () => {
  const WASHER_ROUTES = [
    'GET /api/v1/washer/jobs/offers',
    'GET /api/v1/washer/jobs/active',
    'POST /api/v1/washer/jobs/:id/accept',
    'POST /api/v1/washer/jobs/:id/status',
    'POST /api/v1/washer/jobs/:id/before-photo',
    'POST /api/v1/washer/jobs/:id/after-photo',
    'PATCH /api/v1/washer/availability',
    'GET /api/v1/washer/services',
    'PUT /api/v1/washer/services/:serviceName',
    'GET /api/v1/washer/earnings',
    'GET /api/v1/washer/profile',
    'POST /api/v1/washer/profile',
    'POST /api/v1/washer/profile/documents',
  ] as const;

  const DRIVER_ROUTES = [
    'POST /api/v1/driver/carwash/requests',
    'GET /api/v1/driver/carwash/requests/:id',
    'POST /api/v1/driver/carwash/requests/:id/order',
    'POST /api/v1/driver/carwash/requests/:id/cancel',
  ] as const;

  it.each([...WASHER_ROUTES, ...DRIVER_ROUTES])('%s has an explicit policy', (route) => {
    expect(RATE_LIMIT_POLICIES[route], route).toBeDefined();
  });

  it.each([...WASHER_ROUTES, ...DRIVER_ROUTES])('%s is keyed by user', (route) => {
    expect(RATE_LIMIT_POLICIES[route]?.keyBy, route).toBe('user');
  });

  /**
   * §13.11. The accept budget is the loose one for the same reason valet's is:
   * two of every three partners offered a job lose the race, and somebody whose
   * first taps lose should not be locked out of the next job they might win.
   */
  it('gives accept room to lose races', () => {
    expect(RATE_LIMIT_POLICIES['POST /api/v1/washer/jobs/:id/accept']?.limit).toBe(30);
  });

  /** Registration and documents are the tight ones: 5 a minute, per §13.11. */
  it.each(['POST /api/v1/washer/profile', 'POST /api/v1/washer/profile/documents'] as const)(
    '%s is limited to 5 a minute',
    (route) => {
      expect(RATE_LIMIT_POLICIES[route]?.limit).toBe(5);
    },
  );
});
