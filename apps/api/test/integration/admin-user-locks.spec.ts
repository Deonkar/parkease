import { HttpException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GrantRoleCommand } from '../../src/domains/identity/commands/grant-role.command.js';
import { RevokeRoleCommand } from '../../src/domains/identity/commands/revoke-role.command.js';
import { SetUserStatusCommand } from '../../src/domains/identity/commands/set-user-status.command.js';
import { TokenService } from '../../src/platform/auth/token.service.js';
import { pgSqlState } from '../../src/platform/db/errors.js';
import { AuditService } from '../../src/platform/observability/audit.service.js';

import { type Harness, seedUser, startHarness, stopHarness } from './harness.js';

/**
 * DB-9 (task 18a review). The admin user commands locked the target `users` row `FOR UPDATE`.
 * That lock conflicts with the `FOR KEY SHARE` every FK insert takes on the row it references,
 * and each command inserts an `audit_log` row referencing its ACTOR. Two admins acting on each
 * other therefore each held the other's row and waited on their own: a deadlock, 40P01, a 500.
 * `FOR NO KEY UPDATE` still serialises writers on the target and lets FK inserts through.
 *
 * The commands are driven directly, not over HTTP: the HTTP harness authenticates through one
 * shared `actingAs`, so two concurrent requests cannot carry two different admins.
 */
describe('admin user commands: two admins acting on each other', () => {
  let h: Harness;
  let audit: AuditService;
  let revoke: RevokeRoleCommand;
  let grant: GrantRoleCommand;
  let status: SetUserStatusCommand;

  beforeAll(async () => {
    h = await startHarness();
    audit = new AuditService(h.db);
    revoke = new RevokeRoleCommand(h.db, audit);
    grant = new GrantRoleCommand(h.db, audit);
    status = new SetUserStatusCommand(h.db, audit, new TokenService(h.db, audit));
  }, 300_000);

  afterAll(async () => {
    await stopHarness(h);
  });

  /** Settled outcomes, each a status code: 200 for success, the HttpException status otherwise. */
  const outcomes = async (work: Promise<void>[]): Promise<(number | string)[]> =>
    (await Promise.allSettled(work)).map((r) => {
      if (r.status === 'fulfilled') return 200;
      const reason: unknown = r.reason;
      if (reason instanceof HttpException) return reason.getStatus();
      return `500 (${pgSqlState(reason) ?? String(reason)})`;
    });

  const ROUNDS = 10;

  it('revoking each other’s admin role settles every round, never a deadlock', async () => {
    const failures: string[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      const a = await seedUser(h, 'admin');
      const b = await seedUser(h, 'admin');
      const result = await outcomes([
        revoke.execute(
          { userId: b, role: 'admin', reason: 'a revokes b' },
          {
            userId: a,
            ipAddress: null,
          },
        ),
        revoke.execute(
          { userId: a, role: 'admin', reason: 'b revokes a' },
          {
            userId: b,
            ipAddress: null,
          },
        ),
      ]);
      if (result.some((s) => typeof s === 'string' || s >= 500)) {
        failures.push(`round ${String(round)}: ${result.join(', ')}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('blocking each other settles every round, never a deadlock', async () => {
    const failures: string[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      const a = await seedUser(h, 'admin');
      const b = await seedUser(h, 'admin');
      const result = await outcomes([
        status.block({ userId: b, reason: 'a blocks b' }, { userId: a, ipAddress: null }),
        status.block({ userId: a, reason: 'b blocks a' }, { userId: b, ipAddress: null }),
      ]);
      if (result.some((s) => typeof s === 'string' || s >= 500)) {
        failures.push(`round ${String(round)}: ${result.join(', ')}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('granting each other a role settles every round, never a deadlock', async () => {
    const failures: string[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      const a = await seedUser(h, 'admin');
      const b = await seedUser(h, 'admin');
      const result = await outcomes([
        grant.execute(
          { userId: b, role: 'owner', reason: 'a grants b' },
          {
            userId: a,
            ipAddress: null,
          },
        ),
        grant.execute(
          { userId: a, role: 'owner', reason: 'b grants a' },
          {
            userId: b,
            ipAddress: null,
          },
        ),
      ]);
      if (result.some((s) => typeof s === 'string' || s >= 500)) {
        failures.push(`round ${String(round)}: ${result.join(', ')}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
