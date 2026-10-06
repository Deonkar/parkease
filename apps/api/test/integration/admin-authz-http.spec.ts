import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedUser, startHarness, stopHarness, type Harness } from './harness.js';
import { actingAs, type HttpApp, startHttpApp, stopHttpApp } from './http-harness.js';

const ADMIN_PREFIX = '/api/v1/admin/';

/** The surge zone id is validated as a geohash, so a uuid would be a 400 rather than a 404. */
const ZONE_ID = 'tdr1v0';

interface AdminRoute {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** The pattern Fastify registered, e.g. `/api/v1/admin/spaces/:id/approve`. */
  readonly pattern: string;
  /** The pattern with every `:param` filled in, ready to request. */
  readonly url: string;
}

/** Every `:param` becomes a fresh uuid, except the surge zone, which is a geohash. */
const fillParams = (pattern: string): string =>
  pattern.replace(/:(\w+)/g, (_, name: string) =>
    name === 'zoneId' ? ZONE_ID : crypto.randomUUID(),
  );

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** A method outside this list throws inside the hook, so boot fails loudly rather than skipping it. */
const asMethod = (method: string): AdminRoute['method'] => {
  const found = METHODS.find((m) => m === method);
  if (found === undefined) throw new Error(`admin route with unexpected method ${method}`);
  return found;
};

const NON_ADMIN_ROLES = ['driver', 'owner', 'valet', 'washer'] as const;

/**
 * Every route under `/api/v1/admin/`, enumerated from Fastify's own route table, must refuse
 * anyone who is not an admin acting as an admin.
 *
 * The list is not written down here. A hand-kept list is exactly what lets a new controller
 * ship without a guard: nobody remembers to add the row. `startHttpApp`'s `onRoute` hook sees
 * every route Nest registers, so a controller added tomorrow is covered by this file the
 * moment it exists. The real `RolesGuard` and `ActiveRoleGuard` run — only authentication is
 * stubbed — so a 403 here is the status a real caller would get.
 */
describe('admin authorisation, every route', () => {
  let h: Harness;
  let http: HttpApp;
  let adminId: string;
  let routes: AdminRoute[];

  beforeAll(async () => {
    h = await startHarness();
    const seen = new Map<string, AdminRoute>();
    http = await startHttpApp(h, undefined, undefined, undefined, ({ method, url }) => {
      // Fastify adds a HEAD twin for every GET and the adapter may add OPTIONS; neither is a route
      // anyone wrote.
      if (method === 'HEAD' || method === 'OPTIONS') return;
      if (!url.startsWith(ADMIN_PREFIX)) return;
      seen.set(`${method} ${url}`, {
        method: asMethod(method),
        pattern: url,
        url: fillParams(url),
      });
    });
    routes = [...seen.values()];
    adminId = await seedUser(h, 'admin');
  }, 300_000);

  afterAll(async () => {
    await stopHttpApp(http);
    await stopHarness(h);
  });

  const call = (route: AdminRoute) =>
    http.request({
      method: route.method,
      url: route.url,
      headers: { 'idempotency-key': crypto.randomUUID() },
      // Fastify refuses an empty body under `content-type: json` before any guard runs, which
      // would turn a missing guard into a 400 and hide it.
      ...(route.method === 'GET' ? {} : { payload: {} }),
    });

  it('enumerates the admin route table, and the enumeration is not empty', () => {
    // 34 at the time of writing. The floor is what stops an enumeration that silently captured
    // nothing (a hook registered too late) from passing every other test here vacuously.
    expect(routes.length).toBeGreaterThanOrEqual(30);
    expect(routes.some((r) => r.method !== 'GET')).toBe(true);
  });

  it('never enumerates the public admin session routes', () => {
    // `/auth/admin/*` signs an admin in, so it is public by design and lives outside the prefix.
    expect(routes.every((r) => r.pattern.startsWith(ADMIN_PREFIX))).toBe(true);
  });

  it('answers 401 to nobody, on every route', async () => {
    actingAs.user = null;
    const wrong: string[] = [];
    for (const route of routes) {
      const res = await call(route);
      if (res.status !== 401)
        wrong.push(`${route.method} ${route.pattern} -> ${String(res.status)}`);
    }
    expect(wrong).toEqual([]);
  });

  for (const role of NON_ADMIN_ROLES) {
    it(`answers 403 to a ${role}, on every route`, async () => {
      actingAs.user = { id: crypto.randomUUID(), roles: [role], activeRole: role };
      const wrong: string[] = [];
      for (const route of routes) {
        const res = await call(route);
        if (res.status !== 403)
          wrong.push(`${route.method} ${route.pattern} -> ${String(res.status)}`);
      }
      expect(wrong).toEqual([]);
    });
  }

  it('answers 403 to a non-admin whose session claims the admin profile, on every route', async () => {
    // ActiveRoleGuard reads the profile out of the URL, so a driver whose active role were
    // somehow 'admin' would sail through it. What stops them is `@Roles(Role.ADMIN)` on the
    // controller: without this case, deleting that decorator leaves every other test here green,
    // because the URL-based guard covers for it. Each guard has to be provably necessary.
    const wrong: string[] = [];
    for (const role of NON_ADMIN_ROLES) {
      actingAs.user = { id: crypto.randomUUID(), roles: [role], activeRole: 'admin' };
      for (const route of routes) {
        const res = await call(route);
        if (res.status !== 403) {
          wrong.push(`${role} ${route.method} ${route.pattern} -> ${String(res.status)}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('answers 403 to an admin who is acting as a driver, on every route', async () => {
    // Holding the admin role is not being in the admin profile.
    actingAs.user = { id: adminId, roles: ['driver', 'admin'], activeRole: 'driver' };
    const wrong: string[] = [];
    for (const route of routes) {
      const res = await call(route);
      if (res.status !== 403)
        wrong.push(`${route.method} ${route.pattern} -> ${String(res.status)}`);
    }
    expect(wrong).toEqual([]);
  });

  it('lets an admin acting as an admin past both guards on every route (the control)', async () => {
    // Without this, "everything is 403" would pass for a route that refuses everyone, or one the
    // fake path params could not reach. Past the guards the answer is whatever the handler says
    // — 200, 400 for the empty body, 404 for the random id — but never 401 or 403.
    actingAs.user = { id: adminId, roles: ['admin'], activeRole: 'admin' };
    const wrong: string[] = [];
    for (const route of routes) {
      const res = await call(route);
      if (res.status === 401 || res.status === 403 || res.status >= 500) {
        wrong.push(`${route.method} ${route.pattern} -> ${String(res.status)}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
