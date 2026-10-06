import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TokenService } from '../../src/platform/auth/token.service.js';
import { AuditService } from '../../src/platform/observability/audit.service.js';

import { type Harness, seedUser, startHarness, stopHarness } from './harness.js';

/**
 * Rotation's refusals against a real database.
 *
 * `rotate` revokes a family on reuse and a blocked user's tokens, and the
 * revocation is the whole point of the refusal. It used to throw from inside the
 * transaction, which rolled the revocation (and the audit row) back — leaving
 * the stolen token's siblings alive. A mock cannot model a rollback, so these
 * read the rows after the call.
 */
describe('TokenService.rotate refusals commit their writes', () => {
  let h: Harness;
  let service: TokenService;

  beforeAll(async () => {
    h = await startHarness();
    service = new TokenService(h.db, new AuditService(h.db));
  }, 300_000);

  afterAll(async () => {
    await stopHarness(h);
  });

  const mint = async (userId: string, familyId?: string) =>
    h.db.transaction(async (tx) =>
      service.issue(tx as never, { userId, roles: ['driver'], activeRole: 'driver', familyId }),
    );

  const tokensOf = (userId: string) =>
    h.sql<{ revoked_at: Date | null; revoked_reason: string | null; rotated_at: Date | null }[]>`
      SELECT revoked_at, revoked_reason, rotated_at FROM refresh_tokens WHERE user_id = ${userId}`;

  it('re-presenting a rotated token is 401, revokes every token, and leaves one audit row', async () => {
    const userId = await seedUser(h, 'driver');
    const family = randomUUID();
    const first = await mint(userId, family);
    const second = await service.rotate(first.refreshToken);

    await expect(service.rotate(first.refreshToken)).rejects.toMatchObject({ status: 401 });

    const rows = await tokensOf(userId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.revoked_at !== null)).toBe(true);
    expect(rows.every((r) => r.revoked_reason === 'refresh_reuse_detected')).toBe(true);

    const audit = await h.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM audit_log
      WHERE action = 'auth.refresh-reuse-detected' AND target_id = ${userId}`;
    expect(audit[0]?.n).toBe(1);

    // The sibling the thief never held is dead too.
    await expect(service.rotate(second.refreshToken)).rejects.toMatchObject({ status: 401 });
  });

  it("a blocked user's rotate is 403 and their tokens are revoked", async () => {
    const userId = await seedUser(h, 'driver');
    const issued = await mint(userId);
    await h.sql`UPDATE users SET status = 'blocked' WHERE id = ${userId}`;

    await expect(service.rotate(issued.refreshToken)).rejects.toMatchObject({ status: 403 });

    const rows = await tokensOf(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.revoked_at).not.toBeNull();
    expect(rows[0]?.revoked_reason).toBe('user_not_active');
  });

  it('an admin whose role was suspended is 403 and the presented row is revoked and not rotated', async () => {
    const userId = await seedUser(h, 'admin');
    const issued = await mint(userId);
    await h.sql`UPDATE user_roles SET status = 'suspended' WHERE user_id = ${userId}`;

    await expect(
      service.rotate(issued.refreshToken, undefined, { requireRole: 'admin' }),
    ).rejects.toMatchObject({ status: 403 });

    const rows = await tokensOf(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.revoked_reason).toBe('role_revoked');
    expect(rows[0]?.rotated_at).toBeNull();
  });
});
