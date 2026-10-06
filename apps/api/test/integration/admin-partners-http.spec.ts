import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type Harness, seedUser, startHarness, stopHarness } from './harness.js';
import { actingAs, type HttpApp, startHttpApp, stopHttpApp } from './http-harness.js';

const BASE = '/api/v1/admin/partners';

interface Envelope {
  readonly data?: unknown;
  readonly meta?: { readonly page: number; readonly pageSize: number; readonly total: number };
  readonly error?: { readonly code: string; readonly message: string; readonly traceId: string };
}

interface PartnerView {
  readonly userId: string;
  readonly kind: string;
  readonly name: string | null;
  readonly displayName: string | null;
  readonly phone: string;
  readonly verificationStatus: string;
  readonly requestedAt: string;
}

interface DocumentView {
  readonly kind: string;
  readonly url: string;
  readonly expiresAt: string | null;
}

interface PartnerDetailView extends PartnerView {
  readonly vehicleNumber: string | null;
  readonly operatingHours: unknown;
  readonly documents: DocumentView[];
}

const envelope = (r: { body: unknown }): Envelope => r.body as Envelope;
const partnersOf = (r: { body: unknown }): PartnerView[] => envelope(r).data as PartnerView[];
const detailOf = (r: { body: unknown }): PartnerDetailView => envelope(r).data as PartnerDetailView;
const errorCode = (r: { body: unknown }): string | undefined => envelope(r).error?.code;

const HOURS = { mon: [{ open: '09:00', close: '18:00' }] };

/**
 * The admin partner endpoints, through the real Fastify pipeline against a real database.
 * Verifying a person is what lets them take paid jobs, so what the client sees (status, envelope,
 * the signed document links) and what the database kept (profile, role, audit, outbox) are asserted
 * together. A body that fails its Zod schema is 400 `VALIDATION_FAILED`, not 422.
 */
describe('admin partners HTTP', () => {
  let h: Harness;
  let http: HttpApp;
  let adminId: string;
  let phoneCounter = 0;

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

  const verify = (userId: string, kind: string) => write(`${BASE}/${userId}/verify`, { kind });
  /** `null` omits the notes: a default parameter would swallow `undefined`. */
  const reject = (userId: string, kind: string, notes: string | null = 'licence is unreadable') =>
    write(`${BASE}/${userId}/reject`, notes === null ? { kind } : { kind, notes });

  const person = async (name: string): Promise<{ id: string; phone: string }> => {
    phoneCounter += 1;
    const phone = `+9197${String(20_000_000 + phoneCounter)}`;
    const rows = await h.sql<{ id: string }[]>`
      INSERT INTO users (phone, firebase_uid, name)
      VALUES (${phone}, ${`fb-partner-${String(phoneCounter)}`}, ${name}) RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('failed to seed person');
    return { id, phone };
  };

  const roleRow = async (userId: string, role: string) => {
    const rows = await h.sql<{ status: string; verified_at: Date | null }[]>`
      SELECT status, verified_at FROM user_roles WHERE user_id = ${userId} AND role = ${role}`;
    return rows[0];
  };

  interface ValetSeed {
    status?: string;
    roleStatus?: string | null;
    licence?: string | null;
    name?: string;
  }

  const seedValet = async (opts: ValetSeed = {}) => {
    const { id, phone } = await person(opts.name ?? 'Vikram Valet');
    const roleStatus = opts.roleStatus === undefined ? 'pending' : opts.roleStatus;
    if (roleStatus !== null) {
      await h.sql`INSERT INTO user_roles (user_id, role, status) VALUES (${id}, 'valet', ${roleStatus})`;
    }
    const licence =
      opts.licence === undefined ? 'parkease/documents/0190aaaa-licence' : opts.licence;
    await h.sql`
      INSERT INTO valet_profiles (user_id, verification_status, licence_document_id, vehicle_number)
      VALUES (${id}, ${opts.status ?? 'pending'}, ${licence}, 'KA01AB1234')`;
    return { id, phone };
  };

  interface WasherSeed {
    status?: string;
    roleStatus?: string | null;
    photos?: string[];
    idDocument?: string | null;
  }

  const seedWasher = async (opts: WasherSeed = {}) => {
    const { id, phone } = await person('Wanda Washer');
    const roleStatus = opts.roleStatus === undefined ? 'pending' : opts.roleStatus;
    if (roleStatus !== null) {
      await h.sql`INSERT INTO user_roles (user_id, role, status) VALUES (${id}, 'washer', ${roleStatus})`;
    }
    const photos = opts.photos ?? ['parkease/spaces/0190bbbb-front'];
    const idDocument =
      opts.idDocument === undefined ? 'parkease/documents/0190cccc-id' : opts.idDocument;
    await h.sql`
      INSERT INTO washer_profiles
        (user_id, partner_type, business_name, business_photo_ids, operating_hours,
         id_document_id, verification_status)
      VALUES (${id}, 'business', 'Sparkle Wash Co',
              ${photos}::text[],
              ${JSON.stringify(HOURS)}::jsonb,
              ${idDocument},
              ${opts.status ?? 'pending'})`;
    return { id, phone };
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
      }[]
    >`SELECT actor_user_id, actor_role, target_type, before, after, ip_address
        FROM audit_log WHERE action = ${action} AND target_id = ${targetId}`;

  const auditCount = async (): Promise<number> => {
    const rows = await h.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log`;
    return rows[0]?.n ?? -1;
  };

  const outboxCount = async (): Promise<number> => {
    const rows = await h.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM outbox_messages`;
    return rows[0]?.n ?? -1;
  };

  const outboxFor = (type: string, userId: string) =>
    h.sql<{ payload: Record<string, unknown> }[]>`
      SELECT payload FROM outbox_messages WHERE type = ${type} AND payload->>'userId' = ${userId}`;

  const profileStatus = async (
    kind: 'valet' | 'washer',
    userId: string,
  ): Promise<string | null> => {
    const rows =
      kind === 'valet'
        ? await h.sql<
            { s: string }[]
          >`SELECT verification_status AS s FROM valet_profiles WHERE user_id = ${userId}`
        : await h.sql<
            { s: string }[]
          >`SELECT verification_status AS s FROM washer_profiles WHERE user_id = ${userId}`;
    return rows[0]?.s ?? null;
  };

  beforeAll(async () => {
    h = await startHarness();
    http = await startHttpApp(h);
    adminId = await seedUser(h, 'admin');
  }, 300_000);

  afterAll(async () => {
    await stopHttpApp(http);
    await stopHarness(h);
  });

  beforeEach(async () => {
    await h.sql`TRUNCATE audit_log, idempotency_keys, outbox_messages, valet_profiles, washer_profiles`;
    await h.sql`DELETE FROM user_roles WHERE role IN ('valet', 'washer')`;
    h.redis.clear();
    asAdmin();
  });

  describe('authorisation', () => {
    it('answers 401 to nobody and 403 to a signed-in driver, on every endpoint', async () => {
      const target = await seedUser(h, 'driver');
      const endpoints = [
        ['GET', BASE, undefined],
        ['GET', `${BASE}/${target}?kind=valet`, undefined],
        ['POST', `${BASE}/${target}/verify`, { kind: 'valet' }],
        ['POST', `${BASE}/${target}/reject`, { kind: 'valet', notes: 'x' }],
      ] as const;

      const fire = (method: 'GET' | 'POST', url: string, payload: unknown) =>
        http.request({
          method,
          url,
          ...(payload === undefined ? {} : { payload }),
          headers: { 'idempotency-key': crypto.randomUUID() },
        });

      actingAs.user = null;
      for (const [method, url, payload] of endpoints) {
        expect((await fire(method, url, payload)).status, `${method} ${url} signed out`).toBe(401);
      }

      actingAs.user = { id: target, roles: ['driver'], activeRole: 'driver' };
      for (const [method, url, payload] of endpoints) {
        expect((await fire(method, url, payload)).status, `${method} ${url} as a driver`).toBe(403);
      }
    });
  });

  describe('list', () => {
    it('returns the pending valet and washer, and kind narrows it', async () => {
      const valet = await seedValet();
      const washer = await seedWasher();
      await seedValet({ status: 'verified', name: 'Already Verified' });

      const both = await read(`${BASE}?status=pending`);
      expect(both.status).toBe(200);
      expect(
        partnersOf(both)
          .map((p) => p.userId)
          .sort(),
      ).toEqual([valet.id, washer.id].sort());
      expect(envelope(both).meta?.total).toBe(2);

      const onlyWashers = await read(`${BASE}?status=pending&kind=washer`);
      const items = partnersOf(onlyWashers);
      expect(items.map((p) => p.userId)).toEqual([washer.id]);
      expect(items[0]?.kind).toBe('washer');
      expect(items[0]?.displayName).toBe('Sparkle Wash Co');
      expect(items[0]?.verificationStatus).toBe('pending');
      expect(envelope(onlyWashers).meta?.total).toBe(1);
    });

    it('defaults to the pending queue', async () => {
      await seedValet({ status: 'verified' });
      const waiting = await seedValet({ name: 'Waiting Valet' });

      const res = await read(BASE);
      expect(partnersOf(res).map((p) => p.userId)).toEqual([waiting.id]);
    });

    it('masks the phone and never returns the number', async () => {
      const { phone } = await seedValet();

      const res = await read(BASE);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain(phone);
      expect(body).not.toContain(phone.slice(3));
      expect(partnersOf(res)[0]?.phone).toContain('*');
    });

    it('pages: the total is the whole queue and the page is a slice of it', async () => {
      await seedValet({ name: 'A' });
      await seedWasher();
      await seedValet({ name: 'C' });

      const res = await read(`${BASE}?pageSize=2&page=2`);
      expect(partnersOf(res)).toHaveLength(1);
      expect(envelope(res).meta).toEqual({ page: 2, pageSize: 2, total: 3 });
    });

    it('rejects an unknown kind with 400 VALIDATION_FAILED', async () => {
      const res = await read(`${BASE}?kind=owner`);
      expect(res.status).toBe(400);
      expect(errorCode(res)).toBe('VALIDATION_FAILED');
    });
  });

  describe('detail', () => {
    it('shows a washer with hours and signed links to the ID document and the shop photos', async () => {
      const { id } = await seedWasher({
        photos: ['parkease/spaces/0190bbbb-front', 'parkease/spaces/0190bbbb-back'],
      });
      const before = Date.now();

      const res = await read(`${BASE}/${id}?kind=washer`);
      expect(res.status).toBe(200);
      const detail = detailOf(res);
      expect(detail.displayName).toBe('Sparkle Wash Co');
      expect(detail.operatingHours).toEqual(HOURS);

      const idProof = detail.documents.filter((d) => d.kind === 'id_proof');
      expect(idProof).toHaveLength(1);
      const link = new URL(idProof[0]?.url ?? '');
      expect(link.host).toBe('api.cloudinary.com');
      expect(link.pathname).toMatch(/\/image\/download$/);
      expect(link.searchParams.get('type')).toBe('authenticated');
      expect(link.searchParams.get('public_id')).toBe('parkease/documents/0190cccc-id');
      const expiresAt = new Date(idProof[0]?.expiresAt ?? '').getTime();
      expect(expiresAt).toBeGreaterThan(before + 290_000);
      expect(expiresAt).toBeLessThan(Date.now() + 310_000);

      const photos = detail.documents.filter((d) => d.kind === 'business_photo');
      expect(photos).toHaveLength(2);
      expect(photos[0]?.url).toMatch(
        /^https:\/\/res\.cloudinary\.com\/test-cloud\/image\/upload\/parkease\/spaces\//,
      );
      // A public photo is not signed and does not expire.
      expect(photos[0]?.expiresAt).toBeNull();
      expect(JSON.stringify(res.body)).not.toContain('fake_cloudinary_secret');
    });

    it('shows a valet with the licence and the vehicle', async () => {
      const { id } = await seedValet();

      const detail = detailOf(await read(`${BASE}/${id}?kind=valet`));
      expect(detail.vehicleNumber).toBe('KA01AB1234');
      expect(detail.displayName).toBeNull();
      expect(detail.documents.map((d) => d.kind)).toEqual(['driving_licence']);
      expect(new URL(detail.documents[0]?.url ?? '').searchParams.get('public_id')).toBe(
        'parkease/documents/0190aaaa-licence',
      );
    });

    it('masks the phone on the detail too', async () => {
      const { id, phone } = await seedValet();

      const res = await read(`${BASE}/${id}?kind=valet`);
      expect(JSON.stringify(res.body)).not.toContain(phone);
    });

    it('does not crash on a dev-mock id: it is left out, and a document never uploaded is too', async () => {
      const dev = await seedValet({ licence: 'dev-mock-licence' });
      const empty = await seedValet({ licence: null, name: 'No Licence Yet' });

      const devRes = await read(`${BASE}/${dev.id}?kind=valet`);
      expect(devRes.status).toBe(200);
      expect(detailOf(devRes).documents).toEqual([]);

      const emptyRes = await read(`${BASE}/${empty.id}?kind=valet`);
      expect(emptyRes.status).toBe(200);
      expect(detailOf(emptyRes).documents).toEqual([]);
    });

    it('signs nothing for a stored id that is not an upload id, and still shows the good ones', async () => {
      const { id } = await seedWasher({
        idDocument: 'parkease/documents/../proofs/x',
        photos: [
          'parkease/spaces/0190bbbb-front',
          'parkease/documents/0190cccc-id',
          'dev-mock-photo',
        ],
      });

      const res = await read(`${BASE}/${id}?kind=washer`);

      expect(res.status).toBe(200);
      const documents = detailOf(res).documents;
      // The climbing id signs nothing; of the photos only the one in spaces survives.
      expect(documents.map((d) => d.kind)).toEqual(['business_photo']);
      expect(documents[0]?.url).toContain('/parkease/spaces/0190bbbb-front');
      expect(JSON.stringify(res.body)).not.toContain('signature=');
    });

    it('is 404 for a user who is not that kind of partner, and for one who does not exist', async () => {
      const driver = await seedUser(h, 'driver');
      const valet = await seedValet();

      expect((await read(`${BASE}/${driver}?kind=valet`)).status).toBe(404);
      expect((await read(`${BASE}/${valet.id}?kind=washer`)).status).toBe(404);
      expect((await read(`${BASE}/${crypto.randomUUID()}?kind=valet`)).status).toBe(404);
    });

    it('needs a kind: a person can be both', async () => {
      const { id } = await seedValet();
      const res = await read(`${BASE}/${id}`);
      expect(res.status).toBe(400);
      expect(errorCode(res)).toBe('VALIDATION_FAILED');
    });
  });

  describe('verify', () => {
    it('activates the role, verifies the profile, audits once and announces it', async () => {
      const { id } = await seedValet();

      const res = await verify(id, 'valet');

      expect(res.status).toBe(200);
      expect(detailOf(res).verificationStatus).toBe('verified');
      expect(await profileStatus('valet', id)).toBe('verified');
      const role = await roleRow(id, 'valet');
      expect(role?.status).toBe('active');
      expect(role?.verified_at).not.toBeNull();

      const audit = await auditRows('partner.verify', id);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.actor_user_id).toBe(adminId);
      expect(audit[0]?.actor_role).toBe('admin');
      expect(audit[0]?.target_type).toBe('valet_profile');
      expect(audit[0]?.before).toMatchObject({
        verificationStatus: 'pending',
        roleStatus: 'pending',
      });
      expect(audit[0]?.after).toMatchObject({
        verificationStatus: 'verified',
        roleStatus: 'active',
      });

      const outbox = await outboxFor('partner.verified', id);
      expect(outbox).toHaveLength(1);
      expect(outbox[0]?.payload).toEqual({ userId: id, kind: 'valet' });
    });

    it('verifies a washer on its own table', async () => {
      const { id } = await seedWasher();

      expect((await verify(id, 'washer')).status).toBe(200);
      expect(await profileStatus('washer', id)).toBe('verified');
      expect((await roleRow(id, 'washer'))?.status).toBe('active');
      expect((await auditRows('partner.verify', id))[0]?.target_type).toBe('washer_profile');
    });

    it('a second verify is 409 and writes no second audit row or message', async () => {
      const { id } = await seedValet();
      expect((await verify(id, 'valet')).status).toBe(200);

      const again = await verify(id, 'valet');

      expect(again.status).toBe(409);
      expect(errorCode(again)).toBe('ILLEGAL_VERIFICATION_TRANSITION');
      expect(await auditRows('partner.verify', id)).toHaveLength(1);
      expect(await outboxFor('partner.verified', id)).toHaveLength(1);
    });

    it('refuses a profile that is not pending, and leaves everything as it was', async () => {
      const unverified = await seedValet({ status: 'unverified', roleStatus: 'pending' });
      const rejected = await seedWasher({ status: 'rejected', roleStatus: 'rejected' });

      for (const [id, kind] of [
        [unverified.id, 'valet'],
        [rejected.id, 'washer'],
      ] as const) {
        const res = await verify(id, kind);
        expect(res.status).toBe(409);
        expect(errorCode(res)).toBe('ILLEGAL_VERIFICATION_TRANSITION');
      }

      expect(await profileStatus('valet', unverified.id)).toBe('unverified');
      expect((await roleRow(rejected.id, 'washer'))?.status).toBe('rejected');
      expect(await auditCount()).toBe(0);
      expect(await outboxCount()).toBe(0);
    });

    it('treats an uppercase id as the same person: audit and outbox carry the canonical id', async () => {
      const { id } = await seedValet();

      const res = await verify(id.toUpperCase(), 'valet');

      expect(res.status).toBe(200);
      expect(await auditRows('partner.verify', id)).toHaveLength(1);
      expect((await outboxFor('partner.verified', id))[0]?.payload['userId']).toBe(id);
    });

    it('is 404 for a user with no such profile, with no audit row', async () => {
      const driver = await seedUser(h, 'driver');
      const valet = await seedValet();

      expect((await verify(driver, 'valet')).status).toBe(404);
      expect((await verify(valet.id, 'washer')).status).toBe(404);
      expect((await verify(crypto.randomUUID(), 'valet')).status).toBe(404);
      expect(await auditCount()).toBe(0);
    });

    it('decides each profile of a person who is both a valet and a washer on its own', async () => {
      const { id } = await seedValet();
      await h.sql`INSERT INTO user_roles (user_id, role, status) VALUES (${id}, 'washer', 'pending')`;
      await h.sql`
        INSERT INTO washer_profiles (user_id, partner_type, business_name, verification_status)
        VALUES (${id}, 'business', 'Both Hats', 'pending')`;

      expect((await verify(id, 'valet')).status).toBe(200);

      expect(await profileStatus('washer', id)).toBe('pending');
      expect((await roleRow(id, 'washer'))?.status).toBe('pending');
      expect((await reject(id, 'washer')).status).toBe(200);
      expect(await profileStatus('valet', id)).toBe('verified');
    });

    it('never creates a role: a profile with no role row is refused and nothing is written', async () => {
      const { id } = await seedValet({ roleStatus: null });

      const res = await verify(id, 'valet');

      expect(res.status).toBe(404);
      expect(errorCode(res)).toBe('ROLE_NOT_HELD');
      expect(await roleRow(id, 'valet')).toBeUndefined();
      expect(await profileStatus('valet', id)).toBe('pending');
      expect(await auditCount()).toBe(0);
      expect(await outboxCount()).toBe(0);
    });

    it('does not lift a suspension: verification is not a reinstatement', async () => {
      const { id } = await seedValet({ roleStatus: 'suspended' });

      expect((await verify(id, 'valet')).status).toBe(200);
      expect(await profileStatus('valet', id)).toBe('verified');
      expect((await roleRow(id, 'valet'))?.status).toBe('suspended');
    });

    it('activates a role an earlier rejection had closed, once the partner re-submits', async () => {
      const { id } = await seedWasher({ roleStatus: 'rejected', status: 'pending' });

      expect((await verify(id, 'washer')).status).toBe(200);
      expect((await roleRow(id, 'washer'))?.status).toBe('active');
    });

    it('rejects a body with no kind as 400 VALIDATION_FAILED', async () => {
      const { id } = await seedValet();
      const res = await write(`${BASE}/${id}/verify`, {});
      expect(res.status).toBe(400);
      expect(errorCode(res)).toBe('VALIDATION_FAILED');
    });
  });

  describe('reject', () => {
    it('without notes is 400 and changes nothing', async () => {
      const { id } = await seedValet();

      for (const notes of [null, '', '   ']) {
        const res = await reject(id, 'valet', notes);
        expect(res.status).toBe(400);
        expect(errorCode(res)).toBe('VALIDATION_FAILED');
      }

      expect(await profileStatus('valet', id)).toBe('pending');
      expect(await auditCount()).toBe(0);
    });

    it('with notes closes the role, rejects the profile, audits the notes and announces it', async () => {
      const { id } = await seedValet();

      const res = await reject(id, 'valet', 'licence expired in 2024');

      expect(res.status).toBe(200);
      expect(detailOf(res).verificationStatus).toBe('rejected');
      expect(await profileStatus('valet', id)).toBe('rejected');
      expect((await roleRow(id, 'valet'))?.status).toBe('rejected');

      const audit = await auditRows('partner.reject', id);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.after).toMatchObject({
        verificationStatus: 'rejected',
        notes: 'licence expired in 2024',
      });
      expect((await outboxFor('partner.rejected', id))[0]?.payload).toEqual({
        userId: id,
        kind: 'valet',
      });
    });

    it('cannot reject what is already decided', async () => {
      const { id } = await seedWasher();
      expect((await verify(id, 'washer')).status).toBe(200);

      const res = await reject(id, 'washer');

      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('ILLEGAL_VERIFICATION_TRANSITION');
      expect(await profileStatus('washer', id)).toBe('verified');
      expect(await auditRows('partner.reject', id)).toHaveLength(0);
    });

    it('leaves an active role alone when only a re-submitted profile is rejected', async () => {
      const { id } = await seedValet({ roleStatus: 'active' });

      expect((await reject(id, 'valet')).status).toBe(200);
      expect(await profileStatus('valet', id)).toBe('rejected');
      expect((await roleRow(id, 'valet'))?.status).toBe('active');
    });

    it('is 404 for a user who is not a partner', async () => {
      const driver = await seedUser(h, 'driver');
      expect((await reject(driver, 'washer')).status).toBe(404);
      expect(await auditCount()).toBe(0);
    });
  });
});
