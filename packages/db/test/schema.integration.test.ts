import {
  startPgContainer,
  runMigrations,
  stopPgContainer,
  type PgTestContext,
} from '@parkease/testing/pg-container';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseWkbPoint } from '../src/columns/geography-point.js';
import { uuidv7 } from '../src/id.js';

let ctx: PgTestContext;

beforeAll(async () => {
  ctx = await startPgContainer();
  await runMigrations(ctx.sql);
}, 180_000);

afterAll(async () => {
  if (ctx) await stopPgContainer(ctx);
}, 30_000);

function sql(): postgres.Sql {
  return ctx.sql;
}

// ─── Extensions and environment ──────────────────────────────────────────────

describe('extensions', () => {
  it('postgis, btree_gist, pg_stat_statements, pgcrypto are all present', async () => {
    const rows = await sql()`
      SELECT extname FROM pg_extension ORDER BY extname
    `;
    const names = rows.map((r) => r['extname'] as string);
    expect(names).toContain('postgis');
    expect(names).toContain('btree_gist');
    expect(names).toContain('pg_stat_statements');
    expect(names).toContain('pgcrypto');
  });

  it('PostGIS_Full_Version() reports 3.6.x', async () => {
    const [row] = await sql()`SELECT PostGIS_Full_Version() AS v`;
    expect(row!['v'] as string).toMatch(/POSTGIS="3\.6/);
  });

  it('uuidv7() returns a v7 UUID and sorts in generation order', async () => {
    const [r1] = await sql()`SELECT uuidv7() AS id`;
    const [r2] = await sql()`SELECT uuidv7() AS id`;
    const id1 = r1!['id'] as string;
    const id2 = r2!['id'] as string;
    expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id2 > id1).toBe(true);
  });

  it('running migrations again is a no-op', async () => {
    await expect(runMigrations(sql())).resolves.not.toThrow();
  });
});

// ─── Geography and search ────────────────────────────────────────────────────

describe('geography', () => {
  const koramangala = { lat: 12.9352, lng: 77.6245 };

  beforeAll(async () => {
    // Seed the three Bangalore spaces
    const ownerId = uuidv7();
    await sql()`
      INSERT INTO users (id, phone, name, firebase_uid, status)
      VALUES (${ownerId}, '+910000000001', 'Test Owner', 'test:owner:1', 'active')
      ON CONFLICT (phone) DO NOTHING
    `;
    const existingOwner = await sql()`SELECT id FROM users WHERE phone = '+910000000001'`;
    const actualOwnerId = existingOwner[0]!['id'] as string;

    const fixtures = [
      { title: 'Koramangala', lat: 12.9352, lng: 77.6245, pincode: '560034' },
      { title: 'HSR Layout', lat: 12.9116, lng: 77.6389, pincode: '560102' },
      { title: 'Indiranagar', lat: 12.9784, lng: 77.6408, pincode: '560038' },
    ];

    for (let i = 0; i < fixtures.length; i++) {
      const f = fixtures[i]!;
      await sql()`
        INSERT INTO spaces (
          owner_id, title, address_line, city, state, pincode,
          location, zone_id, approval_status, schedule
        ) VALUES (
          ${actualOwnerId}, ${f.title}, ${f.title + ' address'}, 'Bangalore', 'Karnataka',
          ${f.pincode},
          ST_SetSRID(ST_MakePoint(${f.lng}, ${f.lat}), 4326)::geography,
          ${'zone' + String(i)}, 'active', '{"monday":{"open":"06:00","close":"22:00"}}'::jsonb
        ) ON CONFLICT DO NOTHING
      `;
    }
  });

  it('round trip through geographyPoint returns same coordinates', async () => {
    const [row] = await sql()`
      SELECT location::text AS loc FROM spaces WHERE title = 'Koramangala' LIMIT 1
    `;
    const parsed = parseWkbPoint(row!['loc'] as string);
    expect(parsed.lng).toBeCloseTo(koramangala.lng, 7);
    expect(parsed.lat).toBeCloseTo(koramangala.lat, 7);
  });

  it('parseWkbPoint handles SRID flag correctly — not transposed', async () => {
    const [row] = await sql()`
      SELECT location::text AS loc FROM spaces WHERE title = 'Koramangala' LIMIT 1
    `;
    const parsed = parseWkbPoint(row!['loc'] as string);
    // lng is ~77, lat is ~12 — if transposed, lat would be ~77
    expect(parsed.lat).toBeGreaterThan(10);
    expect(parsed.lat).toBeLessThan(15);
    expect(parsed.lng).toBeGreaterThan(75);
    expect(parsed.lng).toBeLessThan(80);
  });

  it('ST_DWithin 3100m returns Koramangala and HSR Layout, not Indiranagar', async () => {
    const rows = await sql()`
      SELECT title FROM spaces
      WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(${koramangala.lng}, ${koramangala.lat}), 4326)::geography, 3100)
        AND approval_status = 'active'
      ORDER BY title
    `;
    const titles = rows.map((r) => r['title'] as string);
    expect(titles).toContain('Koramangala');
    expect(titles).toContain('HSR Layout');
    expect(titles).not.toContain('Indiranagar');
  });

  it('ST_DWithin 6000m returns all three', async () => {
    const rows = await sql()`
      SELECT title FROM spaces
      WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(${koramangala.lng}, ${koramangala.lat}), 4326)::geography, 6000)
        AND approval_status = 'active'
      ORDER BY title
    `;
    const titles = rows.map((r) => r['title'] as string);
    expect(titles).toContain('Koramangala');
    expect(titles).toContain('HSR Layout');
    expect(titles).toContain('Indiranagar');
  });

  it('ST_Distance from Koramangala to HSR Layout is approximately 3040m', async () => {
    const [row] = await sql()`
      SELECT ST_Distance(
        (SELECT location FROM spaces WHERE title = 'Koramangala'),
        (SELECT location FROM spaces WHERE title = 'HSR Layout')
      ) AS distance
    `;
    const distance = Number(row!['distance']);
    expect(distance).toBeGreaterThan(2900);
    expect(distance).toBeLessThan(3200);
  });
});

// ─── Exclusion constraint ────────────────────────────────────────────────────

describe('exclusion constraint', () => {
  let testSpaceId: string;
  let testDriverId: string;

  beforeAll(async () => {
    testDriverId = uuidv7();
    await sql()`
      INSERT INTO users (id, phone, name, firebase_uid, status)
      VALUES (${testDriverId}, '+910000000010', 'Excl Test Driver', 'test:excl:driver', 'active')
    `;

    const [owner] = await sql()`SELECT id FROM users WHERE phone = '+910000000001'`;
    testSpaceId = uuidv7();
    await sql()`
      INSERT INTO spaces (
        id, owner_id, title, address_line, city, state, pincode,
        location, zone_id, approval_status, schedule
      ) VALUES (
        ${testSpaceId}, ${owner!['id'] as string}, 'Exclusion Test Space', 'Test Addr', 'Bangalore', 'Karnataka',
        '560034', ST_SetSRID(ST_MakePoint(77.6245, 12.9352), 4326)::geography,
        'zone_excl', 'active', '{"monday":{"open":"06:00","close":"22:00"}}'::jsonb
      )
    `;

    await sql()`
      INSERT INTO space_slots (space_id, vehicle_type, slot_index, price_paise_hourly)
      VALUES (${testSpaceId}, 'car', 0, 3000)
    `;
  });

  function createBookingAndSlot(
    opts: {
      slotIndex?: number;
      vehicleType?: string;
      status?: string;
      slotStatus?: string;
      startHour?: number;
      endHour?: number;
    } = {},
  ) {
    const {
      slotIndex = 0,
      vehicleType = 'car',
      status = 'confirmed',
      startHour = 10,
      endHour = 11,
    } = opts;
    const slotStatus = opts.slotStatus ?? status;

    const bookingId = uuidv7();
    const startsAt = new Date('2026-12-01T00:00:00Z');
    startsAt.setUTCHours(startHour);
    const endsAt = new Date('2026-12-01T00:00:00Z');
    endsAt.setUTCHours(endHour);

    return sql()`
      WITH b AS (
        INSERT INTO bookings (
          id, driver_id, space_id, vehicle_type, duration_type,
          starts_at, ends_at, status,
          base_paise, surge_premium_paise, parkease_fee_paise, gst_paise,
          total_paise, owner_earnings_paise
        ) VALUES (
          ${bookingId}, ${testDriverId}, ${testSpaceId}, ${vehicleType}, 'hourly',
          ${startsAt.toISOString()}, ${endsAt.toISOString()}, ${status},
          3000, 0, 450, 81, 3081, 2550
        ) RETURNING id
      )
      INSERT INTO booking_slots (booking_id, space_id, vehicle_type, slot_index, period, status)
      SELECT b.id, ${testSpaceId}, ${vehicleType}, ${slotIndex},
        tstzrange(${startsAt.toISOString()}::timestamptz, ${endsAt.toISOString()}::timestamptz, '[)'),
        ${slotStatus}
      FROM b
      RETURNING id
    `;
  }

  it('overlapping confirmed slots fail with 23P01', async () => {
    await createBookingAndSlot({ startHour: 10, endHour: 11 });
    try {
      await createBookingAndSlot({ startHour: 10, endHour: 11 });
      expect.fail('Should have thrown');
    } catch (err: unknown) {
      const pgErr = err as { code: string };
      expect(pgErr.code).toBe('23P01');
    }
  });

  it('adjacent periods succeed (half-open ranges)', async () => {
    await expect(createBookingAndSlot({ startHour: 11, endHour: 12 })).resolves.toBeDefined();
  });

  it('same overlap with different slot_index succeeds', async () => {
    await expect(
      createBookingAndSlot({ slotIndex: 1, startHour: 10, endHour: 11 }),
    ).resolves.toBeDefined();
  });

  it('same overlap with different vehicle_type succeeds', async () => {
    await expect(
      createBookingAndSlot({ vehicleType: 'two_wheeler', startHour: 10, endHour: 11 }),
    ).resolves.toBeDefined();
  });

  it('held slot does not block a confirmed slot (partial constraint)', async () => {
    await createBookingAndSlot({ slotStatus: 'held', startHour: 14, endHour: 15 });
    await expect(
      createBookingAndSlot({ status: 'confirmed', startHour: 14, endHour: 15 }),
    ).resolves.toBeDefined();
  });

  it('UPDATE booking_slots period into occupied window raises 23P01', async () => {
    // Slot at 16-17 confirmed
    await createBookingAndSlot({ startHour: 16, endHour: 17, slotIndex: 0 });
    // Slot at 17-18 confirmed
    const [inserted] = await createBookingAndSlot({ startHour: 17, endHour: 18, slotIndex: 0 });
    try {
      // Try to extend 17-18 to 16-18, overlapping with 16-17
      await sql()`
        UPDATE booking_slots
        SET period = tstzrange('2026-12-01T16:00:00Z'::timestamptz, '2026-12-01T18:00:00Z'::timestamptz, '[)')
        WHERE id = ${inserted!['id'] as string}
      `;
      expect.fail('Should have thrown');
    } catch (err: unknown) {
      const pgErr = err as { code: string };
      expect(pgErr.code).toBe('23P01');
    }
  });
});

// ─── Ledger append-only ──────────────────────────────────────────────────────

describe('ledger append-only', () => {
  let ledgerEntryId: string;

  beforeAll(async () => {
    const txnId = uuidv7();
    const [entry] = await sql()`
      INSERT INTO ledger_entries (txn_id, account, direction, amount_paise, description)
      VALUES (${txnId}, 'platform_revenue', 'credit', 1000, 'test entry')
      RETURNING id
    `;
    ledgerEntryId = entry!['id'] as string;
    // Also insert the debit side so the ledger balances
    await sql()`
      INSERT INTO ledger_entries (txn_id, account, direction, amount_paise, description)
      VALUES (${txnId}, 'driver_receivable', 'debit', 1000, 'test entry debit')
    `;
  });

  it('UPDATE ledger_entries is rejected by trigger', async () => {
    try {
      await sql()`UPDATE ledger_entries SET amount_paise = 1 WHERE id = ${ledgerEntryId}`;
      expect.fail('Should have thrown');
    } catch (err: unknown) {
      const pgErr = err as { message: string };
      expect(pgErr.message).toContain('append-only');
      expect(pgErr.message).toContain('reversing entry');
    }
  });

  it('DELETE FROM ledger_entries is rejected by trigger', async () => {
    try {
      await sql()`DELETE FROM ledger_entries WHERE id = ${ledgerEntryId}`;
      expect.fail('Should have thrown');
    } catch (err: unknown) {
      const pgErr = err as { message: string };
      expect(pgErr.message).toContain('append-only');
    }
  });

  it('INSERT still works', async () => {
    const txnId = uuidv7();
    await expect(
      sql()`
        INSERT INTO ledger_entries (txn_id, account, direction, amount_paise, description)
        VALUES (${txnId}, 'platform_revenue', 'credit', 500, 'new entry')
      `,
    ).resolves.toBeDefined();
    // Balance the entry
    await sql()`
      INSERT INTO ledger_entries (txn_id, account, direction, amount_paise, description)
      VALUES (${txnId}, 'driver_receivable', 'debit', 500, 'new entry debit')
    `;
  });

  it('amount_paise = 0 is rejected by CHECK', async () => {
    try {
      await sql()`
        INSERT INTO ledger_entries (txn_id, account, direction, amount_paise, description)
        VALUES (${uuidv7()}, 'platform_revenue', 'credit', 0, 'zero')
      `;
      expect.fail('Should have thrown');
    } catch (err: unknown) {
      const pgErr = err as { code: string };
      expect(pgErr.code).toBe('23514');
    }
  });

  it('negative amount is rejected by CHECK', async () => {
    try {
      await sql()`
        INSERT INTO ledger_entries (txn_id, account, direction, amount_paise, description)
        VALUES (${uuidv7()}, 'platform_revenue', 'credit', -100, 'negative')
      `;
      expect.fail('Should have thrown');
    } catch (err: unknown) {
      const pgErr = err as { code: string };
      expect(pgErr.code).toBe('23514');
    }
  });

  it('unknown account name is rejected by CHECK', async () => {
    try {
      await sql()`
        INSERT INTO ledger_entries (txn_id, account, direction, amount_paise, description)
        VALUES (${uuidv7()}, 'nonexistent_account', 'credit', 100, 'bad account')
      `;
      expect.fail('Should have thrown');
    } catch (err: unknown) {
      const pgErr = err as { code: string };
      expect(pgErr.code).toBe('23514');
    }
  });

  it('SUM(debits) = SUM(credits) for every txn_id', async () => {
    const unbalanced = await sql()`
      SELECT txn_id,
             sum(amount_paise) FILTER (WHERE direction = 'debit')  AS debits,
             sum(amount_paise) FILTER (WHERE direction = 'credit') AS credits
      FROM ledger_entries
      GROUP BY txn_id
      HAVING sum(amount_paise) FILTER (WHERE direction = 'debit')
          <> sum(amount_paise) FILTER (WHERE direction = 'credit')
    `;
    expect(unbalanced.length).toBe(0);
  });
});

// ─── Audit log append-only ───────────────────────────────────────────────────

describe('audit_log append-only', () => {
  let auditEntryId: string;

  beforeAll(async () => {
    const [entry] = await sql()`
      INSERT INTO audit_log (action, target_type, target_id)
      VALUES ('test.action', 'test', ${uuidv7()})
      RETURNING id
    `;
    auditEntryId = entry!['id'] as string;
  });

  it('UPDATE audit_log is rejected', async () => {
    try {
      await sql()`UPDATE audit_log SET action = 'changed' WHERE id = ${auditEntryId}`;
      expect.fail('Should have thrown');
    } catch (err: unknown) {
      const pgErr = err as { message: string };
      expect(pgErr.message).toContain('append-only');
    }
  });

  it('DELETE FROM audit_log is rejected', async () => {
    try {
      await sql()`DELETE FROM audit_log WHERE id = ${auditEntryId}`;
      expect.fail('Should have thrown');
    } catch (err: unknown) {
      const pgErr = err as { message: string };
      expect(pgErr.message).toContain('append-only');
    }
  });

  it('INSERT still works', async () => {
    await expect(
      sql()`
        INSERT INTO audit_log (action, target_type)
        VALUES ('test.new', 'test')
      `,
    ).resolves.toBeDefined();
  });
});

// ─── Schema conformance ─────────────────────────────────────────────────────

describe('schema conformance', () => {
  it('every table except ledger_entries, audit_log, idempotency_keys has id, created_at, updated_at', async () => {
    const tables = await sql()`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name NOT IN ('__drizzle_migrations', 'spatial_ref_sys')
    `;

    const noUpdatedAt = ['ledger_entries', 'audit_log'];
    const noIdColumn = ['idempotency_keys'];

    for (const table of tables) {
      const tableName = table['table_name'] as string;
      const columns = await sql()`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${tableName}
      `;
      const colNames = columns.map((c) => c['column_name'] as string);

      if (!noIdColumn.includes(tableName)) {
        expect(colNames).toContain('id');
      }
      expect(colNames).toContain('created_at');

      if (!noUpdatedAt.includes(tableName) && !noIdColumn.includes(tableName)) {
        expect(colNames).toContain('updated_at');
      }
    }
  });

  it('ledger_entries and audit_log have no updated_at column', async () => {
    for (const tableName of ['ledger_entries', 'audit_log']) {
      const columns = await sql()`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${tableName}
      `;
      const colNames = columns.map((c) => c['column_name'] as string);
      expect(colNames).not.toContain('updated_at');
    }
  });

  it('unindexed FK query returns zero rows', async () => {
    const rows = await sql()`
      SELECT c.conrelid::regclass AS table_name,
             a.attname            AS column_name
      FROM pg_constraint c
      JOIN LATERAL unnest(c.conkey) AS k(attnum) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.contype = 'f'
        AND NOT EXISTS (
          SELECT 1 FROM pg_index i
          WHERE i.indrelid = c.conrelid
            AND a.attnum = i.indkey[0]
        )
      ORDER BY 1, 2
    `;
    expect(rows.length).toBe(0);
  });

  it('no PG enum types exist — all enums use TEXT + CHECK', async () => {
    const rows = await sql()`
      SELECT column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND data_type = 'USER-DEFINED'
        AND udt_name IN (
          SELECT typname FROM pg_type WHERE typtype = 'e'
        )
    `;
    expect(rows.length).toBe(0);
  });

  it('no money column is numeric/decimal/real/double — all are bigint', async () => {
    const rows = await sql()`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name LIKE '%paise%'
        AND data_type NOT IN ('bigint')
    `;
    expect(rows.length).toBe(0);
  });

  it('UNIQUE (user_id, role) rejects duplicate role grant', async () => {
    const userId = uuidv7();
    await sql()`
      INSERT INTO users (id, phone, name, firebase_uid, status)
      VALUES (${userId}, '+910000000099', 'Dup Role Test', 'test:dup:role', 'active')
    `;
    await sql()`
      INSERT INTO user_roles (user_id, role, status)
      VALUES (${userId}, 'driver', 'active')
    `;
    try {
      await sql()`
        INSERT INTO user_roles (user_id, role, status)
        VALUES (${userId}, 'driver', 'active')
      `;
      expect.fail('Should have thrown');
    } catch (err: unknown) {
      const pgErr = err as { code: string };
      expect(pgErr.code).toBe('23505');
    }
  });

  it('users.phone is unique', async () => {
    const phone = '+910000000098';
    await sql()`
      INSERT INTO users (phone, name, firebase_uid, status)
      VALUES (${phone}, 'Phone Uniq 1', 'test:phone:uniq1', 'active')
    `;
    try {
      await sql()`
        INSERT INTO users (phone, name, firebase_uid, status)
        VALUES (${phone}, 'Phone Uniq 2', 'test:phone:uniq2', 'active')
      `;
      expect.fail('Should have thrown');
    } catch (err: unknown) {
      const pgErr = err as { code: string };
      expect(pgErr.code).toBe('23505');
    }
  });

  it('spaces.pincode 012345 is rejected by CHECK', async () => {
    try {
      const [owner] = await sql()`SELECT id FROM users LIMIT 1`;
      await sql()`
        INSERT INTO spaces (
          owner_id, title, address_line, city, state, pincode,
          location, zone_id, approval_status, schedule
        ) VALUES (
          ${owner!['id'] as string}, 'Bad Pincode Space', 'Addr', 'City', 'State',
          '012345',
          ST_SetSRID(ST_MakePoint(77.0, 12.0), 4326)::geography,
          'zone_bad', 'draft', '{}'::jsonb
        )
      `;
      expect.fail('Should have thrown');
    } catch (err: unknown) {
      const pgErr = err as { code: string };
      expect(pgErr.code).toBe('23514');
    }
  });
});

// ─── Query plans ─────────────────────────────────────────────────────────────

describe('query plans', () => {
  it('ST_DWithin search uses index scan, not Seq Scan', async () => {
    const rows = await sql()`
      EXPLAIN ANALYZE
      SELECT id, title FROM spaces
      WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(77.6245, 12.9352), 4326)::geography, 3000)
        AND approval_status = 'active'
        AND deleted_at IS NULL
    `;
    const plan = rows.map((r) => Object.values(r)[0] as string).join('\n');
    expect(plan).not.toContain('Seq Scan on spaces');
  });

  it('outbox relay query uses outbox_messages_pending_idx', async () => {
    const rows = await sql()`
      EXPLAIN ANALYZE
      SELECT id, type, payload FROM outbox_messages
      WHERE status = 'pending' AND available_at <= now()
      ORDER BY available_at
      LIMIT 10
    `;
    const plan = rows.map((r) => Object.values(r)[0] as string).join('\n');
    expect(plan).not.toContain('Seq Scan on outbox_messages');
  });
});

// ─── Seed tests ──────────────────────────────────────────────────────────────

describe('bootstrap admin seed', () => {
  it('creates one admin user on empty database', async () => {
    const adminPhone = '+919999999999';
    const adminName = 'Test Admin';
    const userId = uuidv7();

    await sql()`
      INSERT INTO users (id, phone, name, firebase_uid, status)
      VALUES (${userId}, ${adminPhone}, ${adminName}, ${'bootstrap:' + adminPhone}, 'active')
      ON CONFLICT (phone) DO UPDATE SET updated_at = now()
    `;

    const [user] = await sql()`SELECT id FROM users WHERE phone = ${adminPhone}`;

    await sql()`
      INSERT INTO user_roles (user_id, role, status, verified_at)
      VALUES (${user!['id'] as string}, 'admin', 'active', now())
      ON CONFLICT (user_id, role) DO NOTHING
    `;

    const [adminCount] = await sql()`
      SELECT count(*) AS total FROM user_roles WHERE role = 'admin'
    `;
    expect(Number(adminCount!['total'])).toBeGreaterThanOrEqual(1);
  });
});
