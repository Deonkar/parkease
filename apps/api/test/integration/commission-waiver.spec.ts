import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { CommissionWaiverService } from '../../src/domains/pricing/commission-waiver.service.js';
import { OutboxService } from '../../src/platform/outbox/outbox.service.js';

import { windowFromNow } from './booking-harness.js';
import { type Harness, seedSpace, startHarness, stopHarness, truncateSpaces } from './harness.js';
import { actingAs, type HttpApp, startHttpApp, stopHttpApp } from './http-harness.js';

/**
 * Commission-free owners, over HTTP (task 16c, ADR-032). The driver pays what they pay anywhere;
 * the owner earns the full base; `promo_expense` funds the difference, and every path that
 * rebuilds a booking's money from its row — extension, cancellation — carries the waiver with it.
 */
describe('commission-free owners — pricing and bookings (task 16c)', () => {
  let h: Harness;
  let http: HttpApp;
  let spaceId: string;

  beforeAll(async () => {
    h = await startHarness();
    http = await startHttpApp(h);
  }, 300_000);

  afterAll(async () => {
    await stopHttpApp(http);
    await stopHarness(h);
  });

  /** A new space and no bookings: TRUNCATE … CASCADE clears the append-only ledger rows too. */
  const fresh = async () => {
    await truncateSpaces(h);
    spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 2 });
  };

  beforeEach(async () => {
    await h.sql`TRUNCATE idempotency_keys, commission_waivers`;
    await fresh();
    actingAs.user = { id: h.driverId, roles: ['driver'], activeRole: 'driver' };
  });

  const created = z.object({ data: z.object({ id: z.string().uuid() }) });
  const quoted = z.object({
    data: z.object({
      quote: z.object({ basePaise: z.number() }).passthrough(),
    }),
  });
  const key = () => crypto.randomUUID();
  const window = windowFromNow(2, 2);
  const createBody = () => ({
    spaceId,
    vehicleType: 'car' as const,
    durationType: 'hourly' as const,
    startsAt: window.startsAt.toISOString(),
    endsAt: window.endsAt.toISOString(),
  });
  const post = (url: string, payload: unknown) =>
    http.request({ method: 'POST', url, payload, headers: { 'idempotency-key': key() } });

  const grant = (startsAt: Date, endsAt: Date) =>
    h.sql`INSERT INTO commission_waivers (owner_id, slot, starts_at, ends_at)
          VALUES (${h.ownerId}, 1, ${startsAt.toISOString()}::timestamptz,
                  ${endsAt.toISOString()}::timestamptz)`;
  const inWindow = () =>
    grant(new Date(Date.now() - 86_400_000), new Date(Date.now() + 30 * 86_400_000));

  const book = async (): Promise<string> => {
    const res = await post('/api/v1/driver/bookings', createBody());
    expect(res.status).toBe(201);
    return created.parse(res.body).data.id;
  };
  const money = async (id: string) => {
    const [row] = await h.sql<{ base: number; owner: number; waiver: number; total: number }[]>`
      SELECT base_paise::int AS base, owner_earnings_paise::int AS owner,
             commission_waiver_paise::int AS waiver, total_paise::int AS total
      FROM bookings WHERE id = ${id}`;
    if (row === undefined) throw new Error(`no booking ${id}`);
    return row;
  };
  const promoNet = async (id: string): Promise<number> => {
    const [row] = await h.sql<{ net: string }[]>`
      SELECT coalesce(sum(CASE direction WHEN 'debit' THEN amount_paise ELSE -amount_paise END), 0)::text AS net
      FROM ledger_entries WHERE booking_id = ${id} AND account = 'promo_expense'`;
    return Number(row?.net);
  };

  it('books a waived owner at the unwaived price, the owner earning the full base', async () => {
    const plain = await money(await book());
    await fresh();
    await inWindow();

    const waived = await money(await book());

    expect(waived.total).toBe(plain.total);
    expect(waived.owner).toBe(waived.base);
    expect(waived.waiver).toBe(plain.base - plain.owner);
  });

  it('funds the waiver from promo_expense on the booking posting', async () => {
    await inWindow();
    const id = await book();

    expect(await promoNet(id)).toBe((await money(id)).waiver);
  });

  it('does not waive before starts_at, or once the window has ended', async () => {
    await grant(new Date(Date.now() + 86_400_000), new Date(Date.now() + 90 * 86_400_000));
    expect((await money(await book())).waiver).toBe(0);

    await h.sql`UPDATE commission_waivers
                SET starts_at = now() - interval '4 months', ends_at = now()`;
    await fresh();
    expect((await money(await book())).waiver).toBe(0);
  });

  it('adds an extension quoted in the window, and nothing for one quoted after it', async () => {
    await inWindow();
    const id = await book();
    await h.sql`UPDATE bookings SET status = 'confirmed' WHERE id = ${id}`;
    const before = await money(id);
    const extendTo = (hours: number) =>
      post(`/api/v1/driver/bookings/${id}/extend`, {
        newEndsAt: new Date(window.endsAt.getTime() + hours * 3_600_000).toISOString(),
      });

    expect((await extendTo(1)).status).toBe(201);
    const grown = await money(id);
    expect(grown.waiver).toBeGreaterThan(before.waiver);
    expect(grown.owner).toBe(grown.base);

    await h.sql`UPDATE commission_waivers
                SET starts_at = now() - interval '4 months', ends_at = now() - interval '1 minute'`;
    expect((await extendTo(2)).status).toBe(201);
    expect((await money(id)).waiver).toBe(grown.waiver);
  });

  it('cancelling an unpaid waived booking returns the whole waiver to promo_expense', async () => {
    await inWindow();
    const id = await book();
    // Confirmed without a captured payment: the cancel path reverses the receivable from the row.
    await h.sql`UPDATE bookings SET status = 'confirmed' WHERE id = ${id}`;

    expect((await post(`/api/v1/driver/bookings/${id}/cancel`, {})).status).toBe(201);

    expect(await promoNet(id)).toBe(0);
  });

  it('is waived from exactly starts_at, and not at exactly ends_at', async () => {
    const startsAt = new Date('2026-11-01T00:00:00Z');
    const endsAt = new Date('2027-02-01T00:00:00Z');
    await grant(startsAt, endsAt);
    const waivers = new CommissionWaiverService(h.db, new OutboxService());

    expect(await waivers.activeFor(h.ownerId, new Date(startsAt.getTime() - 1))).toBeNull();
    expect(await waivers.activeFor(h.ownerId, startsAt)).toEqual({ endsAt });
    expect(await waivers.activeFor(h.ownerId, new Date(endsAt.getTime() - 1))).toEqual({ endsAt });
    expect(await waivers.activeFor(h.ownerId, endsAt)).toBeNull();
  });

  it("never tells the driver the owner's share, which would reveal the waiver (S-124)", async () => {
    await inWindow();
    const body = createBody();
    const res = await http.request({
      method: 'GET',
      url: `/api/v1/driver/quotes?spaceId=${spaceId}&vehicleType=car&durationType=hourly&startsAt=${encodeURIComponent(body.startsAt)}&endsAt=${encodeURIComponent(body.endsAt)}`,
    });

    expect(res.status).toBe(200);
    const { quote } = quoted.parse(res.body).data;
    expect(quote).not.toHaveProperty('ownerEarningsPaise');
    expect(JSON.stringify(res.body)).not.toMatch(/ownerEarnings/);
  });
});
