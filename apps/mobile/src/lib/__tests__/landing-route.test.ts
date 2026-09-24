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

describe('role-group redirects', () => {
  // A bare `/(${role})` href only resolves for a group with an index.tsx; every
  // landing goes through landingRouteFor so a new role cannot reintroduce it.
  const BARE_GROUP_HREF = /`\/\(\$\{/;

  it('app/index.tsx and AuthContext go through landingRouteFor', () => {
    for (const file of [
      join(APP_DIR, 'index.tsx'),
      join(process.cwd(), 'src', 'contexts', 'AuthContext.tsx'),
    ]) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(BARE_GROUP_HREF);
      expect(source, file).toMatch(/landingRouteFor\(/);
    }
  });

  it('no file under app/ or src/ builds a bare /(${...}) href', () => {
    const offenders = [...sourceFiles(APP_DIR), ...sourceFiles(join(process.cwd(), 'src'))].filter(
      (file) => BARE_GROUP_HREF.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
