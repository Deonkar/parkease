import {
  BASIS_POINTS,
  DEFAULT_SURGE_TIERS,
  NO_SURGE_BP,
  type SurgeTier,
} from '@parkease/contracts/admin';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type Harness, seedUser, startHarness, stopHarness } from './harness.js';
import { actingAs, type HttpApp, startHttpApp, stopHttpApp } from './http-harness.js';

const CONFIG_URL = '/api/v1/admin/surge/config';
const ZONES_URL = '/api/v1/admin/surge/zones';

const GLOBAL_CAP_BP = 2 * BASIS_POINTS;
const AIRPORT_CAP_BP = 25_000;
const AIRPORT_ZONE = 'tdr1v0';

const ladderReaching = (capBp: number): SurgeTier[] => [
  ...DEFAULT_SURGE_TIERS,
  { minOccupancyBp: 9_500, multiplierBp: capBp, badge: 'very_high_demand' },
];

interface Envelope {
  readonly data?: unknown;
  readonly meta?: unknown;
  readonly error?: { readonly code: string; readonly message: string; readonly traceId: string };
}

const body = (response: { body: unknown }): Envelope => response.body as Envelope;
const data = (response: { body: unknown }): Record<string, unknown> =>
  body(response).data as Record<string, unknown>;

/**
 * The five surge admin endpoints, driven through the real Fastify pipeline.
 *
 * A test that calls the service directly cannot see an interceptor, a status
 * code, a response envelope or an error code — and those are precisely what an
 * admin client consumes. This is also the first `roles/admin` controller in the
 * codebase, so the guard stack around it has never been exercised on an admin
 * path before.
 */
describe('admin surge HTTP', () => {
  let h: Harness;
  let http: HttpApp;
  let adminId: string;

  const asAdmin = () => {
    actingAs.user = { id: adminId, roles: ['admin'], activeRole: 'admin' };
  };

  const key = () => crypto.randomUUID();

  const write = (
    method: 'PUT' | 'POST' | 'PATCH',
    url: string,
    payload: unknown,
    headers: Record<string, string> = { 'idempotency-key': crypto.randomUUID() },
  ) => http.request({ method, url, payload, headers });

  const validConfig = () => ({
    maxMultiplierBp: GLOBAL_CAP_BP,
    peakHourModifierBp: 11_000,
    weekendModifierBp: 10_500,
    eventModifierBp: 12_000,
    occupancyWindowMinutes: 60,
    peakWindows: [{ days: ['mon', 'tue'], from: '08:00', to: '11:00' }],
    tiers: DEFAULT_SURGE_TIERS,
  });

  const validOverride = (overrides: Record<string, unknown> = {}) => ({
    zoneId: AIRPORT_ZONE,
    label: 'Kempegowda Airport approach',
    reason: 'Structural scarcity; airport parking is 4x our rate',
    ...overrides,
  });

  beforeAll(async () => {
    h = await startHarness();
    http = await startHttpApp(h);
    adminId = await seedUser(h, 'admin');
  }, 300_000);

  afterAll(async () => {
    await stopHttpApp(http);
    await stopHarness(h);
  });

  /**
   * `surge_config` is never truncated — migration 0024 seeds its one row and
   * `MissingSurgeConfigError` exists precisely because nothing may delete it.
   * So it is reset to the seeded values instead, or a `PUT` in one test becomes
   * the `before` state of the next and the audit assertions read the wrong run.
   */
  const resetConfig = () => h.sql`
    UPDATE surge_config
       SET max_multiplier_bp = 20000,
           peak_hour_modifier_bp = 11000,
           weekend_modifier_bp = 10500,
           event_modifier_bp = 12000,
           occupancy_window_minutes = 60,
           updated_by = NULL,
           peak_windows = '[{"days":["mon","tue","wed","thu","fri"],"from":"08:00","to":"11:00"}]'::jsonb,
           tiers = ${JSON.stringify(DEFAULT_SURGE_TIERS)}::jsonb
     WHERE key = 'global'
  `;

  beforeEach(async () => {
    await h.sql`TRUNCATE surge_zone_overrides, audit_log, idempotency_keys`;
    await resetConfig();
    h.redis.clear();
    asAdmin();
  });

  describe('authorisation', () => {
    const everyEndpoint = [
      ['GET', CONFIG_URL],
      ['PUT', CONFIG_URL],
      ['GET', ZONES_URL],
      ['POST', ZONES_URL],
      ['PATCH', `${ZONES_URL}/${AIRPORT_ZONE}`],
    ] as const;

    it('answers 401 to an unauthenticated caller on every endpoint', async () => {
      actingAs.user = null;

      for (const [method, url] of everyEndpoint) {
        const response = await http.request({
          method,
          url,
          headers: { 'idempotency-key': key() },
          payload: method === 'GET' ? undefined : {},
        });

        expect(response.status, `${method} ${url}`).toBe(401);
      }
    });

    it('answers 403 to a signed-in driver on every endpoint', async () => {
      // Role guard, not ownership: there is no owner of a price ladder. The
      // second check is the active role — see the next test.
      actingAs.user = { id: h.driverId, roles: ['driver'], activeRole: 'driver' };

      for (const [method, url] of everyEndpoint) {
        const response = await http.request({
          method,
          url,
          headers: { 'idempotency-key': key() },
          payload: method === 'GET' ? undefined : {},
        });

        expect(response.status, `${method} ${url}`).toBe(403);
      }
    });

    it('answers 403 to an admin who is acting in another role', async () => {
      // Holding the admin role is not the same as being in the admin profile.
      // A driver-mode session that happens to belong to staff must not be able
      // to reprice a city because a tab was left open.
      actingAs.user = { id: adminId, roles: ['admin', 'driver'], activeRole: 'driver' };

      const response = await http.request({ method: 'GET', url: CONFIG_URL });

      expect(response.status).toBe(403);
    });

    it('writes no audit row for a request the guards refused', async () => {
      actingAs.user = { id: h.driverId, roles: ['driver'], activeRole: 'driver' };
      await http.request({ method: 'GET', url: CONFIG_URL });

      const rows = await h.sql`SELECT count(*)::int AS n FROM audit_log`;
      expect(rows[0]?.['n']).toBe(0);
    });
  });

  describe('GET /admin/surge/config', () => {
    it('returns the seeded global config in the data envelope', async () => {
      const response = await http.request({ method: 'GET', url: CONFIG_URL });

      expect(response.status).toBe(200);
      expect(data(response)['maxMultiplierBp']).toBe(GLOBAL_CAP_BP);
      expect(data(response)['occupancyWindowMinutes']).toBe(60);
      expect(data(response)['tiers']).toEqual(DEFAULT_SURGE_TIERS);
    });

    it('records the read with the acting admin and the trace id', async () => {
      await http.request({ method: 'GET', url: CONFIG_URL });

      const rows = await h.sql`
        SELECT actor_user_id, actor_role, action, target_type, ip_address, trace_id
        FROM audit_log ORDER BY created_at DESC LIMIT 1
      `;
      expect(rows[0]?.['action']).toBe('admin.surge.config.read');
      expect(rows[0]?.['actor_user_id']).toBe(adminId);
      expect(rows[0]?.['actor_role']).toBe('admin');
      expect(rows[0]?.['target_type']).toBe('surge_config');
      expect(rows[0]?.['ip_address']).not.toBeNull();
    });
  });

  describe('PUT /admin/surge/config', () => {
    it('replaces the config and reads back what it wrote', async () => {
      const next = { ...validConfig(), occupancyWindowMinutes: 90 };

      const response = await write('PUT', CONFIG_URL, next);
      expect(response.status).toBe(200);

      const after = await http.request({ method: 'GET', url: CONFIG_URL });
      expect(data(after)['occupancyWindowMinutes']).toBe(90);
    });

    it('records the before and the after state, and who changed it', async () => {
      await write('PUT', CONFIG_URL, { ...validConfig(), occupancyWindowMinutes: 90 });

      const rows = await h.sql<{ before: Record<string, unknown>; after: Record<string, unknown> }[]>`
        SELECT actor_user_id, action, before, after
        FROM audit_log WHERE action = 'admin.surge.config.replace' LIMIT 1
      `;
      const row = rows[0];
      expect(row).toBeDefined();
      expect(row?.before['occupancyWindowMinutes']).toBe(60);
      expect(row?.after['occupancyWindowMinutes']).toBe(90);
    });

    it('answers 400 with VALIDATION_FAILED for a cap no tier reaches', async () => {
      // A cap the ladder cannot land on would emit an undocumented multiplier
      // the moment anything capped against it.
      const response = await write('PUT', CONFIG_URL, {
        ...validConfig(),
        maxMultiplierBp: 30_000,
      });

      expect(response.status).toBe(400);
      expect(body(response).error?.code).toBe('VALIDATION_FAILED');
    });

    it('answers 400 for a ladder with a surging tier that has no badge', async () => {
      const response = await write('PUT', CONFIG_URL, {
        ...validConfig(),
        maxMultiplierBp: 12_500,
        tiers: [
          { minOccupancyBp: 0, multiplierBp: NO_SURGE_BP, badge: null },
          { minOccupancyBp: 6_000, multiplierBp: 12_500, badge: null },
        ],
      });

      expect(response.status).toBe(400);
    });

    it('leaves the stored config untouched when the body is rejected', async () => {
      await write('PUT', CONFIG_URL, { ...validConfig(), maxMultiplierBp: 30_000 });

      const after = await http.request({ method: 'GET', url: CONFIG_URL });
      expect(data(after)['maxMultiplierBp']).toBe(GLOBAL_CAP_BP);

      const rows = await h.sql`SELECT count(*)::int AS n FROM audit_log WHERE action LIKE '%replace'`;
      expect(rows[0]?.['n']).toBe(0);
    });

    it('answers 400 without an Idempotency-Key header', async () => {
      const response = await write('PUT', CONFIG_URL, validConfig(), {});

      expect(response.status).toBe(400);
    });
  });

  describe('POST /admin/surge/zones', () => {
    it('creates an override and answers 201', async () => {
      const response = await write('POST', ZONES_URL, validOverride());

      expect(response.status).toBe(201);
      expect(data(response)['zoneId']).toBe(AIRPORT_ZONE);
      expect(data(response)['enabled']).toBe(true);
    });

    it('accepts a cap above the global one when a tier reaches it', async () => {
      // The case v1's hard-coded Math.min(x, 2.0) made impossible while its own
      // admin screen advertised it.
      const response = await write(
        'POST',
        ZONES_URL,
        validOverride({ maxMultiplierBp: AIRPORT_CAP_BP, tiers: ladderReaching(AIRPORT_CAP_BP) }),
      );

      expect(response.status).toBe(201);
      expect(data(response)['maxMultiplierBp']).toBe(AIRPORT_CAP_BP);
    });

    it('refuses a raised cap with no tier that reaches it', async () => {
      const response = await write(
        'POST',
        ZONES_URL,
        validOverride({ maxMultiplierBp: AIRPORT_CAP_BP }),
      );

      expect(response.status).toBe(400);
    });

    it('refuses a zone id that is not a geohash-6 cell', async () => {
      // An id that is not a real cell would never match anything the worker
      // writes — an override that looks saved and does nothing.
      const response = await write('POST', ZONES_URL, validOverride({ zoneId: 'Bangalore' }));

      expect(response.status).toBe(400);
    });

    it('answers 409 for a zone that already has an override', async () => {
      await write('POST', ZONES_URL, validOverride());
      const again = await write('POST', ZONES_URL, validOverride({ label: 'Second try' }));

      expect(again.status).toBe(409);
      expect(body(again).error?.code).toBe('ALREADY_EXISTS');
    });

    it('records the creation as admin.surge.zone.create with the after state', async () => {
      await write('POST', ZONES_URL, validOverride());

      const rows = await h.sql<{ actor_user_id: string; after: Record<string, unknown> }[]>`
        SELECT actor_user_id, after FROM audit_log
        WHERE action = 'admin.surge.zone.create' LIMIT 1
      `;
      expect(rows[0]?.actor_user_id).toBe(adminId);
      expect(rows[0]?.after['zoneId']).toBe(AIRPORT_ZONE);
    });

    it('answers 400 without an Idempotency-Key header', async () => {
      const response = await write('POST', ZONES_URL, validOverride(), {});

      expect(response.status).toBe(400);
    });
  });

  describe('GET /admin/surge/zones', () => {
    it('lists overrides with the live multiplier alongside each one', async () => {
      await write('POST', ZONES_URL, validOverride());
      await h.redis.set(
        `surge:${AIRPORT_ZONE}`,
        JSON.stringify({
          multiplierBp: 15_000,
          badge: 'high_demand',
          occupancyBp: 8_000,
          appliedModifiers: [],
          calculatedAt: '2026-09-06T10:00:00.000Z',
        }),
      );

      const response = await http.request({ method: 'GET', url: ZONES_URL });

      expect(response.status).toBe(200);
      const items = body(response).data as Record<string, unknown>[];
      expect(items).toHaveLength(1);
      expect(items[0]?.['zoneId']).toBe(AIRPORT_ZONE);
      expect(items[0]?.['live']).toMatchObject({ multiplierBp: 15_000, badge: 'high_demand' });
    });

    it('reports a zone with no live key as not surging rather than omitting it', async () => {
      await write('POST', ZONES_URL, validOverride());

      const response = await http.request({ method: 'GET', url: ZONES_URL });

      const items = body(response).data as Record<string, unknown>[];
      expect(items[0]?.['live']).toMatchObject({ multiplierBp: NO_SURGE_BP, badge: null });
    });

    it('still lists overrides when Redis is unreachable', async () => {
      // ADR-010: Redis is a cache. Losing it costs the live column, not the
      // screen — an operator must still be able to see and fix a bad override
      // during exactly the incident that took the cache down.
      await write('POST', ZONES_URL, validOverride());
      h.redis.fail();

      const response = await http.request({ method: 'GET', url: ZONES_URL });

      expect(response.status).toBe(200);
      const items = body(response).data as Record<string, unknown>[];
      expect(items[0]?.['live']).toMatchObject({ multiplierBp: NO_SURGE_BP });
      h.redis.clear();
    });

    it('answers an empty list, not an error, when nothing is overridden', async () => {
      const response = await http.request({ method: 'GET', url: ZONES_URL });

      expect(response.status).toBe(200);
      expect(body(response).data).toEqual([]);
    });
  });

  describe('PATCH /admin/surge/zones/:zoneId', () => {
    beforeEach(async () => {
      await write('POST', ZONES_URL, validOverride());
    });

    it('amends one field and leaves the rest alone', async () => {
      const response = await write('PATCH', `${ZONES_URL}/${AIRPORT_ZONE}`, {
        label: 'Airport, north gate',
      });

      expect(response.status).toBe(200);
      expect(data(response)['label']).toBe('Airport, north gate');
      expect(data(response)['reason']).toBe(validOverride().reason);
    });

    it('disables a zone', async () => {
      const response = await write('PATCH', `${ZONES_URL}/${AIRPORT_ZONE}`, { enabled: false });

      expect(data(response)['enabled']).toBe(false);
    });

    it('refuses a cap raised one field at a time with no ladder to reach it', async () => {
      // `.partial()` drops the refinement tying a cap to its ladder, so the
      // merged override — not the patch — is what has to be validated.
      const response = await write('PATCH', `${ZONES_URL}/${AIRPORT_ZONE}`, {
        maxMultiplierBp: AIRPORT_CAP_BP,
      });

      expect(response.status).toBe(400);
    });

    it('accepts the same cap when the ladder arrives with it', async () => {
      const response = await write('PATCH', `${ZONES_URL}/${AIRPORT_ZONE}`, {
        maxMultiplierBp: AIRPORT_CAP_BP,
        tiers: ladderReaching(AIRPORT_CAP_BP),
      });

      expect(response.status).toBe(200);
      expect(data(response)['maxMultiplierBp']).toBe(AIRPORT_CAP_BP);
    });

    it('answers 404 for a zone with no override', async () => {
      const response = await write('PATCH', `${ZONES_URL}/tdr1v9`, { enabled: false });

      expect(response.status).toBe(404);
    });

    it('answers 400 for a zone id that is not a geohash-6 cell', async () => {
      const response = await write('PATCH', `${ZONES_URL}/NOPE`, { enabled: false });

      expect(response.status).toBe(400);
    });

    it('answers 400 for an empty patch, which would change nothing', async () => {
      const response = await write('PATCH', `${ZONES_URL}/${AIRPORT_ZONE}`, {});

      expect(response.status).toBe(400);
    });

    it('records the before and after of the amendment', async () => {
      await write('PATCH', `${ZONES_URL}/${AIRPORT_ZONE}`, { enabled: false });

      const rows = await h.sql<{ before: Record<string, unknown>; after: Record<string, unknown> }[]>`
        SELECT before, after FROM audit_log
        WHERE action = 'admin.surge.zone.update' LIMIT 1
      `;
      expect(rows[0]?.before['enabled']).toBe(true);
      expect(rows[0]?.after['enabled']).toBe(false);
    });

    it('answers 400 without an Idempotency-Key header', async () => {
      const response = await write('PATCH', `${ZONES_URL}/${AIRPORT_ZONE}`, { enabled: false }, {});

      expect(response.status).toBe(400);
    });
  });
});
