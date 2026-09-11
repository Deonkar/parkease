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

export async function runMigrations(sql: postgres.Sql): Promise<void> {
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
