import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { ROLE_VALUES } from '@parkease/contracts/enums';
import { describe, expect, it } from 'vitest';

import { landingRouteFor } from '../landing-route';

const APP_DIR = join(process.cwd(), 'app');

/**
 * `/(washer)/offers` → `app/(washer)/offers.tsx` or `app/(washer)/offers/index.tsx`.
 * A bare group (`/(driver)`) resolves only through the group's `index.tsx` —
 * which is exactly the file `(valet)` and `(washer)` never had (T11-W1).
 */
function routeFileExists(href: string): boolean {
  const segments = href.replace(/^\//, '').split('/').filter(Boolean);
  const base = join(APP_DIR, ...segments);
  return existsSync(`${base}.tsx`) || existsSync(join(base, 'index.tsx'));
}

describe('landingRouteFor', () => {
  it.each(ROLE_VALUES)('lands %s on a route file that exists under app/', (role) => {
    const href = landingRouteFor(role);
    expect(typeof href).toBe('string');
    expect(routeFileExists(href as string)).toBe(true);
  });

  it('sends a session with no active role to choose-role', () => {
    expect(landingRouteFor(null)).toBe('/(auth)/choose-role');
    expect(routeFileExists(landingRouteFor(null) as string)).toBe(true);
  });

  it('lands the partners on their offers, not on an index their group lacks', () => {
    expect(landingRouteFor('valet')).toBe('/(valet)/offers');
    expect(landingRouteFor('washer')).toBe('/(washer)/offers');
    expect(landingRouteFor('driver')).toBe('/(driver)');
    expect(landingRouteFor('owner')).toBe('/(owner)');
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

/** Route groups that can be reached bare, because they have an index.tsx. */
const GROUPS_WITH_INDEX = new Set(
  readdirSync(APP_DIR)
    .filter((name) => /^\(.+\)$/.test(name) && existsSync(join(APP_DIR, name, 'index.tsx')))
    .map((name) => name.slice(1, -1)),
);

/**
 * Every bare role-group href in a source file that cannot resolve (S-68):
 *
 * - a template literal, `` `/(${role})` ``: which group it names is unknown, so always;
 * - a string literal, `'/(washer)'` or `"/(washer)/"`, for a group with no index.tsx;
 * - a concatenation, `'/(' + role + ')'`: unknown again, so always.
 */
function bareGroupHrefs(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/`\/\(\$\{[^`]*`/g)) found.push(match[0]);
  for (const match of source.matchAll(/(['"])\/\(([a-z-]+)\)\/?\1/g)) {
    if (!GROUPS_WITH_INDEX.has(match[2] ?? '')) found.push(match[0]);
  }
  for (const match of source.matchAll(/(['"])\/\(\1\s*\+/g)) found.push(match[0]);
  return found;
}

describe('the bare-group guard', () => {
  it('knows which groups have an index', () => {
    expect([...GROUPS_WITH_INDEX].sort()).toEqual(['driver', 'owner']);
  });

  it.each([
    ['a template literal', 'router.replace(`/(${role})`);'],
    ['a single-quoted literal', "router.replace('/(washer)');"],
    ['a double-quoted literal with a slash', 'router.replace("/(valet)/");'],
    ['a concatenation', "router.replace('/(' + role + ')');"],
  ])('catches %s', (_form, source) => {
    expect(bareGroupHrefs(source)).toHaveLength(1);
  });

  it('lets a group with an index, and a full route, through', () => {
    expect(bareGroupHrefs("router.replace('/(driver)');")).toEqual([]);
    expect(bareGroupHrefs("router.replace('/(washer)/offers');")).toEqual([]);
    expect(bareGroupHrefs('href="/(owner)/earnings/payouts"')).toEqual([]);
  });
});

describe('role-group redirects', () => {
  // A bare `/(${role})` href only resolves for a group with an index.tsx; every
  // landing goes through landingRouteFor so a new role cannot reintroduce it.
  it('app/index.tsx and AuthContext go through landingRouteFor', () => {
    for (const file of [
      join(APP_DIR, 'index.tsx'),
      join(process.cwd(), 'src', 'contexts', 'AuthContext.tsx'),
    ]) {
      const source = readFileSync(file, 'utf8');
      expect(bareGroupHrefs(source), file).toEqual([]);
      expect(source, file).toMatch(/landingRouteFor(Session)?\(/);
    }
  });

  it('no file under app/ or src/ builds a bare group href that cannot resolve', () => {
    const offenders = [...sourceFiles(APP_DIR), ...sourceFiles(join(process.cwd(), 'src'))].filter(
      (file) => bareGroupHrefs(readFileSync(file, 'utf8')).length > 0,
    );
    expect(offenders).toEqual([]);
  });
});
