import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Task 10, "Config is loaded, not compiled in": *No file under `domains/surge/`
 * contains a numeric literal for a rate, tier, or cap other than `NO_SURGE` —
 * asserted by a lint rule and a grep test (R-GEN-05).*
 *
 * The invariant holds today. Nothing was guarding it, which is the only reason
 * this file exists: the whole point of task 10 is that surge configuration is
 * DB-backed and admin-editable, and a rate compiled into the source is a rate
 * that silently stops obeying the admin screen. That failure is invisible — the
 * code runs, the screen saves, and the price just does not change.
 *
 * A grep rather than an ESLint `no-magic-numbers` rule: that rule cannot tell a
 * rate from an array index, so switching it on here would mean an
 * `eslint-disable` on every loop and a suppression habit worth more than the
 * rule. This asserts the narrow thing actually meant.
 */

const SURGE_DIR = join(import.meta.dirname, '..', 'src', 'domains', 'surge');

/**
 * A rate, tier threshold or cap in this codebase is one of two shapes, and this
 * recognises both rather than keeping a list of exempt values.
 *
 * A denylist of harmless numbers was the first attempt and it is a maintenance
 * trap: every future array index or status code added under `domains/surge/`
 * would fail an unrelated suite until someone extended the set.
 *
 * - **Basis points** — every persisted rate here is `bp` (`12_500`, `10_000`),
 *   so any integer of four digits or more is suspect. Nothing legitimate in
 *   this domain is a bare 1000+ literal.
 * - **A decimal** — `0.15`, `1.5`. The codebase does not store rates this way,
 *   which is precisely why one appearing would be worth stopping for. A
 *   magnitude test alone would wave these through, since they are all < 1000.
 *
 * Small integers are left alone: they are offsets, lengths and status codes.
 */
const looksLikeARate = (n: number): boolean => !Number.isInteger(n) || Math.abs(n) >= 1000;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return entry.endsWith('.ts') ? [path] : [];
  });
}

/** Strip comments and string literals — prose and keys are not rates. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

describe('no rate, tier or cap is compiled into domains/surge', () => {
  const files = sourceFiles(SURGE_DIR);

  it('finds the surge domain to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [f.slice(f.indexOf('domains')), f] as const))(
    '%s has no numeric rate literal',
    (_label, path) => {
      const numbers = [...code(readFileSync(path, 'utf8')).matchAll(/\b\d[\d_]*(?:\.\d+)?\b/g)]
        .map((m) => Number(m[0].replace(/_/g, '')))
        .filter(looksLikeARate);

      expect(numbers).toEqual([]);
    },
  );
});
