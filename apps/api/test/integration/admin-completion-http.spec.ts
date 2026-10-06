import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAX_CONCURRENT_EXPORTS } from '../../src/domains/ledger/queries/ledger-export.js';

import { zoneOf } from './booking-harness.js';
import {
  type Harness,
  seedSpace,
  seedUser,
  startHarness,
  stopHarness,
  surgePayload,
} from './harness.js';
import { actingAs, type HttpApp, startHttpApp, stopHttpApp } from './http-harness.js';

/** Task 18 completion: the heat map, the dashboard series, the export cap and its audit row. */
describe('admin completion HTTP (task 18)', () => {
  let h: Harness;
  let http: HttpApp;

  beforeAll(async () => {
    h = await startHarness();
    http = await startHttpApp(h);
    const adminId = await seedUser(h, 'admin');
    actingAs.user = { id: adminId, roles: ['admin'], activeRole: 'admin' };
  });

  afterAll(async () => {
    await stopHttpApp(http);
    await stopHarness(h);
  });

  it('the heat map lists every zone with an active space and its live multiplier', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    const zone = await zoneOf(h, spaceId);
    await h.redis.set(`surge:${zone}`, surgePayload(1.5));

    const res = await http.request({ method: 'GET', url: '/api/v1/admin/surge/heatmap' });

    expect(res.status).toBe(200);
    const cells = (
      res.body as {
        data: {
          zoneId: string;
          activeSpaces: number;
          overridden: boolean;
          live: { multiplierBp: number };
        }[];
      }
    ).data;
    const cell = cells.find((c) => c.zoneId === zone);
    expect(cell).toMatchObject({
      activeSpaces: 1,
      overridden: false,
      live: { multiplierBp: 15_000 },
    });
  });

  it('the dashboard carries a per-day gross series from the same ledger slice as the gross card', async () => {
    const res = await http.request({
      method: 'GET',
      url: '/api/v1/admin/dashboard?from=2026-01-01&to=2026-12-31',
    });
    expect(res.status).toBe(200);
    const d = (res.body as { data: { grossPaise: number; series: { grossPaise: number }[] } }).data;
    expect(d.series.reduce((s, p) => s + p.grossPaise, 0)).toBe(d.grossPaise);
  });

  it('caps concurrent exports, answers 429 as JSON beyond the cap, and audits each export', async () => {
    const fastify = http.app.getHttpAdapter().getInstance();
    const url = '/api/v1/admin/ledger/export?from=2026-01-01&to=2026-12-31';
    const before = await h.sql<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM audit_log WHERE action = 'ledger.export'`;

    // Held open: payloadAsStream leaves each body unread, so each export keeps its slot.
    const open = await Promise.all(
      Array.from({ length: MAX_CONCURRENT_EXPORTS }, () =>
        fastify.inject({ method: 'GET', url, payloadAsStream: true }),
      ),
    );
    const third = await http.request({ method: 'GET', url });

    expect(open.every((r) => r.statusCode === 200)).toBe(true);
    expect(third.status).toBe(429);
    expect(third.body).toMatchObject({ error: { code: 'EXPORT_BUSY' } });

    for (const r of open) r.stream().destroy();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const after = await http.request({ method: 'GET', url });
    expect(after.status).toBe(200);

    const [row] = await h.sql<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM audit_log WHERE action = 'ledger.export'`;
    expect((row?.n ?? 0) - (before[0]?.n ?? 0)).toBe(MAX_CONCURRENT_EXPORTS + 1);
  });

  it('refuses a form-encoded write with 415 before anything else runs', async () => {
    const res = await http.request({
      method: 'POST',
      url: '/api/v1/admin/surge/zones',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'idempotency-key': crypto.randomUUID(),
      },
      rawPayload: 'zoneId=tdr1v0&label=x&reason=y',
    });
    expect(res.status).toBe(415);
  });
});
