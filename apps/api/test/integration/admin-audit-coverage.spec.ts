import { DEFAULT_SURGE_TIERS } from '@parkease/contracts/admin';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type BookingStack, buildBookingStack, windowFromNow, zoneOf } from './booking-harness.js';
import {
  type Harness,
  seedBooking,
  seedSpace,
  seedUser,
  startHarness,
  stopHarness,
  surgePayload,
} from './harness.js';
import { actingAs, type HttpApp, startHttpApp, stopHttpApp } from './http-harness.js';

const ADMIN = '/api/v1/admin';
const ZONE_ID = 'tdr1v0';

/** One admin mutation: how to reach it, and how to build a state in which it succeeds. */
interface Mutation {
  /** `METHOD /pattern` exactly as Fastify registers it, so the guard below can match on it. */
  readonly route: string;
  /** The `audit_log.action` the row must carry. */
  readonly action: string;
  readonly expectStatus: 200 | 201;
  /**
   * Builds the rows the request acts on and returns the concrete request, plus the id the audit
   * row must name as its target: the id itself, or a lookup for one the request creates or that
   * is not in the URL.
   */
  readonly arrange: () => Promise<{
    url: string;
    payload: unknown;
    target: string | (() => Promise<string>);
  }>;
}

/**
 * Every admin mutation writes exactly one `audit_log` row.
 *
 * The table is the contract. It is deliberately a second list, separate from the controllers,
 * and the last test makes the two agree: every non-GET route Fastify reports under
 * `/api/v1/admin/` must have a row here. So a mutation added without an audit write fails in
 * the row that tests it, and a mutation added without a row fails the completeness test.
 * Neither can be forgotten quietly.
 *
 * Counts are taken table-wide, not per target: "exactly one" has to hold even if a command
 * writes its row against the wrong `target_id`, or writes two.
 */
describe('admin audit coverage, every mutation', () => {
  let h: Harness;
  let http: HttpApp;
  let stack: BookingStack;
  let adminId: string;
  let phoneCounter = 0;
  const registered = new Set<string>();

  const asAdmin = () => {
    actingAs.user = { id: adminId, roles: ['admin'], activeRole: 'admin' };
  };

  const send = (method: 'POST' | 'PUT' | 'PATCH', url: string, payload: unknown) =>
    http.request({ method, url, payload, headers: { 'idempotency-key': crypto.randomUUID() } });

  const auditCount = async (): Promise<number> => {
    const [row] = await h.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log`;
    if (row === undefined) throw new Error('count returned no row');
    return row.n;
  };

  const lastAudit = async () => {
    const [row] = await h.sql<
      { action: string; actor_user_id: string; actor_role: string | null; target_id: string }[]
    >`SELECT action, actor_user_id, actor_role, target_id FROM audit_log
       ORDER BY created_at DESC, id DESC LIMIT 1`;
    return row;
  };

  // ---- seeds. Shapes are the ones each feature's own HTTP spec uses. -------------------------

  const person = async (): Promise<string> => {
    phoneCounter += 1;
    const phone = `+9197${String(40_000_000 + phoneCounter)}`;
    const rows = await h.sql<{ id: string }[]>`
      INSERT INTO users (phone, firebase_uid, name)
      VALUES (${phone}, ${`fb-cover-${String(phoneCounter)}`}, 'Coverage Person') RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('failed to seed person');
    return id;
  };

  const pendingSpace = async (): Promise<string> => {
    const id = await seedSpace(h, {
      lat: 12.9345,
      lng: 77.6266,
      approvalStatus: 'pending_approval',
    });
    await h.sql`UPDATE spaces SET owner_id = ${h.ownerId}, submitted_at = now() WHERE id = ${id}`;
    return id;
  };

  const pendingValet = async (): Promise<string> => {
    const id = await person();
    await h.sql`INSERT INTO user_roles (user_id, role, status) VALUES (${id}, 'valet', 'pending')`;
    await h.sql`
      INSERT INTO valet_profiles (user_id, verification_status, licence_document_id, vehicle_number)
      VALUES (${id}, 'pending', 'parkease/documents/0190aaaa-licence', 'KA01AB1234')`;
    return id;
  };

  const paidBooking = async (status: 'confirmed' | 'completed'): Promise<string> => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    const driverId = await seedUser(h, 'driver');
    await h.redis.set(`surge:${await zoneOf(h, spaceId)}`, surgePayload(1.5));
    const window = windowFromNow(12, 2);
    const { booking } = await stack.create.execute({
      driverId,
      spaceId,
      vehicleType: 'car',
      durationType: 'hourly',
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      vehicleNumber: 'KA-01-AB-1234',
    });
    h.redis.clear();
    await h.sql`UPDATE bookings SET status = ${status} WHERE id = ${booking.id}`;
    // slice(-12): a UUIDv7's leading bits are its timestamp, so ids minted in the same
    // millisecond would collide on the unique gateway-id index.
    await h.sql`
      INSERT INTO payments (booking_id, user_id, razorpay_order_id, razorpay_payment_id,
                            expected_total_paise, captured_paise, status, captured_at)
      VALUES (${booking.id}, ${driverId}, ${`order_${booking.id.slice(-12)}`},
              ${`pay_${booking.id.slice(-12)}`}, ${booking.totalPaise}, ${booking.totalPaise},
              'captured', now())`;
    return booking.id;
  };

  /** A reported review of a completed stay, so remove and dismiss both have something to act on. */
  const reportedReview = async (): Promise<string> => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266 });
    const bookingId = await seedBooking(h, {
      spaceId,
      vehicleType: 'car',
      slotIndex: 0,
      slotStatus: 'released',
      startsInMinutes: -600,
      endsInMinutes: -300,
    });
    const reviewer = await seedUser(h, 'driver');
    const [row] = await h.sql<{ id: string }[]>`
      INSERT INTO reviews (booking_id, reviewer_user_id, reviewer_role, target_type, target_id,
                           rating, is_reported)
      VALUES (${bookingId}, ${reviewer}, 'driver', 'space', ${spaceId}, 2, true)
      RETURNING id`;
    if (row === undefined) throw new Error('failed to seed review');
    return row.id;
  };

  const surgeConfig = () => ({
    maxMultiplierBp: 20_000,
    peakHourModifierBp: 11_000,
    weekendModifierBp: 10_500,
    eventModifierBp: 12_000,
    occupancyWindowMinutes: 60,
    peakWindows: [{ days: ['mon', 'tue'], from: '08:00', to: '11:00' }],
    tiers: DEFAULT_SURGE_TIERS,
  });

  const surgeZone = {
    zoneId: ZONE_ID,
    label: 'Kempegowda Airport approach',
    reason: 'Structural scarcity; airport parking is 4x our rate',
  };

  // ---- the table ----------------------------------------------------------------------------

  /** Surge rows are keyed by their own uuid, not by the zone or key in the URL. */
  const surgeConfigId = async (): Promise<string> => {
    const [row] = await h.sql<{ id: string }[]>`SELECT id FROM surge_config WHERE key = 'global'`;
    if (row === undefined) throw new Error('surge_config has no global row');
    return row.id;
  };
  const surgeZoneId = async (): Promise<string> => {
    const [row] = await h.sql<{ id: string }[]>`
      SELECT id FROM surge_zone_overrides WHERE zone_id = ${ZONE_ID}`;
    if (row === undefined) throw new Error('no surge zone override was written');
    return row.id;
  };

  const table: Mutation[] = [
    {
      route: `POST ${ADMIN}/spaces/:id/approve`,
      action: 'space.approve',
      expectStatus: 200,
      arrange: async () => {
        const id = await pendingSpace();
        return {
          url: `${ADMIN}/spaces/${id}/approve`,
          payload: {},
          target: id,
        };
      },
    },
    {
      route: `POST ${ADMIN}/spaces/:id/reject`,
      action: 'space.reject',
      expectStatus: 200,
      arrange: async () => {
        const id = await pendingSpace();
        return {
          url: `${ADMIN}/spaces/${id}/reject`,
          payload: { notes: 'photos do not show the entrance' },
          target: id,
        };
      },
    },
    {
      route: `POST ${ADMIN}/spaces/:id/request-changes`,
      action: 'space.request-changes',
      expectStatus: 200,
      arrange: async () => {
        const id = await pendingSpace();
        return {
          url: `${ADMIN}/spaces/${id}/request-changes`,
          payload: { notes: 'add a photo of the gate' },
          target: id,
        };
      },
    },
    {
      route: `POST ${ADMIN}/users/:id/roles`,
      action: 'user.role.grant',
      expectStatus: 201,
      arrange: async () => {
        const id = await person();
        return {
          url: `${ADMIN}/users/${id}/roles`,
          payload: { role: 'owner', reason: 'verified in person' },
          target: id,
        };
      },
    },
    {
      route: `POST ${ADMIN}/users/:id/roles/:role/revoke`,
      action: 'user.role.revoke',
      expectStatus: 200,
      arrange: async () => {
        const id = await seedUser(h, 'owner');
        return {
          url: `${ADMIN}/users/${id}/roles/owner/revoke`,
          payload: { reason: 'left the team' },
          target: id,
        };
      },
    },
    {
      route: `POST ${ADMIN}/users/:id/block`,
      action: 'user.block',
      expectStatus: 200,
      arrange: async () => {
        const id = await person();
        return {
          url: `${ADMIN}/users/${id}/block`,
          payload: { reason: 'chargeback fraud' },
          target: id,
        };
      },
    },
    {
      route: `POST ${ADMIN}/users/:id/unblock`,
      action: 'user.unblock',
      expectStatus: 200,
      arrange: async () => {
        const id = await person();
        await h.sql`UPDATE users SET status = 'blocked' WHERE id = ${id}`;
        return {
          url: `${ADMIN}/users/${id}/unblock`,
          payload: { reason: 'appeal upheld' },
          target: id,
        };
      },
    },
    {
      route: `POST ${ADMIN}/partners/:id/verify`,
      action: 'partner.verify',
      expectStatus: 200,
      arrange: async () => {
        const id = await pendingValet();
        return {
          url: `${ADMIN}/partners/${id}/verify`,
          payload: { kind: 'valet' },
          target: id,
        };
      },
    },
    {
      route: `POST ${ADMIN}/partners/:id/reject`,
      action: 'partner.reject',
      expectStatus: 200,
      arrange: async () => {
        const id = await pendingValet();
        return {
          url: `${ADMIN}/partners/${id}/reject`,
          payload: { kind: 'valet', notes: 'licence is unreadable' },
          target: id,
        };
      },
    },
    {
      route: `POST ${ADMIN}/bookings/:id/cancel`,
      action: 'booking.cancel',
      expectStatus: 200,
      arrange: async () => {
        const id = await paidBooking('confirmed');
        return {
          url: `${ADMIN}/bookings/${id}/cancel`,
          payload: { reason: 'owner unreachable' },
          target: id,
        };
      },
    },
    {
      route: `POST ${ADMIN}/bookings/:id/refund`,
      action: 'booking.refund',
      expectStatus: 200,
      arrange: async () => {
        const id = await paidBooking('completed');
        return {
          url: `${ADMIN}/bookings/${id}/refund`,
          payload: { option: 'full_minus_fee', reason: 'spot flooded' },
          target: id,
        };
      },
    },
    {
      route: `POST ${ADMIN}/moderation/reviews/:id/remove`,
      action: 'review.remove',
      expectStatus: 200,
      arrange: async () => {
        const id = await reportedReview();
        return {
          url: `${ADMIN}/moderation/reviews/${id}/remove`,
          payload: { reason: 'spam_or_fake' },
          target: id,
        };
      },
    },
    {
      route: `POST ${ADMIN}/moderation/reviews/:id/dismiss`,
      action: 'review.dismiss',
      expectStatus: 200,
      arrange: async () => {
        const id = await reportedReview();
        return {
          url: `${ADMIN}/moderation/reviews/${id}/dismiss`,
          payload: {},
          target: id,
        };
      },
    },
    {
      route: `PUT ${ADMIN}/surge/config`,
      action: 'admin.surge.config.replace',
      expectStatus: 200,
      arrange: async () => {
        return {
          url: `${ADMIN}/surge/config`,
          payload: surgeConfig(),
          target: surgeConfigId,
        };
      },
    },
    {
      route: `POST ${ADMIN}/surge/zones`,
      action: 'admin.surge.zone.create',
      expectStatus: 201,
      arrange: async () => {
        return {
          url: `${ADMIN}/surge/zones`,
          payload: surgeZone,
          target: surgeZoneId,
        };
      },
    },
    {
      route: `PATCH ${ADMIN}/surge/zones/:zoneId`,
      action: 'admin.surge.zone.update',
      expectStatus: 200,
      arrange: async () => {
        // Seeded through the API, so the override exists in exactly the shape the PATCH reads.
        const created = await send('POST', `${ADMIN}/surge/zones`, surgeZone);
        expect(created.status).toBe(201);
        return {
          url: `${ADMIN}/surge/zones/${ZONE_ID}`,
          payload: { enabled: false },
          target: surgeZoneId,
        };
      },
    },
  ];

  beforeAll(async () => {
    h = await startHarness();
    http = await startHttpApp(h, undefined, undefined, undefined, ({ method, url }) => {
      if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
      if (url.startsWith(`${ADMIN}/`)) registered.add(`${method} ${url}`);
    });
    stack = buildBookingStack(h);
    adminId = await seedUser(h, 'admin');
  }, 300_000);

  afterAll(async () => {
    await stopHttpApp(http);
    await stopHarness(h);
  });

  beforeEach(async () => {
    await h.sql`TRUNCATE audit_log, idempotency_keys, surge_zone_overrides`;
    // The seeded global row is never deleted (migration 0024), so it is put back to a state the
    // PUT below genuinely changes: a PUT that changed nothing could fairly write no row.
    await h.sql`
      UPDATE surge_config
         SET occupancy_window_minutes = 45,
             peak_windows = '[]'::jsonb,
             updated_by = NULL
       WHERE key = 'global'`;
    h.redis.clear();
    asAdmin();
  });

  for (const mutation of table) {
    it(`${mutation.route} writes exactly one audit row`, async () => {
      const { url, payload, target } = await mutation.arrange();
      const before = await auditCount();
      const method = mutation.route.split(' ')[0] as 'POST' | 'PUT' | 'PATCH';

      const response = await send(method, url, payload);

      expect(response.status, JSON.stringify(response.body)).toBe(mutation.expectStatus);
      expect(await auditCount()).toBe(before + 1);
      const row = await lastAudit();
      expect(row?.actor_user_id).toBe(adminId);
      expect(row?.actor_role).toBe('admin');
      expect(row?.action).toBe(mutation.action);
      expect(row?.target_id).toBe(typeof target === 'string' ? target : await target());
    });
  }

  it('has a row for every non-GET admin route, and no row for a route that is gone', () => {
    // Floor: an empty capture (hook registered too late) must not pass as "nothing to cover".
    expect(registered.size).toBeGreaterThanOrEqual(15);

    const covered = new Set(table.map((m) => m.route));
    const missing = [...registered].filter((r) => !covered.has(r)).sort();
    const stale = [...covered].filter((r) => !registered.has(r)).sort();

    // A new mutation lands in `missing`: add a row above, which forces it to write its audit row.
    expect({ missing, stale }).toEqual({ missing: [], stale: [] });
  });
});
