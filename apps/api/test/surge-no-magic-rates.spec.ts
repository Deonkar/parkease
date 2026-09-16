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
 * Numbers that cannot express a rate, a tier threshold or a cap.
 *
 * `0` and `1` are the usual exemptions (R-GEN-05 names them). Small integers
 * are array and string offsets. HTTP status codes are not rates. Anything that
 * looks like basis points — four or five digits — is exactly what this test is
 * hunting, so nothing in that range is exempt.
 */
const HARMLESS = new Set([0, 1, 2, 3, 100, 200, 201, 204, 400, 403, 404, 409, 500]);

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
        .filter((n) => !HARMLESS.has(n));

      expect(numbers).toEqual([]);
    },
  );
});
