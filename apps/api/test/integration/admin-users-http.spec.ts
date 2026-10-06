import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { TokenService } from '../../src/platform/auth/token.service.js';
import { AuditService } from '../../src/platform/observability/audit.service.js';

import { type Harness, seedUser, startHarness, stopHarness } from './harness.js';
import { actingAs, type HttpApp, startHttpApp, stopHttpApp } from './http-harness.js';

const BASE = '/api/v1/admin/users';

interface Envelope {
  readonly data?: unknown;
  readonly meta?: { readonly page: number; readonly pageSize: number; readonly total: number };
  readonly error?: { readonly code: string; readonly message: string; readonly traceId: string };
}

interface UserView {
  readonly id: string;
  readonly name: string | null;
  readonly phone: string;
  readonly status: string;
  readonly roles: { role: string; status: string; grantedAt: string }[];
  readonly createdAt: string;
}

const envelope = (r: { body: unknown }): Envelope => r.body as Envelope;
const userOf = (r: { body: unknown }): UserView => envelope(r).data as UserView;
const usersOf = (r: { body: unknown }): UserView[] => envelope(r).data as UserView[];
const errorCode = (r: { body: unknown }): string | undefined => envelope(r).error?.code;

/**
 * The admin user endpoints, driven through the real Fastify pipeline against a real database.
 * What the client sees (status, envelope, error code) and what the database kept (role row,
 * audit row, revoked tokens) are asserted together: a 200 that wrote no audit row, or blocked a
 * user and left a refresh token alive, is exactly what this guards.
 *
 * A body that fails its Zod schema is 400 `VALIDATION_FAILED` here, not 422: the global
 * exception filter maps every `ZodError` to 400.
 */
describe('admin users HTTP', () => {
  let h: Harness;
  let http: HttpApp;
  let tokens: TokenService;
  let adminId: string;

  const asAdmin = () => {
    actingAs.user = { id: adminId, roles: ['admin'], activeRole: 'admin' };
  };

  const write = (url: string, payload?: unknown) =>
    http.request({
      method: 'POST',
      url,
      payload: payload ?? {},
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
  const read = (url: string) => http.request({ method: 'GET', url });

  /** `null` omits the reason: a default parameter would swallow `undefined`. */
  const grant = (userId: string, role: string, reason: string | null = 'verified in person') =>
    write(`${BASE}/${userId}/roles`, reason === null ? { role } : { role, reason });
  const revoke = (userId: string, role: string, reason: string | null = 'left the team') =>
    write(`${BASE}/${userId}/roles/${role}/revoke`, reason === null ? {} : { reason });
  const block = (userId: string, reason: string | null = 'chargeback fraud') =>
    write(`${BASE}/${userId}/block`, reason === null ? {} : { reason });
  const unblock = (userId: string, reason: string | null = 'appeal upheld') =>
    write(`${BASE}/${userId}/unblock`, reason === null ? {} : { reason });

  /** A user with no roles at all, a known name, and a phone whose last four digits are chosen. */
  const person = async (name: string, phone: string): Promise<string> => {
    const rows = await h.sql<{ id: string }[]>`
      INSERT INTO users (phone, firebase_uid, name)
      VALUES (${phone}, ${`fb-${phone}`}, ${name}) RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('failed to seed person');
    return id;
  };

  const roleRow = async (userId: string, role: string) => {
    const rows = await h.sql<
      { status: string; granted_by_user_id: string | null; verified_at: Date | null }[]
    >`SELECT status, granted_by_user_id, verified_at FROM user_roles
       WHERE user_id = ${userId} AND role = ${role}`;
    return rows[0];
  };

  const auditRows = (action: string, targetId: string) =>
    h.sql<
      {
        actor_user_id: string;
        actor_role: string;
        target_type: string;
        before: Record<string, unknown> | null;
        after: Record<string, unknown> | null;
        ip_address: string | null;
        trace_id: string | null;
      }[]
    >`SELECT actor_user_id, actor_role, target_type, before, after, ip_address, trace_id
        FROM audit_log WHERE action = ${action} AND target_id = ${targetId}`;

  const mint = (userId: string, roles: string[]) =>
    h.db.transaction(async (tx) =>
      tokens.issue(tx as never, { userId, roles, activeRole: roles[0] ?? null }),
    );

  beforeAll(async () => {
    h = await startHarness();
    http = await startHttpApp(h);
    tokens = new TokenService(h.db, new AuditService(h.db));
    adminId = await seedUser(h, 'admin');
  }, 300_000);

  afterAll(async () => {
    await stopHttpApp(http);
    await stopHarness(h);
  });

  beforeEach(async () => {
    await h.sql`TRUNCATE audit_log, idempotency_keys`;
    h.redis.clear();
    asAdmin();
  });

  describe('authorisation', () => {
    it('answers 401 to nobody and 403 to a signed-in driver, on every endpoint', async () => {
      const target = await seedUser(h, 'driver');
      const endpoints = [
        ['GET', BASE, undefined],
        ['GET', `${BASE}/${target}`, undefined],
        ['POST', `${BASE}/${target}/roles`, { role: 'owner', reason: 'x' }],
        ['POST', `${BASE}/${target}/roles/owner/revoke`, { reason: 'x' }],
        ['POST', `${BASE}/${target}/block`, { reason: 'x' }],
        ['POST', `${BASE}/${target}/unblock`, { reason: 'x' }],
      ] as const;

      actingAs.user = null;
      for (const [method, url, payload] of endpoints) {
        const res = await http.request({
          method,
          url,
          payload,
          headers: { 'idempotency-key': crypto.randomUUID() },
        });
        expect(res.status, `${method} ${url} anonymous`).toBe(401);
      }

      actingAs.user = { id: target, roles: ['driver'], activeRole: 'driver' };
      for (const [method, url, payload] of endpoints) {
        const res = await http.request({
          method,
          url,
          payload,
          headers: { 'idempotency-key': crypto.randomUUID() },
        });
        expect(res.status, `${method} ${url} driver`).toBe(403);
      }
      expect((await roleRow(target, 'owner'))?.status).toBeUndefined();
    });
  });

  describe('list and detail', () => {
    it('finds a user by the last four digits of their phone, with the phone masked', async () => {
      const id = await person('Lakshmi Narayanan', '+919876547391');
      await person('Somebody Else', '+919876541234');

      const res = await read(`${BASE}?q=7391`);

      expect(res.status).toBe(200);
      const found = usersOf(res);
      expect(found.map((u) => u.id)).toEqual([id]);
      expect(found[0]?.phone).toBe('+91 98765***91');
      expect(JSON.stringify(res.body)).not.toContain('9876547391');
      expect(envelope(res).meta).toEqual({ page: 1, pageSize: 20, total: 1 });
    });

    it('finds a user by name, ignoring case', async () => {
      const id = await person('Zebulon Pike', '+919876540001');

      const found = usersOf(await read(`${BASE}?q=zEBUlon`));

      expect(found.map((u) => u.id)).toEqual([id]);
    });

    it('treats LIKE wildcards in q as plain text', async () => {
      await person('Percent Person', '+919876540002');

      expect(usersOf(await read(`${BASE}?q=%25`))).toEqual([]);
    });

    it('filters by role, and meta.total counts the whole filtered set, not the page', async () => {
      const owner = await person('Role Filter Owner', '+919876540003');
      await h.sql`INSERT INTO user_roles (user_id, role) VALUES (${owner}, 'owner')`;
      const [{ n: ownerCount } = { n: -1 }] = await h.sql<{ n: number }[]>`
        SELECT count(DISTINCT user_id)::int AS n FROM user_roles WHERE role = 'owner'`;

      const res = await read(`${BASE}?role=owner&pageSize=1`);

      expect(res.status).toBe(200);
      const page = usersOf(res);
      expect(page).toHaveLength(1);
      expect(page[0]?.roles.map((r) => r.role)).toContain('owner');
      expect(envelope(res).meta).toEqual({ page: 1, pageSize: 1, total: ownerCount });
      expect(ownerCount).toBeGreaterThan(1);
    });

    it('filters by user status', async () => {
      const id = await person('Blocked Bob', '+919876540004');
      await h.sql`UPDATE users SET status = 'blocked' WHERE id = ${id}`;

      const blocked = usersOf(await read(`${BASE}?status=blocked&q=Blocked%20Bob`));

      expect(blocked.map((u) => u.id)).toEqual([id]);
      expect(blocked[0]?.status).toBe('blocked');
    });

    it('rejects a page size over the cap with 400', async () => {
      const res = await read(`${BASE}?pageSize=1000`);

      expect(res.status).toBe(400);
      expect(errorCode(res)).toBe('VALIDATION_FAILED');
    });

    it('detail returns the user with every role row, masked; unknown user is 404', async () => {
      const id = await person('Detail Dee', '+919876540005');
      await h.sql`INSERT INTO user_roles (user_id, role, status) VALUES (${id}, 'driver', 'active')`;
      await h.sql`INSERT INTO user_roles (user_id, role, status) VALUES (${id}, 'valet', 'pending')`;

      const res = await read(`${BASE}/${id}`);

      expect(res.status).toBe(200);
      const user = userOf(res);
      expect(user.id).toBe(id);
      expect(user.phone).toMatch(/\*\*\*/);
      expect(user.roles.map((r) => `${r.role}:${r.status}`).sort()).toEqual([
        'driver:active',
        'valet:pending',
      ]);

      const missing = await read(`${BASE}/${crypto.randomUUID()}`);
      expect(missing.status).toBe(404);
      expect((await read(`${BASE}/not-a-uuid`)).status).toBe(400);
    });
  });

  describe('grant', () => {
    it('grants owner active, records who granted it, audits it with the reason and the IP', async () => {
      const id = await person('Grant Owner', '+919876540010');

      const res = await grant(id, 'owner', 'KYC checked');

      expect(res.status).toBe(201);
      expect(userOf(res).roles).toMatchObject([{ role: 'owner', status: 'active' }]);
      const row = await roleRow(id, 'owner');
      expect(row?.status).toBe('active');
      expect(row?.granted_by_user_id).toBe(adminId);

      const audit = await auditRows('user.role.grant', id);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actor_user_id: adminId,
        actor_role: 'admin',
        target_type: 'user',
        before: { status: null },
        after: { role: 'owner', status: 'active', reason: 'KYC checked' },
      });
      expect(audit[0]?.ip_address).not.toBeNull();
      expect(audit[0]).toHaveProperty('trace_id');
    });

    it('grants valet and washer as pending: they still owe verification', async () => {
      const id = await person('Grant Valet', '+919876540011');

      expect((await grant(id, 'valet')).status).toBe(201);
      expect((await grant(id, 'washer')).status).toBe(201);

      expect((await roleRow(id, 'valet'))?.status).toBe('pending');
      expect((await roleRow(id, 'washer'))?.status).toBe('pending');
      expect((await roleRow(id, 'valet'))?.verified_at).toBeNull();
    });

    it('answers 409 when the role is already held, and writes nothing more', async () => {
      const id = await person('Grant Twice', '+919876540012');
      expect((await grant(id, 'owner')).status).toBe(201);

      const again = await grant(id, 'owner');

      expect(again.status).toBe(409);
      expect(errorCode(again)).toBe('ROLE_ALREADY_HELD');
      expect(await auditRows('user.role.grant', id)).toHaveLength(1);
    });

    it('reactivates a suspended role instead of failing on the unique key', async () => {
      const id = await person('Grant Again', '+919876540013');
      expect((await grant(id, 'owner')).status).toBe(201);
      expect((await revoke(id, 'owner')).status).toBe(200);
      expect((await roleRow(id, 'owner'))?.status).toBe('suspended');

      const res = await grant(id, 'owner', 'reinstated');

      expect(res.status).toBe(201);
      expect((await roleRow(id, 'owner'))?.status).toBe('active');
      const audit = await auditRows('user.role.grant', id);
      expect(audit.at(-1)?.before).toEqual({ status: 'suspended' });
    });

    it('reactivates a rejected valet to pending', async () => {
      const id = await person('Rejected Valet', '+919876540014');
      await h.sql`INSERT INTO user_roles (user_id, role, status) VALUES (${id}, 'valet', 'rejected')`;

      expect((await grant(id, 'valet')).status).toBe(201);

      expect((await roleRow(id, 'valet'))?.status).toBe('pending');
    });

    it('grants admin active, and audits it', async () => {
      const id = await person('Future Admin', '+919876540015');

      const res = await grant(id, 'admin', 'joins the ops team');

      expect(res.status).toBe(201);
      expect((await roleRow(id, 'admin'))?.status).toBe('active');
      const audit = await auditRows('user.role.grant', id);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.after).toMatchObject({ role: 'admin', reason: 'joins the ops team' });
      expect(audit[0]?.ip_address).not.toBeNull();
      expect(audit[0]).toHaveProperty('trace_id');
    });

    it('answers 404 for an unknown user and writes nothing', async () => {
      const res = await grant(crypto.randomUUID(), 'owner');

      expect(res.status).toBe(404);
      const audit = await h.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM audit_log WHERE action = 'user.role.grant'`;
      expect(audit[0]?.n).toBe(0);
    });

    it('rejects a missing or blank reason and an unknown role with 400, writing nothing', async () => {
      const id = await person('No Reason', '+919876540016');

      for (const res of [
        await grant(id, 'owner', null),
        await grant(id, 'owner', '   '),
        await write(`${BASE}/${id}/roles`, { role: 'superuser', reason: 'x' }),
      ]) {
        expect(res.status).toBe(400);
        expect(errorCode(res)).toBe('VALIDATION_FAILED');
      }
      expect(await roleRow(id, 'owner')).toBeUndefined();
    });
  });

  describe('revoke', () => {
    it('refuses an admin revoking their own admin role: 409 SELF_DEMOTION, nothing changes', async () => {
      const res = await revoke(adminId, 'admin');

      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('SELF_DEMOTION');
      expect((await roleRow(adminId, 'admin'))?.status).toBe('active');
      expect(await auditRows('user.role.revoke', adminId)).toHaveLength(0);
    });

    it("suspends another user's role; their next rotate omits it, but an earlier access token lives on", async () => {
      const id = await person('Revoked Owner', '+919876540020');
      await h.sql`INSERT INTO user_roles (user_id, role) VALUES (${id}, 'driver'), (${id}, 'owner')`;
      const before = await mint(id, ['driver', 'owner']);

      const res = await revoke(id, 'owner', 'listing fraud');

      expect(res.status).toBe(200);
      expect((await roleRow(id, 'owner'))?.status).toBe('suspended');
      expect(userOf(res).roles.find((r) => r.role === 'owner')?.status).toBe('suspended');

      const audit = await auditRows('user.role.revoke', id);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actor_role: 'admin',
        before: { status: 'active' },
        after: { role: 'owner', status: 'suspended', reason: 'listing fraud' },
      });

      // The accepted window (at most 15 minutes): a token minted before the revoke still verifies
      // and still says `owner`. Revoking does not reach into tokens already issued.
      const stale = await tokens.verifyAccessToken(before.accessToken);
      expect(stale.roles).toContain('owner');

      // But the next refresh is minted from the database, and the role is gone.
      const next = await tokens.rotate(before.refreshToken);
      const fresh = await tokens.verifyAccessToken(next.accessToken);
      expect(fresh.roles).toEqual(['driver']);
    });

    it('can revoke another admin, but not a role the user does not hold', async () => {
      const other = await seedUser(h, 'admin');
      const stranger = await person('Not An Owner', '+919876540021');

      expect((await revoke(other, 'admin')).status).toBe(200);
      expect((await roleRow(other, 'admin'))?.status).toBe('suspended');

      const missing = await revoke(stranger, 'owner');
      expect(missing.status).toBe(404);
      expect(errorCode(missing)).toBe('ROLE_NOT_HELD');
      expect((await revoke(other, 'admin')).status).toBe(404);
      expect(await auditRows('user.role.revoke', stranger)).toHaveLength(0);
    });

    it('requires a reason', async () => {
      const id = await person('Revoke No Reason', '+919876540022');
      await h.sql`INSERT INTO user_roles (user_id, role) VALUES (${id}, 'owner')`;

      const res = await revoke(id, 'owner', null);

      expect(res.status).toBe(400);
      expect(errorCode(res)).toBe('VALIDATION_FAILED');
      expect((await roleRow(id, 'owner'))?.status).toBe('active');
    });
  });

  describe('block and unblock', () => {
    it('blocks: status flips, every live refresh token is revoked, rotate is 403', async () => {
      const id = await person('Blockable', '+919876540030');
      await h.sql`INSERT INTO user_roles (user_id, role) VALUES (${id}, 'driver')`;
      const first = await mint(id, ['driver']);
      await mint(id, ['driver']);

      const res = await block(id, 'abusive to valets');

      expect(res.status).toBe(200);
      expect(userOf(res).status).toBe('blocked');
      const status = await h.sql<{ status: string }[]>`SELECT status FROM users WHERE id = ${id}`;
      expect(status[0]?.status).toBe('blocked');
      const live = await h.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = ${id} AND revoked_at IS NULL`;
      expect(live[0]?.n).toBe(0);
      const reasons = await h.sql<{ revoked_reason: string }[]>`
        SELECT DISTINCT revoked_reason FROM refresh_tokens WHERE user_id = ${id}`;
      expect(reasons.map((r) => r.revoked_reason)).toEqual(['blocked']);

      await expect(tokens.rotate(first.refreshToken)).rejects.toMatchObject({ status: 403 });

      const audit = await auditRows('user.block', id);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        before: { status: 'active' },
        after: { status: 'blocked', reason: 'abusive to valets' },
      });
    });

    it('unblocks: status is active again, audited with the reason', async () => {
      const id = await person('Unblockable', '+919876540031');
      expect((await block(id)).status).toBe(200);

      const res = await unblock(id, 'mistaken identity');

      expect(res.status).toBe(200);
      expect(userOf(res).status).toBe('active');
      const audit = await auditRows('user.unblock', id);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        before: { status: 'blocked' },
        after: { status: 'active', reason: 'mistaken identity' },
      });
    });

    it('refuses to block yourself: 409 SELF_DEMOTION', async () => {
      const res = await block(adminId);

      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('SELF_DEMOTION');
      const status = await h.sql<
        { status: string }[]
      >`SELECT status FROM users WHERE id = ${adminId}`;
      expect(status[0]?.status).toBe('active');
    });

    it('refuses a transition that changes nothing, and one out of deleted: 409, no audit row', async () => {
      const active = await person('Already Active', '+919876540032');
      const deleted = await person('Gone Gary', '+919876540033');
      await h.sql`UPDATE users SET status = 'deleted' WHERE id = ${deleted}`;
      expect((await block(active)).status).toBe(200);

      const twice = await block(active);
      const notBlocked = await unblock(await person('Fine Fran', '+919876540034'));
      const resurrect = await unblock(deleted);
      const blockDeleted = await block(deleted);

      for (const res of [twice, notBlocked, resurrect, blockDeleted]) {
        expect(res.status).toBe(409);
        expect(errorCode(res)).toBe('ILLEGAL_USER_STATUS_TRANSITION');
      }
      expect(await auditRows('user.block', active)).toHaveLength(1);
      expect(await auditRows('user.block', deleted)).toHaveLength(0);
      expect(await auditRows('user.unblock', deleted)).toHaveLength(0);
    });

    it('answers 404 for an unknown user, and requires a reason', async () => {
      expect((await block(crypto.randomUUID())).status).toBe(404);

      const id = await person('Block No Reason', '+919876540035');
      const res = await block(id, null);
      expect(res.status).toBe(400);
      expect(errorCode(res)).toBe('VALIDATION_FAILED');
      const status = await h.sql<{ status: string }[]>`SELECT status FROM users WHERE id = ${id}`;
      expect(status[0]?.status).toBe('active');
    });
  });

  describe('self-service cannot mint an admin', () => {
    it('switching the active role to admin without holding it is 403, and nothing is written', async () => {
      const id = await seedUser(h, 'driver');
      actingAs.user = { id, roles: ['driver'], activeRole: 'driver' };

      const res = await http.request({
        method: 'POST',
        url: '/api/v1/me/roles/active',
        payload: { role: 'admin' },
        headers: { 'idempotency-key': crypto.randomUUID() },
      });

      expect(res.status).toBe(403);
      expect(await roleRow(id, 'admin')).toBeUndefined();
    });

    it('there is no self-service endpoint that grants a role at all', async () => {
      const id = await seedUser(h, 'driver');
      actingAs.user = { id, roles: ['driver'], activeRole: 'driver' };

      const res = await http.request({
        method: 'POST',
        url: '/api/v1/me/roles',
        payload: { role: 'admin' },
        headers: { 'idempotency-key': crypto.randomUUID() },
      });

      expect(res.status).toBe(404);
      expect(await roleRow(id, 'admin')).toBeUndefined();
    });
  });
});
