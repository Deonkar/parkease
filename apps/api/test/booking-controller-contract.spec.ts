import 'reflect-metadata';

import { readFile } from 'node:fs/promises';

import { RequestMethod } from '@nestjs/common';
import { INTERCEPTORS_METADATA, PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import { IdempotencyInterceptor } from '../src/platform/idempotency/idempotency.interceptor.js';
import { RATE_LIMIT_POLICIES } from '../src/platform/ratelimit/policies.js';
import { ROLES_KEY } from '../src/platform/rbac/roles.decorator.js';
import { DriverBookingsController } from '../src/roles/driver/bookings.controller.js';
import { OwnerBookingsController } from '../src/roles/owner/bookings.controller.js';

type Ctor = new (...args: never[]) => object;

interface RouteInfo {
  readonly handler: string;
  readonly method: RequestMethod;
  readonly path: string;
  readonly interceptors: unknown[];
}

/**
 * Nest records routes as decorator metadata, so they can be read back without
 * bootstrapping the container — which matters here, because bootstrapping
 * AppModule constructs FirebaseVerifierService and takes DI down with it under
 * fake credentials (learnings.md).
 */
function routesOf(controller: Ctor): RouteInfo[] {
  const proto = controller.prototype as Record<string, unknown>;

  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor')
    .map((name) => ({ name, fn: proto[name] }))
    .filter((entry): entry is { name: string; fn: object } => typeof entry.fn === 'function')
    .filter((entry) => Reflect.hasMetadata(METHOD_METADATA, entry.fn))
    .map((entry) => ({
      handler: entry.name,
      method: Reflect.getMetadata(METHOD_METADATA, entry.fn) as RequestMethod,
      path: String(Reflect.getMetadata(PATH_METADATA, entry.fn) ?? ''),
      interceptors: (Reflect.getMetadata(INTERCEPTORS_METADATA, entry.fn) as unknown[]) ?? [],
    }));
}

const CONTROLLERS: ReadonlyArray<readonly [string, Ctor, string]> = [
  ['driver', DriverBookingsController as Ctor, 'driver/bookings'],
  ['owner', OwnerBookingsController as Ctor, 'owner/bookings'],
];

describe('booking controllers', () => {
  describe.each(CONTROLLERS)('%s', (_label, controller, basePath) => {
    const routes = routesOf(controller);

    it('declares at least one route', () => {
      expect(routes.length).toBeGreaterThan(0);
    });

    it('is mounted under its role prefix', () => {
      expect(Reflect.getMetadata(PATH_METADATA, controller)).toBe(basePath);
    });

    it('is role-guarded at the class level', () => {
      // Role guard is not an ownership check — the commands do that too (rule 7).
      // This asserts the first half is never simply missing.
      expect(Reflect.getMetadata(ROLES_KEY, controller)).toBeDefined();
    });

    /**
     * ADR-011 is enforced by the *global* `IdempotencyInterceptor` in AppModule,
     * which already covers every non-GET route in the application.
     *
     * So the invariant worth testing is the opposite of the obvious one: no
     * controller may re-declare it. An earlier version of these controllers did,
     * and the result was that the interceptor ran twice per request — the second
     * `claim()` found the row the first had just taken, answered `in_flight`,
     * and every booking mutation returned 409. The integration tests never saw
     * it because they drive the commands directly, and the first version of
     * *this* test asserted the decorator was present, which cemented the bug.
     */
    it.each(
      routes.filter((r) => r.method !== RequestMethod.GET).map((r) => [r.handler, r] as const),
    )('mutation %s does not re-declare the global idempotency interceptor', (_handler, route) => {
      expect(route.interceptors).not.toContain(IdempotencyInterceptor);
    });

    it('declares at least one mutation, so the rule above is not vacuous', () => {
      expect(routes.some((r) => r.method !== RequestMethod.GET)).toBe(true);
    });

    /**
     * "A missing policy inherits the strictest default" is true but silent, and
     * the strictest default is 10/min — wrong for a list a driver pulls to
     * refresh. Every route gets a policy on purpose, not by fallback.
     */
    it.each(routes.map((r) => [r.handler, r] as const))(
      '%s has an explicit rate-limit policy',
      (_handler, route) => {
        // A bare @Get()/@Post() records its path as '/', not ''.
        const verb = RequestMethod[route.method];
        const suffix = route.path === '' || route.path === '/' ? '' : `/${route.path}`;
        const key = `${verb} /api/v1/${basePath}${suffix}`;
        expect(Object.keys(RATE_LIMIT_POLICIES)).toContain(key);
      },
    );
  });

  /**
   * The other half of the rule above. If the global registration is ever
   * removed, the controllers stop being idempotent entirely and nothing else in
   * this file would notice — the `not.toContain` assertions would still pass.
   */
  it('registers the idempotency interceptor globally, exactly once', async () => {
    const source = await readFile(new URL('../src/app.module.ts', import.meta.url), 'utf8');
    const registrations = source.match(
      /provide:\s*APP_INTERCEPTOR,\s*useClass:\s*IdempotencyInterceptor/g,
    );
    expect(registrations).toHaveLength(1);
  });

  it('routes both check-ins through one command, under two role prefixes', () => {
    const driver = routesOf(DriverBookingsController as Ctor).find((r) =>
      r.path.endsWith('check-in'),
    );
    const owner = routesOf(OwnerBookingsController as Ctor).find((r) =>
      r.path.endsWith('check-in'),
    );

    // ADR-016: two role folders, two authorisation contexts, two response
    // shapes, one piece of business logic.
    expect(driver).toBeDefined();
    expect(owner).toBeDefined();
    expect(driver?.method).toBe(RequestMethod.POST);
    expect(owner?.method).toBe(RequestMethod.POST);
  });
});
