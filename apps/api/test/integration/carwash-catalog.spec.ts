import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CatalogService, STANDARD_SERVICES } from '../../src/domains/carwash/catalog.service.js';
import { withTransaction } from '../../src/platform/db/transaction.js';

import { type Harness, seedUser, startHarness, stopHarness } from './harness.js';

/**
 * The service menu, against a real database.
 *
 * The invariant this file exists for is structural rather than behavioural: a
 * partner's menu is **two rows per service**, keyed so that v1's
 * `vehicle_type = 'both'` cannot be written at all. Asserting that needs the
 * unique constraint, so it needs Postgres.
 */

let h: Harness;
let catalog: CatalogService;
let washerId: string;

beforeAll(async () => {
  h = await startHarness();
  catalog = new CatalogService(h.db);
}, 180_000);

afterAll(async () => {
  if (h) await stopHarness(h);
}, 30_000);

beforeEach(async () => {
  await h.sql`TRUNCATE wash_job_offers, wash_jobs, wash_services, washer_profiles CASCADE`;
  washerId = await seedUser(h, 'washer');
});

describe('seeding a new partner', () => {
  it('creates two rows per service, one per vehicle type', async () => {
    await withTransaction(h.db, (tx) => catalog.seedMenu(tx, washerId));

    const rows = await catalog.menuFor(washerId);

    expect(rows).toHaveLength(STANDARD_SERVICES.length * 2);
    expect(new Set(rows.map((r) => r.serviceName)).size).toBe(STANDARD_SERVICES.length);
    expect(rows.filter((r) => r.vehicleType === 'car')).toHaveLength(STANDARD_SERVICES.length);
    expect(rows.filter((r) => r.vehicleType === 'two_wheeler')).toHaveLength(
      STANDARD_SERVICES.length,
    );
  });

  it('prices a car and a bike differently, which is the point', async () => {
    await withTransaction(h.db, (tx) => catalog.seedMenu(tx, washerId));

    const car = await catalog.findServicePrice(washerId, 'premium_wash', 'car');
    const bike = await catalog.findServicePrice(washerId, 'premium_wash', 'two_wheeler');

    expect(car?.pricePaise).toBe(39900);
    expect(bike?.pricePaise).toBe(14900);
  });

  /**
   * Registration and seeding share one transaction, so re-running the seed must
   * not blow up on a partner who already has a menu — a retried registration is
   * a normal outcome of an idempotent POST.
   */
  it('is idempotent', async () => {
    await withTransaction(h.db, (tx) => catalog.seedMenu(tx, washerId));
    await withTransaction(h.db, (tx) => catalog.seedMenu(tx, washerId));

    expect(await catalog.menuFor(washerId)).toHaveLength(STANDARD_SERVICES.length * 2);
  });
});

describe('editing a service', () => {
  beforeEach(async () => {
    await withTransaction(h.db, (tx) => catalog.seedMenu(tx, washerId));
  });

  it('upserts both vehicle-type rows from one edit', async () => {
    await catalog.upsertService({
      washerUserId: washerId,
      serviceName: 'premium_wash',
      carPricePaise: 44900,
      bikePricePaise: 17900,
      durationMinutes: 45,
      isActive: true,
    });

    const premium = (await catalog.menuFor(washerId)).filter(
      (r) => r.serviceName === 'premium_wash',
    );

    expect(premium).toHaveLength(2);
    expect(premium.find((r) => r.vehicleType === 'car')?.pricePaise).toBe(44900);
    expect(premium.find((r) => r.vehicleType === 'two_wheeler')?.pricePaise).toBe(17900);
    expect(premium.every((r) => r.durationMinutes === 45)).toBe(true);
  });

  it('leaves every other service alone', async () => {
    await catalog.upsertService({
      washerUserId: washerId,
      serviceName: 'premium_wash',
      carPricePaise: 44900,
      bikePricePaise: 17900,
      durationMinutes: 45,
      isActive: true,
    });

    const quickWipe = await catalog.findServicePrice(washerId, 'quick_wipe', 'car');
    expect(quickWipe?.pricePaise).toBe(9900);
  });

  it('deactivates both rows together', async () => {
    await catalog.upsertService({
      washerUserId: washerId,
      serviceName: 'full_detailing',
      carPricePaise: 79900,
      bikePricePaise: 29900,
      durationMinutes: 60,
      isActive: false,
    });

    const rows = (await catalog.menuFor(washerId)).filter(
      (r) => r.serviceName === 'full_detailing',
    );
    expect(rows.every((r) => !r.isActive)).toBe(true);
  });

  /**
   * An inactive row is not a cheaper row or a hidden row — it is no row at all
   * for pricing purposes, because the candidate query joins on `is_active` and
   * a partner who is not offering a service cannot be assigned one.
   */
  it('reports no price for a deactivated service', async () => {
    await catalog.upsertService({
      washerUserId: washerId,
      serviceName: 'interior_only',
      carPricePaise: 29900,
      bikePricePaise: 9900,
      durationMinutes: 30,
      isActive: false,
    });

    expect(await catalog.findServicePrice(washerId, 'interior_only', 'car')).toBeUndefined();
  });
});

describe('the constraint that resolves v1s ambiguity', () => {
  it('refuses a third row for a service the partner already prices twice', async () => {
    await withTransaction(h.db, (tx) => catalog.seedMenu(tx, washerId));

    await expect(
      h.sql`
        INSERT INTO wash_services (washer_user_id, service_name, vehicle_type, price_paise, duration_minutes)
        VALUES (${washerId}, 'premium_wash', 'car', 12345, 40)
      `,
    ).rejects.toThrow(/wash_services_menu_key/);
  });

  /**
   * §13.3. v1 introduced `VehicleType.BOTH` and then found no pricing query
   * could use it. There is now nowhere to put it.
   */
  it('refuses vehicle_type = both outright', async () => {
    await expect(
      h.sql`
        INSERT INTO wash_services (washer_user_id, service_name, vehicle_type, price_paise, duration_minutes)
        VALUES (${washerId}, 'premium_wash', 'both', 39900, 40)
      `,
    ).rejects.toThrow(/wash_services_vehicle_type_check/);
  });

  it('refuses a free service, which the ledger could not post', async () => {
    await expect(
      h.sql`
        INSERT INTO wash_services (washer_user_id, service_name, vehicle_type, price_paise, duration_minutes)
        VALUES (${washerId}, 'quick_wipe', 'car', 0, 10)
      `,
    ).rejects.toThrow(/wash_services_price_check/);
  });

  it('refuses a service name outside the v1 catalogue', async () => {
    await expect(
      h.sql`
        INSERT INTO wash_services (washer_user_id, service_name, vehicle_type, price_paise, duration_minutes)
        VALUES (${washerId}, 'ceramic_coating', 'car', 99900, 90)
      `,
    ).rejects.toThrow(/wash_services_service_name_check/);
  });
});
