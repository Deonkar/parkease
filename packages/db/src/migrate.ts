import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

function getDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  return url;
}

export async function migrate(): Promise<void> {
  const sql = postgres(getDatabaseUrl(), { max: 1 });

  try {
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
      // eslint-disable-next-line no-console -- migration runner output
      console.info(`Applying migration: ${file}`);
      await sql.unsafe(content);
      await sql`
        INSERT INTO __drizzle_migrations (hash, tag)
        VALUES (${tag}, ${tag})
      `;
    }

    // eslint-disable-next-line no-console -- migration runner output
    console.info('All migrations applied.');
  } finally {
    await sql.end();
  }
}

const isMain = process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js');
if (isMain) {
  migrate().catch((err: unknown) => {
    // eslint-disable-next-line no-console -- top-level error reporting
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
