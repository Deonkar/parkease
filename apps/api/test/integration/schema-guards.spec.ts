import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pgConstraintName } from '../../src/platform/db/errors.js';

import {
  type Harness,
  seedBooking,
  seedSpace,
  seedUser,
  startHarness,
  stopHarness,
} from './harness.js';

/**
 * Database guards added for rules only the application held (migrations 0048–0051). Each case is
 * a direct write, the path a console fix or a future bug takes, refused by the database itself.
 */
describe('schema guards', () => {
  let h: Harness;
  let spaceId: string;

  beforeAll(async () => {
    h = await startHarness();
    spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 4 });
  }, 300_000);

  afterAll(async () => {
    await stopHarness(h);
  });

  const refusedBy = async (write: Promise<unknown>) =>
    pgConstraintName(
      await write.then(
        () => null,
        (error: unknown) => error,
      ),
    );

  const washJob = async (status = 'requested', washer: string | null = null) => {
    const bookingId = await seedBooking(h, {
      spaceId,
      vehicleType: 'car',
      slotIndex: Math.floor(Math.random() * 4),
      slotStatus: 'released',
    });
    const [row] = await h.sql<{ id: string }[]>`
      INSERT INTO wash_jobs (booking_id, driver_user_id, washer_user_id, status, service_name,
                             vehicle_type, space_location, offer_radius_m, commission_rate,
                             price_paise, txn_id)
      VALUES (${bookingId}, ${h.driverId}, ${washer}, ${status}, 'premium_wash', 'car',
              ST_SetSRID(ST_MakePoint(77.6266, 12.9345), 4326)::geography, 5000, 0.2,
              ${washer === null ? null : 39900}, ${washer === null ? null : crypto.randomUUID()})
      RETURNING id`;
    return row?.id ?? '';
  };

  it("refuses a wash offer to the job's own driver (S-20)", async () => {
    const jobId = await washJob();
    expect(
      await refusedBy(
        h.sql`INSERT INTO wash_job_offers (job_id, washer_user_id, distance_m, offer_round)
              VALUES (${jobId}, ${h.driverId}, 100, 0)`,
      ),
    ).toBe('offers_not_to_own_driver');
  });

  it('still accepts an offer to anyone else', async () => {
    const jobId = await washJob();
    const washer = await seedUser(h, 'washer');
    await expect(
      h.sql`INSERT INTO wash_job_offers (job_id, washer_user_id, distance_m, offer_round)
            VALUES (${jobId}, ${washer}, 100, 0)`,
    ).resolves.toBeDefined();
  });

  it('refuses a completed wash with no completion time (S-32)', async () => {
    const washer = await seedUser(h, 'washer');
    const jobId = await washJob('accepted', washer);
    await h.sql`UPDATE wash_jobs SET before_photo_id = 'parkease/proofs/0190b', status = 'washing'
                WHERE id = ${jobId}`;
    expect(
      await refusedBy(
        h.sql`UPDATE wash_jobs SET status = 'completed', after_photo_id = 'parkease/proofs/0190a'
              WHERE id = ${jobId}`,
      ),
    ).toBe('wash_jobs_completed_at_check');
  });

  it('refuses a service price outside ₹10–₹9,999 (S-47)', async () => {
    const washer = await seedUser(h, 'washer');
    expect(
      await refusedBy(
        h.sql`INSERT INTO wash_services (washer_user_id, service_name, vehicle_type, price_paise,
                                         duration_minutes, is_active)
              VALUES (${washer}, 'premium_wash', 'car', 500, 30, true)`,
      ),
    ).toBe('wash_services_price_range_check');
  });

  it('refuses a business with no photos, a blank name, or an unknown capability (S-56, S-57)', async () => {
    const insert = async (fields: { photos: string[]; name: string; caps: string[] }) =>
      refusedBy(
        h.sql`INSERT INTO washer_profiles (user_id, partner_type, business_name,
                                           business_photo_ids, capabilities)
              VALUES (${await seedUser(h, 'washer')}, 'business', ${fields.name},
                      ${fields.photos}, ${fields.caps})`,
      );
    const photo = ['parkease/spaces/0190x'];
    expect(await insert({ photos: [], name: 'Shop', caps: [] })).toBe(
      'washer_profiles_business_photos_check',
    );
    expect(await insert({ photos: photo, name: '   ', caps: [] })).toBe(
      'washer_profiles_business_name_not_blank_check',
    );
    expect(await insert({ photos: photo, name: 'Shop', caps: ['car_spa'] })).toBe(
      'washer_profiles_capabilities_check',
    );
  });

  it('serves the offers-by-job lookup from the unique key once the duplicate index is gone (S-21)', async () => {
    const plan = (
      await h.db.execute(sql`
        EXPLAIN SELECT * FROM valet_job_offers
        WHERE job_id = '0192f1c0-0000-7000-8000-000000000001'`)
    )
      .map((r) => String((r as Record<string, unknown>)['QUERY PLAN']))
      .join('\n');
    expect(plan).not.toContain('valet_job_offers_job_id_idx');
    const [idx] = await h.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'valet_job_offers_job_id_idx'`;
    expect(idx?.n).toBe(0);
  });
});
