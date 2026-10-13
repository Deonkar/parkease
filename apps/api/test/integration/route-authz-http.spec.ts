import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Harness, seedUser, startHarness, stopHarness } from './harness.js';
import { actingAs, type HttpApp, startHttpApp, stopHttpApp } from './http-harness.js';

/**
 * The authorisation matrix for every route the app registers (security pass, task 21): read from
 * Fastify's own route table, so a route added tomorrow is in the matrix without anyone listing it.
 *
 * - Nobody signed in is 401 everywhere but the public surface (auth, health, webhooks).
 * - Each role reaches its own surface and is refused (403) on every other role's: `/driver`,
 *   `/owner`, `/valet`, `/washer`, `/admin`. `/me` is anyone signed in, except the payee routes
 *   (`ME_RESTRICTED`).
 *
 * A refusal must come from the guards, before any handler: so "allowed" is asserted as "not 401
 * and not 403" (a 400 or 404 from the handler is fine), and "refused" as exactly 403.
 * `admin-authz-http.spec.ts` and `admin-pentest.spec.ts` go deeper on the admin surface.
 */
const ROLES = ['driver', 'owner', 'valet', 'washer', 'admin'] as const;
type RoleName = (typeof ROLES)[number];

const PUBLIC = [/^\/api\/v1\/auth\//, /^\/api\/v1\/health/, /^\/api\/v1\/webhooks\//];

/**
 * `/me` routes narrower than "anyone signed in": money goes to payees (Route or RazorpayX), and
 * the weekly summary is RazorpayX's, which only valets are paid through.
 */
const ME_RESTRICTED: readonly { readonly pattern: RegExp; readonly roles: readonly RoleName[] }[] =
  [
    { pattern: /^\/api\/v1\/me\/payouts\/summary$/, roles: ['valet'] },
    { pattern: /^\/api\/v1\/me\/(bank-details|payouts)/, roles: ['owner', 'valet', 'washer'] },
    { pattern: /^\/api\/v1\/me\/route-onboarding/, roles: ['owner', 'washer'] },
  ];

/** Who may pass the guards on a route: `public`, or the roles allowed. */
const allowedOn = (url: string): 'public' | readonly RoleName[] => {
  if (PUBLIC.some((p) => p.test(url))) return 'public';
  const match = /^\/api\/v1\/(driver|owner|valet|washer|admin)\//.exec(url);
  if (match !== null) return [match[1] as RoleName];
  if (url.startsWith('/api/v1/me')) {
    return ME_RESTRICTED.find((r) => r.pattern.test(url))?.roles ?? ROLES;
  }
  throw new Error(`route outside every surface the matrix knows: ${url}`);
};

const fill = (url: string) =>
  url.replace(/:(\w+)/g, (_, name: string) => (name === 'zoneId' ? 'tdr1v0' : crypto.randomUUID()));

describe('authorisation matrix over every route', () => {
  let h: Harness;
  let http: HttpApp;
  const routes: { method: string; url: string }[] = [];
  const ids = new Map<RoleName, string>();

  beforeAll(async () => {
    h = await startHarness();
    http = await startHttpApp(h, undefined, undefined, undefined, ({ method, url }) => {
      if (method !== 'HEAD' && method !== 'OPTIONS' && url.startsWith('/api/v1/')) {
        routes.push({ method, url });
      }
    });
    for (const role of ROLES) ids.set(role, await seedUser(h, role));
  }, 300_000);

  afterAll(async () => {
    await stopHttpApp(http);
    await stopHarness(h);
  });

  const call = (method: string, url: string) =>
    http.request({
      method: method as 'GET',
      url: fill(url),
      headers: { 'idempotency-key': crypto.randomUUID() },
      // A JSON body on every write, DELETE included: an empty one is refused at parse time,
      // before the guards this matrix is about.
      ...(method === 'GET' ? {} : { payload: {} }),
    });

  it('found the route table', () => {
    expect(routes.length).toBeGreaterThan(80);
  });

  it('refuses everyone not signed in, except on the public surface', async () => {
    actingAs.user = null;
    const leaks: string[] = [];
    for (const { method, url } of routes) {
      if (allowedOn(url) === 'public') continue;
      const res = await call(method, url);
      if (res.status !== 401) leaks.push(`${method} ${url} → ${String(res.status)}`);
    }
    expect(leaks).toEqual([]);
  });

  it.each(ROLES)('lets %s through only where its role is allowed', async (role) => {
    actingAs.user = { id: ids.get(role) ?? '', roles: [role], activeRole: role };
    const wrong: string[] = [];
    for (const { method, url } of routes) {
      const who = allowedOn(url);
      if (who === 'public') continue;
      const allowed = who.includes(role);
      const { status } = await call(method, url);
      const refused = status === 401 || status === 403;
      if (allowed === refused) wrong.push(`${method} ${url} → ${String(status)}`);
      if (!allowed && status !== 403) wrong.push(`${method} ${url} → ${String(status)}, not 403`);
    }
    expect(wrong).toEqual([]);
  });
});
