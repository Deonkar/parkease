import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { outboxRoute } from '../src/queues.js';

/**
 * Every outbox message type the API or worker can enqueue must be a job (a queue with a handler)
 * or a known event — anything else the relay fails, loudly, and S-104 showed that a missing queue
 * otherwise loses messages without a word. Scans source rather than trusting a hand-kept list:
 * the three `space.*` events that slipped past the first fix were emitted through ternaries.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SOURCES = [join(ROOT, 'api', 'src'), join(ROOT, 'worker', 'src')];

const tsFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });

/** The `type:` expression of each `.enqueue(` call: the first `type:` within its next 4 lines. */
const enqueuedTypes = (): { literals: string[]; identifiers: string[] } => {
  const literals: string[] = [];
  const identifiers: string[] = [];
  for (const file of SOURCES.flatMap(tsFiles)) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!line.includes('.enqueue(')) return;
      const typeLine = lines.slice(i, i + 5).find((l) => /^\s*type:/.test(l));
      if (typeLine === undefined) return;
      const expr = typeLine.replace(/^\s*type:\s*/, '');
      literals.push(...[...expr.matchAll(/'([^']+)'/g)].map((m) => m[1] ?? ''));
      if (!expr.includes("'")) identifiers.push(expr.replace(/,\s*$/, '').trim());
    });
  }
  return { literals, identifiers };
};

describe('outbox message types (S-104)', () => {
  const { literals, identifiers } = enqueuedTypes();

  it('finds the enqueue calls it is meant to guard', () => {
    expect(literals.length).toBeGreaterThan(20);
  });

  it('routes every literal type as a job or a known event, never unknown', () => {
    const unknown = [...new Set(literals)].filter((type) => outboxRoute(type) === 'unknown');
    expect(unknown).toEqual([]);
  });

  it('uses only job-name constants that queues.ts itself imports', () => {
    const queuesSource = readFileSync(join(ROOT, 'worker', 'src', 'queues.ts'), 'utf8');
    const missing = [...new Set(identifiers)].filter((name) => !queuesSource.includes(name));
    expect(missing).toEqual([]);
  });
});
