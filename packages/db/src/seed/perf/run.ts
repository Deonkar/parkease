import process from 'node:process';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../../schema/index.js';

import { seedPerfSpaces, type SeedPerfOptions } from './index.js';

function getDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  return url;
}

function optionalNumber(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number, got: ${raw}`);
  return parsed;
}

async function main(): Promise<void> {
  const sql = postgres(getDatabaseUrl());
  const db = drizzle(sql, { schema });

  try {
    const options: SeedPerfOptions = {};
    const count = optionalNumber('PERF_SEED_COUNT');
    const seed = optionalNumber('PERF_SEED_SEED');
    if (count !== undefined) options.count = count;
    if (seed !== undefined) options.seed = seed;

    const startedAt = Date.now();
    const result = await seedPerfSpaces(db, options);
    const elapsedMs = Date.now() - startedAt;

    // eslint-disable-next-line no-console -- seed script output
    console.info(
      `seed-perf: seeded ${String(result.spaceIds.length)} spaces and ` +
        `${String(result.bookingSlotCount)} booking_slots in ${String(elapsedMs)}ms`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console -- top-level error reporting
  console.error('seed-perf failed:', err);
  process.exit(1);
});
