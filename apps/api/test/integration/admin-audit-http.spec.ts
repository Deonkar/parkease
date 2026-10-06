import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type Harness, seedSpace, seedUser, startHarness, stopHarness } from './harness.js';
import { actingAs, type HttpApp, startHttpApp, stopHttpApp } from './http-harness.js';

const BASE = '/api/v1/admin/audit';

interface Entry {
  readonly id: string;
  readonly occurredAt: string;
  readonly actorUserId: string | null;
  readonly actorName: string | null;
  readonly actorRole: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  readonly ipAddress: string | null;
  readonly traceId: string | null;
}

interface Envelope {
  readonly data?: Entry[];
  readonly meta?: {
    readonly limit: number;
    readonly hasMore: boolean;
    readonly nextCursor: string | null;
  };
  readonly error?: { readonly code: string; readonly message: string };
}

const envelope = (r: { body: unknown }): Envelope => r.body as Envelope;
const entries = (r: { body: unknown }): Entry[] => envelope(r).data ?? [];

/**
 * The audit viewer through the real Fastify pipeline, against rows the real admin commands wrote.
 * What matters is what an admin's screen can never show: a phone number, a token, a bank number.
 */
describe('admin audit HTTP', () => {
  let h: Harness;
  let http: HttpApp;
  let adminId: string;
  let ownerId: string;
  let targets = 0;

  const asAdmin = () => {
    actingAs.user = { id: adminId, roles: ['admin'], activeRole: 'admin' };
  };

  const read = (url: string) => http.request({ method: 'GET', url });
  const write = (url: string, payload: unknown = {}) =>
    http.request({
      method: 'POST',
      url,
      payload,
      headers: { 'idempotency-key': crypto.randomUUID() },
    });

  /** Approves a pending space and grants a role: two real admin mutations, two real audit rows. */
  const performTwoMutations = async (): Promise<{ spaceId: string; targetUserId: string }> => {
    const spaceId = await seedSpace(h, {
      lat: 12.9345,
      lng: 77.6266,
      approvalStatus: 'pending_approval',
    });
    await h.sql`UPDATE spaces SET owner_id = ${ownerId}, submitted_at = now() WHERE id = ${spaceId}`;
    expect((await write(`/api/v1/admin/spaces/${spaceId}/approve`)).status).toBe(200);

    targets += 1;
    const phone = `+9198123${String(10_000 + targets)}`;
    const rows = await h.sql<{ id: string }[]>`
      INSERT INTO users (phone, firebase_uid, name)
      VALUES (${phone}, ${`fb-audit-${phone}`}, 'Target Person') RETURNING id`;
    const targetUserId = rows[0]?.id;
    if (targetUserId === undefined) throw new Error('failed to seed target user');
    const granted = await write(`/api/v1/admin/users/${targetUserId}/roles`, {
      role: 'valet',
      reason: 'met in person',
    });
    expect(granted.status).toBeLessThan(300);
    return { spaceId, targetUserId };
  };

  beforeAll(async () => {
    h = await startHarness();
    http = await startHttpApp(h);
    adminId = await seedUser(h, 'admin');
    ownerId = await seedUser(h, 'owner');
  }, 300_000);

  afterAll(async () => {
    await stopHttpApp(http);
    await stopHarness(h);
  });

  beforeEach(async () => {
    await h.sql`TRUNCATE audit_log, idempotency_keys, outbox_messages`;
    h.redis.clear();
    asAdmin();
  });

  it('answers 401 to nobody and 403 to a signed-in driver', async () => {
    actingAs.user = null;
    expect((await read(BASE)).status).toBe(401);

    const driver = await seedUser(h, 'driver');
    actingAs.user = { id: driver, roles: ['driver'], activeRole: 'driver' };
    expect((await read(BASE)).status).toBe(403);
  });

  it('lists what the commands wrote, newest first, with the actor named', async () => {
    const { spaceId, targetUserId } = await performTwoMutations();

    const res = await read(BASE);
    expect(res.status).toBe(200);
    const list = entries(res);
    expect(list.map((e) => e.action)).toEqual(['user.role.grant', 'space.approve']);
    expect(list[0]).toMatchObject({
      actorUserId: adminId,
      actorRole: 'admin',
      targetType: 'user',
      targetId: targetUserId,
    });
    expect(list[0]?.actorName).toMatch(/^admin \d+$/);
    expect(list[0]?.ipAddress).not.toBeNull();
    expect(list[1]).toMatchObject({ targetType: 'space', targetId: spaceId });
    expect(Date.parse(list[0]?.occurredAt ?? '')).toBeGreaterThan(
      Date.parse(list[1]?.occurredAt ?? ''),
    );
    expect(envelope(res).meta).toEqual({ limit: 50, hasMore: false, nextCursor: null });
  });

  it('filters by action, target type and actor', async () => {
    await performTwoMutations();

    expect(entries(await read(`${BASE}?action=space.approve`)).map((e) => e.action)).toEqual([
      'space.approve',
    ]);
    expect(entries(await read(`${BASE}?targetType=user`)).map((e) => e.action)).toEqual([
      'user.role.grant',
    ]);
    expect(entries(await read(`${BASE}?actorUserId=${adminId}`))).toHaveLength(2);
    expect(entries(await read(`${BASE}?actorUserId=${ownerId}`))).toHaveLength(0);
  });

  it('bounds by IST calendar day, `to` exclusive, and refuses a backwards or oversized range', async () => {
    // 18:30Z is midnight IST: the first two rows straddle 2 Oct, the last two straddle 3 Oct.
    await h.sql`
      INSERT INTO audit_log (actor_user_id, action, target_type, created_at) VALUES
        (${adminId}, 'a.before',   'x', '2026-10-01T18:29:59Z'),
        (${adminId}, 'a.inside',   'x', '2026-10-01T18:30:00Z'),
        (${adminId}, 'a.last',     'x', '2026-10-02T18:29:59Z'),
        (${adminId}, 'a.excluded', 'x', '2026-10-02T18:30:00Z')`;

    const inRange = await read(`${BASE}?from=2026-10-02&to=2026-10-03`);
    expect(entries(inRange).map((e) => e.action)).toEqual(['a.last', 'a.inside']);

    expect((await read(`${BASE}?from=2026-10-03&to=2026-10-02`)).status).toBe(400);
    expect((await read(`${BASE}?from=2026-10-02&to=2026-10-02`)).status).toBe(400);
    expect((await read(`${BASE}?from=2025-01-01&to=2026-10-02`)).status).toBe(400);
    expect(entries(await read(`${BASE}?from=2026-10-03`)).map((e) => e.action)).toEqual([
      'a.excluded',
    ]);
  });

  it('pages by cursor to the older row, and never repeats or skips rows that share an instant', async () => {
    await performTwoMutations();

    const first = await read(`${BASE}?limit=1`);
    expect(entries(first).map((e) => e.action)).toEqual(['user.role.grant']);
    const next = envelope(first).meta?.nextCursor;
    expect(envelope(first).meta?.hasMore).toBe(true);
    expect(next).toEqual(expect.any(String));

    const second = await read(`${BASE}?limit=1&cursor=${next ?? ''}`);
    expect(entries(second).map((e) => e.action)).toEqual(['space.approve']);
    expect(envelope(second).meta).toMatchObject({ hasMore: false, nextCursor: null });

    // Five rows at one instant: the id breaks the tie, so no page repeats or skips one.
    await h.sql`TRUNCATE audit_log`;
    await h.sql`
      INSERT INTO audit_log (action, target_type, created_at)
      SELECT 'tie.' || n, 'x', '2026-10-05T10:00:00.123456Z' FROM generate_series(1, 5) AS n`;
    const seen: string[] = [];
    let url = `${BASE}?limit=2`;
    for (let page = 0; page < 10; page++) {
      const res = await read(url);
      seen.push(...entries(res).map((e) => e.id));
      const cursor = envelope(res).meta?.nextCursor;
      if (cursor == null) break;
      url = `${BASE}?limit=2&cursor=${cursor}`;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(seen).toEqual([...seen].sort().reverse());
  });

  it('refuses a forged cursor with 400, not a database error', async () => {
    const forge = (text: string) => Buffer.from(text, 'utf8').toString('base64url');
    const id = '0192f1c0-0000-7000-8000-000000000001';
    for (const cursor of [
      'not-a-cursor',
      forge(`9999-99-99T99:99:99.000000Z|${id}`),
      forge(`2026-02-30T00:00:00.000000Z|${id}`),
    ]) {
      const res = await read(`${BASE}?cursor=${encodeURIComponent(cursor)}`);
      expect(res.status).toBe(400);
      expect(envelope(res).error?.code).toBe('VALIDATION_FAILED');
    }
  });

  it('never sends a phone, token or bank number, however deep, while the stored row keeps them', async () => {
    await performTwoMutations();
    await h.sql`
      INSERT INTO audit_log (actor_user_id, actor_role, action, target_type, before, after)
      VALUES (${adminId}, 'admin', 'bank_details.update', 'user',
        ${JSON.stringify({ phone: '+919876543210', accountNumber: '000123456789', ifsc: 'HDFC0001234' })}::jsonb,
        ${JSON.stringify({
          phone: '+919876543210',
          contacts: ['+919811122233', { refreshToken: 'rt-secret-value', otp: '123456' }],
          nested: { razorpaySignature: 'sig', password: 'hunter2', kept: 'visible' },
        })}::jsonb)`;

    const [row] = entries(await read(`${BASE}?action=bank_details.update`));
    expect(row?.before).toEqual({ phone: '+91 98765***10' });
    expect(row?.after).toEqual({
      phone: '+91 98765***10',
      contacts: ['+91 98111***33', {}],
      nested: { kept: 'visible' },
    });

    // The whole response, not just the fields asserted above.
    const everything = JSON.stringify((await read(`${BASE}?limit=200`)).body);
    expect(everything).not.toMatch(/\+\d{10,}/);
    for (const secret of [
      '9876543210',
      '9811122233',
      'rt-secret-value',
      'hunter2',
      'HDFC0001234',
      '000123456789',
    ]) {
      expect(everything).not.toContain(secret);
    }

    // Redaction is on the way out only: the stored row is complete.
    const [stored] = await h.sql<{ after: { phone: string } }[]>`
      SELECT after FROM audit_log WHERE action = 'bank_details.update'`;
    expect(stored?.after.phone).toBe('+919876543210');
  });

  it('is append-only at the database: an UPDATE or DELETE on the harness connection is refused', async () => {
    await performTwoMutations();
    await expect(h.sql`UPDATE audit_log SET action = 'x'`).rejects.toThrow(/append-only/i);
    await expect(h.sql`DELETE FROM audit_log`).rejects.toThrow(/append-only/i);
    expect(entries(await read(BASE))).toHaveLength(2);
  });
});
