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

  describe('rotate with requireRole (task 18a)', () => {
    const PRESENTED = 'presented-refresh-token-value-0123456789abcdef';

    interface Fixture {
      readonly service: TokenService;
      readonly sets: Record<string, unknown>[];
      readonly inserts: unknown[];
      readonly state: { rolledBack: boolean };
    }

    /**
     * A transaction double that answers select() in the order rotate() asks:
     * token row, user, active roles. `rolledBack` models Postgres: a throw out
     * of the callback undoes everything the callback wrote, so the revocation
     * is only durable if rotate() returns normally and throws afterwards.
     */
    function fixture(activeRoles: string[]): Fixture {
      const sets: Record<string, unknown>[] = [];
      const inserts: unknown[] = [];
      const state = { rolledBack: false };

      const tokenRow = {
        id: 'row-1',
        userId: 'user-1',
        familyId: 'family-1',
        rotatedAt: null,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      };

      const answers: unknown[][] = [
        [tokenRow],
        [{ status: 'active' }],
        activeRoles.map((role) => ({ role })),
      ];
      let call = 0;

      const next = (): Promise<unknown[]> => Promise.resolve(answers[call++] ?? []);
      const tx = {
        select: () => ({
          from: () => ({
            where: () => {
              const result = next();
              return Object.assign(result, { for: () => result });
            },
          }),
        }),
        update: () => ({
          set: (values: Record<string, unknown>) => {
            sets.push(values);
            return { where: () => Promise.resolve(undefined) };
          },
        }),
        insert: () => ({
          values: (values: unknown) => {
            inserts.push(values);
            return Promise.resolve(undefined);
          },
        }),
      };

      const db = {
        transaction: async (cb: (t: unknown) => Promise<unknown>) => {
          try {
            return await cb(tx);
          } catch (err) {
            state.rolledBack = true;
            throw err;
          }
        },
      };

      return { service: new TokenService(db as never, audit), sets, inserts, state };
    }

    it('revokes the row, issues nothing, and commits when the admin role is gone', async () => {
      const { service, sets, inserts, state } = fixture(['driver']);

      await expect(
        service.rotate(PRESENTED, undefined, { requireRole: 'admin' }),
      ).rejects.toMatchObject({ status: 403 });

      expect(sets).toHaveLength(1);
      expect(sets[0]).toMatchObject({ revokedReason: 'role_revoked' });
      expect(sets[0]?.['revokedAt']).toBeInstanceOf(Date);
      expect(sets[0]).not.toHaveProperty('rotatedAt');
      expect(inserts).toHaveLength(0);
      // The revocation is durable only if the transaction callback did not throw.
      expect(state.rolledBack).toBe(false);
    });

    it('answers with the ADMIN_ROLE_REQUIRED code', async () => {
      const { service } = fixture([]);
      const err: unknown = await service
        .rotate(PRESENTED, undefined, { requireRole: 'admin' })
        .catch((e: unknown) => e);
      expect(err).toMatchObject({ response: { error: 'ADMIN_ROLE_REQUIRED' } });
    });

    it('makes admin the active role when held, even if driver sorts first', async () => {
      const { service } = fixture(['driver', 'admin']);

      const tokens = await service.rotate(PRESENTED, undefined, { requireRole: 'admin' });
      const { payload } = await jwtVerify(tokens.accessToken, JWT_SECRET, {
        algorithms: ['HS256'],
      });

      expect(payload['active_role']).toBe('admin');
      expect(payload['roles']).toEqual(['driver', 'admin']);
    });

    it('without requireRole keeps the first role as before', async () => {
      const { service } = fixture(['driver', 'admin']);

      const tokens = await service.rotate(PRESENTED);
      const { payload } = await jwtVerify(tokens.accessToken, JWT_SECRET, {
        algorithms: ['HS256'],
      });

      expect(payload['active_role']).toBe('driver');
    });
  });
});
