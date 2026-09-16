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
    expect(resolvePolicy('POST', '/api/v1/owner/spaces/0192f1b3-0000-7000-8000-000000000001/photos')).toBe(
      RATE_LIMIT_POLICIES['POST /api/v1/owner/spaces/:id/photos'],
    );
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
