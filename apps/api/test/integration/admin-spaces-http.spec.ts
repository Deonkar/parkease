import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type Harness, seedSpace, seedUser, startHarness, stopHarness } from './harness.js';
import { actingAs, type HttpApp, startHttpApp, stopHttpApp } from './http-harness.js';

const BASE = '/api/v1/admin/spaces';

interface Envelope {
  readonly data?: Record<string, unknown>;
  readonly meta?: Record<string, unknown>;
  readonly error?: { readonly code: string; readonly message: string; readonly traceId: string };
}

const envelope = (response: { body: unknown }): Envelope => response.body as Envelope;
const items = (response: { body: unknown }) =>
  (response.body as { data?: Record<string, unknown>[] }).data;

interface Counts {
  readonly audit: number;
  readonly outbox: number;
}

/**
 * The admin space review endpoints, driven through the real Fastify pipeline.
 * What a client sees (status, envelope, error code) and what the database
 * kept (audit row, outbox row, review columns) are both asserted: a decision
 * that answers 200 and writes no audit row is the failure this guards.
 *
 * A body that fails its Zod schema is 400 `VALIDATION_FAILED` here, not 422:
 * the global exception filter maps every `ZodError` to 400 and every other
 * admin endpoint relies on that.
 */
describe('admin spaces HTTP', () => {
  let h: Harness;
  let http: HttpApp;
  let adminId: string;
  let ownerId: string;

  const asAdmin = () => {
    actingAs.user = { id: adminId, roles: ['admin'], activeRole: 'admin' };
  };
  const asOwner = () => {
    actingAs.user = { id: ownerId, roles: ['owner'], activeRole: 'owner' };
  };

  const write = (method: 'POST' | 'PUT', url: string, payload?: unknown) =>
    http.request({
      method,
      url,
      payload: payload ?? {},
      headers: { 'idempotency-key': crypto.randomUUID() },
    });

  const spaceFor = async (owner: string, approvalStatus = 'pending_approval'): Promise<string> => {
    const id = await seedSpace(h, { lat: 12.9345, lng: 77.6266, approvalStatus });
    await h.sql`UPDATE spaces SET owner_id = ${owner}, submitted_at = now() WHERE id = ${id}`;
    return id;
  };
  const pendingSpace = (approvalStatus = 'pending_approval') => spaceFor(ownerId, approvalStatus);

  const auditRows = (action: string, spaceId: string) =>
    h.sql<
      {
        actor_user_id: string;
        actor_role: string;
        target_type: string;
        before: { approvalStatus: string; reviewNotes: string | null };
        after: { approvalStatus: string; reviewNotes: string | null };
      }[]
    >`
      SELECT actor_user_id, actor_role, target_type, before, after
        FROM audit_log WHERE action = ${action} AND target_id = ${spaceId}
    `;

  const outboxRows = (type: string, spaceId: string) =>
    h.sql<{ payload: { spaceId: string; ownerId: string; notes: string | null } }[]>`
      SELECT payload FROM outbox_messages
       WHERE type = ${type} AND payload->>'spaceId' = ${spaceId}
    `;

  const counts = async (spaceId: string): Promise<Counts> => {
    const [a] = await h.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM audit_log WHERE target_id = ${spaceId}`;
    const [o] = await h.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM outbox_messages WHERE payload->>'spaceId' = ${spaceId}`;
    return { audit: a?.n ?? 0, outbox: o?.n ?? 0 };
  };

  const spaceRow = async (id: string) => {
    const [row] = await h.sql<
      {
        approval_status: string;
        review_notes: string | null;
        reviewed_by_user_id: string | null;
        reviewed_at: Date | null;
      }[]
    >`SELECT approval_status, review_notes, reviewed_by_user_id, reviewed_at
        FROM spaces WHERE id = ${id}`;
    if (row === undefined) throw new Error('space vanished');
    return row;
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
    await h.sql`TRUNCATE audit_log, idempotency_keys`;
    h.redis.clear();
    asAdmin();
  });

  describe('authorisation', () => {
    it('refuses a non-admin on every route', async () => {
      const id = await pendingSpace();
      asOwner();
      const responses = await Promise.all([
        http.request({ method: 'GET', url: BASE }),
        http.request({ method: 'GET', url: `${BASE}/${id}` }),
        write('POST', `${BASE}/${id}/approve`),
        write('POST', `${BASE}/${id}/reject`, { notes: 'no' }),
        write('POST', `${BASE}/${id}/request-changes`, { notes: 'no' }),
      ]);
      expect(responses.map((r) => r.status)).toEqual([403, 403, 403, 403, 403]);
      expect((await spaceRow(id)).approval_status).toBe('pending_approval');
    });
  });

  describe('queue and detail', () => {
    it('lists the pending space with a masked owner phone', async () => {
      const id = await pendingSpace();
      const response = await http.request({ method: 'GET', url: `${BASE}?pageSize=100` });
      expect(response.status).toBe(200);
      const item = items(response)?.find((i) => i['id'] === id);
      expect(item).toBeDefined();
      expect(item?.['ownerPhone']).toMatch(/\*\*\*/);
      expect(item?.['approvalStatus']).toBe('pending_approval');
      expect(typeof item?.['isFirstListing']).toBe('boolean');
      expect(JSON.stringify(response.body)).not.toMatch(/\+91\d{10}/);
    });

    it('filters by status and rejects an unknown status', async () => {
      const id = await pendingSpace('rejected');
      const rejected = await http.request({
        method: 'GET',
        url: `${BASE}?status=rejected&pageSize=100`,
      });
      expect(items(rejected)?.some((i) => i['id'] === id)).toBe(true);
      const pending = await http.request({ method: 'GET', url: `${BASE}?pageSize=100` });
      expect(items(pending)?.some((i) => i['id'] === id)).toBe(false);
      const bad = await http.request({ method: 'GET', url: `${BASE}?status=nope` });
      expect(bad.status).toBe(400);
    });

    it('pages by number and reports the total', async () => {
      await pendingSpace();
      await pendingSpace();
      const response = await http.request({ method: 'GET', url: `${BASE}?pageSize=1&page=2` });
      expect(response.status).toBe(200);
      expect(items(response)).toHaveLength(1);
      expect(envelope(response).meta).toMatchObject({ page: 2, pageSize: 1 });
      expect(Number(envelope(response).meta?.['total'])).toBeGreaterThanOrEqual(2);
    });

    it('flags a first listing, and not a later one', async () => {
      const second = await seedUser(h, 'owner');
      const first = await spaceFor(second);
      const before = await http.request({ method: 'GET', url: `${BASE}/${first}` });
      expect(envelope(before).data?.['isFirstListing']).toBe(true);

      await spaceFor(second, 'active');
      const after = await http.request({ method: 'GET', url: `${BASE}/${first}` });
      expect(envelope(after).data?.['isFirstListing']).toBe(false);
    });

    it('returns the detail with photos, coordinates and a masked phone', async () => {
      const id = await seedSpace(h, {
        lat: 12.9345,
        lng: 77.6266,
        approvalStatus: 'pending_approval',
        thumbnail: 'https://res.example/p.jpg',
      });
      await h.sql`UPDATE spaces SET owner_id = ${ownerId}, submitted_at = now() WHERE id = ${id}`;
      const response = await http.request({ method: 'GET', url: `${BASE}/${id}` });
      expect(response.status).toBe(200);
      const d = envelope(response).data;
      expect(d?.['photos']).toEqual(['https://res.example/p.jpg']);
      expect(d?.['latitude']).toBeCloseTo(12.9345, 4);
      expect(d?.['longitude']).toBeCloseTo(77.6266, 4);
      expect(d?.['ownerPhone']).toMatch(/\*\*\*/);
      expect(d?.['reviewedAt']).toBeNull();
    });

    it('answers 404 for an unknown id and 400 for a malformed one', async () => {
      const missing = await http.request({ method: 'GET', url: `${BASE}/${crypto.randomUUID()}` });
      expect(missing.status).toBe(404);
      const malformed = await http.request({ method: 'GET', url: `${BASE}/not-a-uuid` });
      expect(malformed.status).toBe(400);
    });
  });

  describe('decisions', () => {
    it('approves: active, one audit row, one outbox row', async () => {
      const id = await pendingSpace();
      const response = await write('POST', `${BASE}/${id}/approve`);
      expect(response.status).toBe(200);
      expect(envelope(response).data).toEqual({ id, approvalStatus: 'active' });

      const row = await spaceRow(id);
      expect(row.approval_status).toBe('active');
      expect(row.reviewed_by_user_id).toBe(adminId);
      expect(row.reviewed_at).not.toBeNull();

      const audit = await auditRows('space.approve', id);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actor_user_id: adminId,
        actor_role: 'admin',
        target_type: 'space',
        before: { approvalStatus: 'pending_approval', reviewNotes: null },
        after: { approvalStatus: 'active', reviewNotes: null },
      });
      const outbox = await outboxRows('space.approved', id);
      expect(outbox).toHaveLength(1);
      expect(outbox[0]?.payload).toMatchObject({ spaceId: id, ownerId });
    });

    it('refuses a reject or request-changes without notes, and changes nothing', async () => {
      const id = await pendingSpace();
      const none = await write('POST', `${BASE}/${id}/reject`, {});
      const blank = await write('POST', `${BASE}/${id}/reject`, { notes: '   ' });
      const noBody = await write('POST', `${BASE}/${id}/request-changes`);
      expect([none.status, blank.status, noBody.status]).toEqual([400, 400, 400]);
      expect(envelope(none).error?.code).toBe('VALIDATION_FAILED');
      expect((await spaceRow(id)).approval_status).toBe('pending_approval');
      expect(await counts(id)).toEqual({ audit: 0, outbox: 0 });
    });

    it('rejects with notes: rejected, notes stored', async () => {
      const id = await pendingSpace();
      const response = await write('POST', `${BASE}/${id}/reject`, {
        notes: '  Not a parking space  ',
      });
      expect(response.status).toBe(200);
      expect(envelope(response).data).toEqual({ id, approvalStatus: 'rejected' });
      expect((await spaceRow(id)).review_notes).toBe('Not a parking space');
      expect(await auditRows('space.reject', id)).toHaveLength(1);
      expect((await outboxRows('space.rejected', id))[0]?.payload.notes).toBe(
        'Not a parking space',
      );
    });

    it('requests changes: changes_requested, outbox carries the notes', async () => {
      const id = await pendingSpace();
      const response = await write('POST', `${BASE}/${id}/request-changes`, {
        notes: 'Add a photo of the gate',
      });
      expect(response.status).toBe(200);
      expect(envelope(response).data).toEqual({ id, approvalStatus: 'changes_requested' });
      expect(await auditRows('space.request-changes', id)).toHaveLength(1);
      const outbox = await outboxRows('space.changes-requested', id);
      expect(outbox).toHaveLength(1);
      expect(outbox[0]?.payload).toMatchObject({
        spaceId: id,
        ownerId,
        notes: 'Add a photo of the gate',
      });
    });

    it('409s a decision on a space that is not pending, and writes nothing', async () => {
      const id = await pendingSpace('active');
      const response = await write('POST', `${BASE}/${id}/approve`);
      expect(response.status).toBe(409);
      expect(envelope(response).error?.code).toBe('ILLEGAL_APPROVAL_TRANSITION');
      expect(await counts(id)).toEqual({ audit: 0, outbox: 0 });
      expect((await spaceRow(id)).approval_status).toBe('active');
    });

    it('lets exactly one of two parallel approvals through', async () => {
      const id = await pendingSpace();
      const results = await Promise.all([
        write('POST', `${BASE}/${id}/approve`),
        write('POST', `${BASE}/${id}/approve`),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await auditRows('space.approve', id)).toHaveLength(1);
      expect(await outboxRows('space.approved', id)).toHaveLength(1);
    });

    it('answers 404 for an unknown id and 400 for a malformed one', async () => {
      const missing = await write('POST', `${BASE}/${crypto.randomUUID()}/approve`);
      expect(missing.status).toBe(404);
      const malformed = await write('POST', `${BASE}/nope/approve`);
      expect(malformed.status).toBe(400);
    });

    it('does not decide a soft-deleted space', async () => {
      const id = await pendingSpace();
      await h.sql`UPDATE spaces SET deleted_at = now() WHERE id = ${id}`;
      const response = await write('POST', `${BASE}/${id}/approve`);
      expect(response.status).toBe(404);
    });
  });

  describe('owner edits after a decision', () => {
    it('resubmits a changes_requested space and keeps the notes', async () => {
      const id = await pendingSpace();
      await write('POST', `${BASE}/${id}/request-changes`, { notes: 'Add a photo of the gate' });

      asOwner();
      const response = await write('PUT', `/api/v1/owner/spaces/${id}`, {
        title: 'Gate-side bay',
      });
      expect(response.status).toBe(200);

      const row = await spaceRow(id);
      expect(row.approval_status).toBe('pending_approval');
      expect(row.review_notes).toBe('Add a photo of the gate');
    });

    it('treats rejected as terminal: 409 SPACE_REJECTED', async () => {
      const id = await pendingSpace();
      await write('POST', `${BASE}/${id}/reject`, { notes: 'Not a parking space' });

      asOwner();
      const response = await write('PUT', `/api/v1/owner/spaces/${id}`, {
        title: 'Gate-side bay',
      });
      expect(response.status).toBe(409);
      expect(envelope(response).error?.code).toBe('SPACE_REJECTED');
      expect((await spaceRow(id)).approval_status).toBe('rejected');
    });
  });
});
