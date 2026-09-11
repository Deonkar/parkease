import { SignJWT, jwtVerify } from 'jose';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TokenService, type IssueInput } from '../src/platform/auth/token.service.js';
import type { TxHandle } from '../src/platform/db/transaction.js';
import { AuditService } from '../src/platform/observability/audit.service.js';

const JWT_SECRET = new TextEncoder().encode('test-secret-that-is-at-least-32-chars-long!!');

function makeMockTx(): TxHandle {
  return {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ key: '1' }]),
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          for: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  } as unknown as TxHandle;
}

describe('TokenService', () => {
  let service: TokenService;
  const audit = { record: vi.fn() } as unknown as AuditService;

  beforeEach(() => {
    service = new TokenService({} as never, audit);
  });

  describe('issue', () => {
    it('returns accessToken, refreshToken, and expiresIn', async () => {
      const tx = makeMockTx();
      const input: IssueInput = {
        userId: 'user-123',
        roles: ['driver'],
        activeRole: 'driver',
      };

      const result = await service.issue(tx, input);

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.expiresIn).toBe(900);
    });

    it('produces an access token with sub, roles, active_role, jti, iat, exp and no PII', async () => {
      const tx = makeMockTx();
      const input: IssueInput = {
        userId: 'user-456',
        roles: ['driver', 'owner'],
        activeRole: 'owner',
      };

      const result = await service.issue(tx, input);
      const { payload } = await jwtVerify(result.accessToken, JWT_SECRET, {
        algorithms: ['HS256'],
      });

      expect(payload.sub).toBe('user-456');
      expect(payload['roles']).toEqual(['driver', 'owner']);
      expect(payload['active_role']).toBe('owner');
      expect(payload.jti).toBeDefined();
      expect(payload.iat).toBeDefined();
      expect(payload.exp).toBeDefined();

      const text = JSON.stringify(payload);
      expect(text).not.toContain('phone');
      expect(text).not.toContain('+91');
    });

    it('sets activeRole to null when no roles', async () => {
      const tx = makeMockTx();
      const input: IssueInput = {
        userId: 'user-789',
        roles: [],
        activeRole: null,
      };

      const result = await service.issue(tx, input);
      const { payload } = await jwtVerify(result.accessToken, JWT_SECRET, {
        algorithms: ['HS256'],
      });

      expect(payload['active_role']).toBeNull();
      expect(payload['roles']).toEqual([]);
    });
  });

  describe('verifyAccessToken', () => {
    it('verifies a valid token', async () => {
      const token = await new SignJWT({
        roles: ['driver'],
        active_role: 'driver',
        jti: 'test-jti',
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('user-1')
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign(JWT_SECRET);

      const payload = await service.verifyAccessToken(token);
      expect(payload.sub).toBe('user-1');
      expect(payload.roles).toEqual(['driver']);
      expect(payload.active_role).toBe('driver');
    });

    it('rejects an expired token', async () => {
      const token = await new SignJWT({
        roles: ['driver'],
        active_role: 'driver',
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('user-1')
        .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
        .sign(JWT_SECRET);

      await expect(service.verifyAccessToken(token)).rejects.toThrow('Invalid or expired token.');
    });

    it('rejects a token signed with a different secret', async () => {
      const badSecret = new TextEncoder().encode('wrong-secret-that-is-also-at-least-32-char');
      const token = await new SignJWT({ roles: [], active_role: null })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('user-1')
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign(badSecret);

      await expect(service.verifyAccessToken(token)).rejects.toThrow('Invalid or expired token.');
    });
  });
});
