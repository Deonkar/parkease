import { describe, expect, it } from 'vitest';

import { envSchema } from '../src/platform/config/env.schema.js';

/** vitest.config.ts fills every required variable, so `process.env` is a valid base to vary. */
const base = (): Record<string, string | undefined> => {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env['ADMIN_ORIGIN'];
  delete env['TRUST_PROXY_HOPS'];
  return env;
};

describe('env schema: ADMIN_ORIGIN (SEC-M2, task 18a review)', () => {
  it('is optional outside production', () => {
    const parsed = envSchema.safeParse({ ...base(), NODE_ENV: 'development' });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.ADMIN_ORIGIN).toBeUndefined();
  });

  it('is required in production: an unset admin origin would leave the refresh cookie open', () => {
    const parsed = envSchema.safeParse({ ...base(), NODE_ENV: 'production' });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.path.join('.'))).toContain('ADMIN_ORIGIN');
  });

  it('is reduced to its origin, so a trailing slash or path cannot make it match nothing', () => {
    const parsed = envSchema.safeParse({
      ...base(),
      NODE_ENV: 'production',
      ADMIN_ORIGIN: 'https://admin.parkease.in/',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.ADMIN_ORIGIN).toBe('https://admin.parkease.in');
  });

  it('refuses something that is not a URL', () => {
    expect(envSchema.safeParse({ ...base(), ADMIN_ORIGIN: 'admin.parkease.in' }).success).toBe(
      false,
    );
  });
});

describe('env schema: TRUST_PROXY_HOPS (SEC-M3, task 18a review)', () => {
  it('defaults to one hop, the load balancer in front of the API', () => {
    const parsed = envSchema.safeParse(base());
    expect(parsed.success).toBe(true);
    expect(parsed.data?.TRUST_PROXY_HOPS).toBe(1);
  });

  it.each([
    ['0', 0],
    ['2', 2],
  ])('parses an explicit %s as the number %d', (raw, hops) => {
    const parsed = envSchema.safeParse({ ...base(), TRUST_PROXY_HOPS: raw });
    expect(parsed.data?.TRUST_PROXY_HOPS).toBe(hops);
  });

  it.each(['-1', '1.5', 'true', 'all'])(
    'refuses %s: trust is a hop count, never a blanket yes',
    (raw) => {
      expect(envSchema.safeParse({ ...base(), TRUST_PROXY_HOPS: raw }).success).toBe(false);
    },
  );
});
