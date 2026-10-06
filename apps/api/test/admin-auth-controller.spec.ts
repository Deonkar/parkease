import 'reflect-metadata';

import { createHash } from 'node:crypto';

import { HTTP_CODE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { IS_PUBLIC_KEY } from '../src/platform/auth/public.decorator.js';
import { AdminAuthController } from '../src/roles/public/admin-auth.controller.js';
import { clearAdminCookie, serializeAdminCookie } from '../src/roles/public/admin-cookie.js';

const REFRESH = 'rtrtrtrtrtrtrtrtrtrtrtrtrtrtrtrtrtrtrtrtrtr'; // 43 base64url chars
const COOKIE = `pe_admin_rt=${REFRESH}`;

function build() {
  const execute = vi.fn().mockResolvedValue({
    accessToken: 'access-jwt',
    refreshToken: REFRESH,
    expiresIn: 900,
    roles: ['admin'],
    activeRole: 'admin',
    isNewUser: false,
  });
  const rotate = vi.fn().mockResolvedValue({
    accessToken: 'access-2',
    refreshToken: 'nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn',
    expiresIn: 900,
  });
  const revoke = vi.fn().mockResolvedValue(undefined);
  const controller = new AdminAuthController({ execute } as never, { rotate, revoke } as never);
  const header = vi.fn();
  const reply = { header } as unknown as FastifyReply;
  return { controller, execute, rotate, revoke, header, reply };
}

const req = (headers: Record<string, string> = {}): FastifyRequest =>
  ({ headers: { 'user-agent': 'jest-ua', ...headers } }) as unknown as FastifyRequest;

describe('AdminAuthController', () => {
  it('is public, mounted at auth/admin', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdminAuthController)).toBe('auth/admin');
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AdminAuthController)).toBe(true);
  });

  describe('session', () => {
    it('requires the admin role, sets the cookie, and keeps the refresh token out of the body', async () => {
      const { controller, execute, header, reply } = build();

      const body = await controller.session({ idToken: 'fb-token' }, req(), reply);

      expect(execute).toHaveBeenCalledWith({
        idToken: 'fb-token',
        userAgent: 'jest-ua',
        requireRole: 'admin',
      });
      expect(header).toHaveBeenCalledWith(
        'set-cookie',
        serializeAdminCookie(REFRESH, { secure: false }),
      );
      expect(body).not.toHaveProperty('refreshToken');
      expect(JSON.stringify(body)).not.toContain(REFRESH);
      expect(body).toMatchObject({
        accessToken: 'access-jwt',
        expiresIn: 900,
        activeRole: 'admin',
      });
    });

    it('rejects a body without an idToken before touching the command', async () => {
      const { controller, execute, reply } = build();
      await expect(controller.session({}, req(), reply)).rejects.toThrow();
      expect(execute).not.toHaveBeenCalled();
    });

    it('answers 201', () => {
      const handler = AdminAuthController.prototype.session;
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(201);
    });
  });

  describe('refresh', () => {
    it('401s when there is no cookie, without rotating anything', async () => {
      const { controller, rotate, reply } = build();
      await expect(controller.refresh(req(), reply)).rejects.toMatchObject({ status: 401 });
      expect(rotate).not.toHaveBeenCalled();
    });

    it('401s on a malformed cookie', async () => {
      const { controller, rotate, reply } = build();
      await expect(
        controller.refresh(req({ cookie: 'pe_admin_rt=short' }), reply),
      ).rejects.toMatchObject({ status: 401 });
      expect(rotate).not.toHaveBeenCalled();
    });

    it('rotates with requireRole admin and sets the new cookie', async () => {
      const { controller, rotate, header, reply } = build();

      const body = await controller.refresh(req({ cookie: COOKIE }), reply);

      expect(rotate).toHaveBeenCalledWith(REFRESH, 'jest-ua', { requireRole: 'admin' });
      expect(header).toHaveBeenCalledWith(
        'set-cookie',
        serializeAdminCookie('nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn', { secure: false }),
      );
      expect(body).toEqual({ accessToken: 'access-2', expiresIn: 900 });
    });
  });

  describe('logout', () => {
    it('revokes sha256(token), clears the cookie', async () => {
      const { controller, revoke, header, reply } = build();

      await controller.logout(req({ cookie: COOKIE }), reply);

      expect(revoke).toHaveBeenCalledWith(createHash('sha256').update(REFRESH).digest('hex'));
      expect(header).toHaveBeenCalledWith('set-cookie', clearAdminCookie({ secure: false }));
    });

    it('with no cookie still clears and does not throw or revoke', async () => {
      const { controller, revoke, header, reply } = build();

      await expect(controller.logout(req(), reply)).resolves.toBeUndefined();

      expect(revoke).not.toHaveBeenCalled();
      expect(header).toHaveBeenCalledWith('set-cookie', clearAdminCookie({ secure: false }));
    });

    it('answers 204', () => {
      const handler = AdminAuthController.prototype.logout;
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(204);
    });
  });

  describe('Secure flag', () => {
    it('follows NODE_ENV=production, never the Host header', async () => {
      vi.resetModules();
      vi.stubEnv('NODE_ENV', 'production');
      const { AdminAuthController: Prod } = await import(
        '../src/roles/public/admin-auth.controller.js'
      );
      vi.unstubAllEnvs();

      const execute = vi.fn().mockResolvedValue({
        accessToken: 'a',
        refreshToken: REFRESH,
        expiresIn: 900,
        roles: ['admin'],
        activeRole: 'admin',
        isNewUser: false,
      });
      const header = vi.fn();
      const prod = new Prod({ execute } as never, {} as never);

      await prod.session({ idToken: 't' }, req({ host: 'localhost:3000' }), {
        header,
      } as unknown as FastifyReply);

      expect(header).toHaveBeenCalledWith(
        'set-cookie',
        serializeAdminCookie(REFRESH, { secure: true }),
      );
    });
  });
});
