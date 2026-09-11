import { ForbiddenException } from '@nestjs/common';
import { describe, it, expect } from 'vitest';

import type { AuthUser } from '../src/platform/auth/current-user.decorator.js';
import { ActiveRoleGuard } from '../src/platform/rbac/active-role.guard.js';
import { RolesGuard } from '../src/platform/rbac/roles.guard.js';

function makeReflector(metadata: Record<string, unknown>) {
  return {
    getAllAndOverride: (key: string) => metadata[key],
  } as never;
}

function makeContext(
  user: AuthUser | undefined,
  url: string,
  handlerMeta: Record<string, unknown> = {},
) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user, url }),
    }),
    getHandler: () => handlerMeta,
    getClass: () => ({}),
  } as never;
}

describe('RolesGuard', () => {
  it('allows when @Public()', () => {
    const guard = new RolesGuard(makeReflector({ 'parkease:isPublic': true }));
    expect(guard.canActivate(makeContext(undefined, '/api/v1/auth/session'))).toBe(true);
  });

  it('allows when no @Roles() declared', () => {
    const guard = new RolesGuard(makeReflector({}));
    const user: AuthUser = { id: 'u1', roles: ['driver'], activeRole: 'driver' };
    expect(guard.canActivate(makeContext(user, '/api/v1/me'))).toBe(true);
  });

  it('allows when user has required role', () => {
    const guard = new RolesGuard(makeReflector({ 'parkease:roles': ['driver', 'owner'] }));
    const user: AuthUser = { id: 'u1', roles: ['driver'], activeRole: 'driver' };
    expect(guard.canActivate(makeContext(user, '/api/v1/driver/bookings'))).toBe(true);
  });

  it('throws ForbiddenException when user lacks required role', () => {
    const guard = new RolesGuard(makeReflector({ 'parkease:roles': ['admin'] }));
    const user: AuthUser = { id: 'u1', roles: ['driver'], activeRole: 'driver' };
    expect(() => guard.canActivate(makeContext(user, '/api/v1/admin/dashboard'))).toThrow(
      ForbiddenException,
    );
  });

  it('returns false when no user is present', () => {
    const guard = new RolesGuard(makeReflector({ 'parkease:roles': ['driver'] }));
    expect(guard.canActivate(makeContext(undefined, '/api/v1/driver/x'))).toBe(false);
  });
});

describe('ActiveRoleGuard', () => {
  it('allows when @Public()', () => {
    const guard = new ActiveRoleGuard(makeReflector({ 'parkease:isPublic': true }));
    expect(guard.canActivate(makeContext(undefined, '/api/v1/auth/session'))).toBe(true);
  });

  it('allows when URL has no role segment', () => {
    const guard = new ActiveRoleGuard(makeReflector({}));
    const user: AuthUser = { id: 'u1', roles: ['driver'], activeRole: 'driver' };
    expect(guard.canActivate(makeContext(user, '/api/v1/me/profile'))).toBe(true);
  });

  it('allows when activeRole matches URL segment', () => {
    const guard = new ActiveRoleGuard(makeReflector({}));
    const user: AuthUser = { id: 'u1', roles: ['driver', 'owner'], activeRole: 'owner' };
    expect(guard.canActivate(makeContext(user, '/api/v1/owner/spaces'))).toBe(true);
  });

  it('throws ForbiddenException when activeRole does not match segment', () => {
    const guard = new ActiveRoleGuard(makeReflector({}));
    const user: AuthUser = { id: 'u1', roles: ['driver', 'owner'], activeRole: 'driver' };
    expect(() => guard.canActivate(makeContext(user, '/api/v1/owner/spaces'))).toThrow(
      ForbiddenException,
    );
  });

  it('includes the segment in the error message', () => {
    const guard = new ActiveRoleGuard(makeReflector({}));
    const user: AuthUser = { id: 'u1', roles: ['driver', 'owner'], activeRole: 'driver' };
    expect(() => guard.canActivate(makeContext(user, '/api/v1/owner/spaces'))).toThrow(
      'Switch to your owner profile to do that.',
    );
  });

  it('allows shared endpoints (/me, /notifications) for any active role', () => {
    const guard = new ActiveRoleGuard(makeReflector({}));
    const user: AuthUser = { id: 'u1', roles: ['driver'], activeRole: 'driver' };
    expect(guard.canActivate(makeContext(user, '/api/v1/me/upload-signature'))).toBe(true);
    expect(guard.canActivate(makeContext(user, '/api/v1/notifications'))).toBe(true);
  });
});
