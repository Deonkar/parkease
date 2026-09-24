import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * I1: every `switch` over a union in these screens and components ends in
 * `default: return assertNever(x)`, so a union member that gains no `case`
 * fails typecheck at the switch instead of rendering nothing at runtime.
 *
 * The lint rule that would enforce this repo-wide
 * (`@typescript-eslint/switch-exhaustiveness-check`) touches every role and is
 * a suggestedtask.md row; this pins the washer files the fix wave named.
 */
const FILES = [
  ['app', '(washer)', 'active', 'index.tsx'],
  ['app', '(washer)', 'earnings.tsx'],
  ['app', '(washer)', 'menu.tsx'],
  ['app', '(washer)', 'offers.tsx'],
  ['app', '(washer)', 'profile', 'index.tsx'],
  ['app', '(washer)', 'profile', 'register.tsx'],
  ['src', 'features', 'washer', 'components', 'EvidencePair.tsx'],
  ['src', 'features', 'washer', 'verification-copy.ts'],
];

describe.each(FILES.map((path) => [path.join('/'), path] as const))('%s', (_name, path) => {
  const source = readFileSync(join(process.cwd(), ...path), 'utf8');

  it('ends every switch in default: assertNever', () => {
    const switches = source.match(/\bswitch \(/g) ?? [];
    const guarded = source.match(/default:\s*(?:return )?assertNever\(/g) ?? [];

    expect(switches.length).toBeGreaterThan(0);
    expect(guarded.length).toBe(switches.length);
    expect(source).toContain("from '@/lib/assert-never'");
  });
});
