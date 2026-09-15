import 'reflect-metadata';

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
     * ADR-011. On a booking, a retried POST that is not deduplicated produces a
     * second reservation, which matters more here than anywhere else in the API.
     * The interceptor itself is tested in idempotency.spec.ts; what this catches
     * is a new mutation being added without it.
     */
    it.each(
      routes.filter((r) => r.method !== RequestMethod.GET).map((r) => [r.handler, r] as const),
    )('mutation %s requires an Idempotency-Key', (_handler, route) => {
      expect(route.interceptors).toContain(IdempotencyInterceptor);
    });

    it('does not put an idempotency interceptor on a read', () => {
      for (const route of routes.filter((r) => r.method === RequestMethod.GET)) {
        expect(route.interceptors).not.toContain(IdempotencyInterceptor);
      }
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
