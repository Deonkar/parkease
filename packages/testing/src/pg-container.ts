import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'db', 'migrations');

export interface PgTestContext {
  container: StartedTestContainer;
  sql: postgres.Sql;
  connectionString: string;
}

export async function startPgContainer(): Promise<PgTestContext> {
  const container = await new GenericContainer('postgis/postgis:18-3.6')
    .withEnvironment({
      POSTGRES_USER: 'parkease',
      POSTGRES_PASSWORD: 'test',
      POSTGRES_DB: 'parkease_test',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const connectionString = `postgresql://parkease:test@${host}:${String(port)}/parkease_test`;
  const sql = postgres(connectionString, { max: 5 });

  return { container, sql, connectionString };
}

/**
 * Apply every migration to a fresh container.
 *
 * Pass a connection string, not the shared pool. Several migration files hold
 * more than one statement, and Postgres wraps a multi-statement simple query in
 * an implicit transaction; postgres.js then refuses it on a pooled connection
 * with `UNSAFE_TRANSACTION: Only use sql.begin, sql.reserved or max: 1`, because
 * a pooled connection could be handed to another caller mid-transaction. So
 * migrations get their own `max: 1` connection — the same reason src/migrate.ts
 * uses `max: 1` — while the test pool stays multi-connection for the tests that
 * genuinely need concurrency, such as booking-concurrency.
 *
 * A `postgres.Sql` is still accepted for callers that already hold a `max: 1`
 * handle.
 */
export async function runMigrations(target: postgres.Sql | string): Promise<void> {
  const ownsConnection = typeof target === 'string';
  const sql = ownsConnection ? postgres(target, { max: 1 }) : target;

  try {
    await applyMigrations(sql);
  } finally {
    if (ownsConnection) await sql.end();
  }
}

async function applyMigrations(sql: postgres.Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id serial PRIMARY KEY,
      hash text NOT NULL,
      tag text NOT NULL UNIQUE,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const applied = await sql<{ tag: string }[]>`
    SELECT tag FROM __drizzle_migrations ORDER BY id
  `;
  const appliedSet = new Set(applied.map((r) => r.tag));

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql') && !f.startsWith('.'))
    .sort();

  for (const file of files) {
    const tag = file.replace('.sql', '');
    if (appliedSet.has(tag)) continue;

    const content = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
    await sql.unsafe(content);
    await sql`
      INSERT INTO __drizzle_migrations (hash, tag)
      VALUES (${tag}, ${tag})
    `;
  }
}

export async function stopPgContainer(ctx: PgTestContext): Promise<void> {
  await ctx.sql.end();
  await ctx.container.stop();
}
