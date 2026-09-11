import { describe, it, expect } from 'vitest';

import { DEFAULT_POLICY, RATE_LIMIT_POLICIES } from '../src/platform/ratelimit/policies.js';

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
