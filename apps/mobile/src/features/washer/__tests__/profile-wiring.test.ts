import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Wiring guards for the profile and registration routes, for the reason
 * `offers-wiring.test.ts` gives: the forms, the hooks and the state choice are
 * unit-tested, and the screens need a live API and a device to reach — so these
 * read the callers.
 */
const app = join(process.cwd(), 'app', '(washer)');
const read = (...parts: string[]) => readFileSync(join(app, ...parts), 'utf8');
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('the washer route structure', () => {
  it('replaces the flat profile screen with a stack', () => {
    expect(existsSync(join(app, 'profile.tsx'))).toBe(false);
    expect(read('profile', '_layout.tsx')).toContain('<Stack');
    expect(existsSync(join(app, 'profile', 'index.tsx'))).toBe(true);
    expect(existsSync(join(app, 'profile', 'register.tsx'))).toBe(true);
  });

  it('keeps the bar at the four tabs of §14.3, with profile routable but hidden', () => {
    const layout = code(read('_layout.tsx'));

    expect(layout).toMatch(/name="profile"\s+options=\{\{\s*href: null\s*\}\}/);
    const titled = [...layout.matchAll(/title: '([^']+)'/g)].map((m) => m[1]);
    expect(titled).toEqual(['Offers', 'Active', 'Menu', 'Earnings']);
    expect(layout).toContain('<WasherPresenceProvider>');
  });

  it('reaches the profile from a header gear on offers and on the menu', () => {
    for (const screen of ['offers.tsx', 'menu.tsx']) {
      expect(code(read(screen)), screen).toContain('<ProfileGear');
    }
  });
});

describe('the profile screen', () => {
  const screen = read('profile', 'index.tsx');

  it('chooses its state in one place, with set-up as a state and not an error', () => {
    expect(screen).toContain('useWasherProfile()');
    expect(screen).toContain('profileScreenState(profile)');
    expect(screen).toMatch(/case 'unregistered'[\s\S]{0,600}profile\/register/);
  });

  it('retries a real failure from its error state', () => {
    expect(screen).toMatch(/<ErrorState[\s\S]{0,300}profile\.refetch\(\)/);
  });

  it('draws the verification banner from the washer copy', () => {
    expect(screen).toContain('describeWasherVerification(');
    expect(screen).toContain('<VerificationNotice');
  });

  it('offers an upload for a missing ID, through the held-upload hook and one intent', () => {
    expect(screen).toContain("useHeldUploads('documents', 1)");
    expect(screen).toContain('sendDocument(');
  });

  it('keeps Switch Role, Settings and Sign Out', () => {
    expect(screen).toContain("router.push('/(shared)/switch-role')");
    expect(screen).toContain("router.push('/(shared)/settings')");
    expect(screen).toContain('auth.signOut()');
  });
});

describe('the registration screen', () => {
  const screen = read('profile', 'register.tsx');

  it('picks a partner type first, then one of the two forms', () => {
    expect(screen).toContain('<PartnerTypePicker');
    expect(screen).toContain('<BusinessForm');
    expect(screen).toContain('<GigForm');
  });

  it('uploads business photos to spaces and the ID to documents', () => {
    expect(screen).toContain("useHeldUploads('spaces'");
    expect(screen).toContain("useHeldUploads('documents', 1)");
  });

  /**
   * `dismissTo`, not `push`: the profile is already beneath registration in its
   * stack, and pushing a second copy would put the form one Back away.
   */
  it('lands on the profile after registering — never back through registration', () => {
    expect(screen).toContain('useRegistration()');
    expect(screen).toMatch(/router\.dismissTo\(\{[\s\S]{0,120}pathname: '\/\(washer\)\/profile'/);
    expect(read('profile', '_layout.tsx')).toMatch(/initialRouteName: 'index'/);
  });

  it('never asks for a number off an ID', () => {
    expect(code(screen)).not.toMatch(/aadhaar/i);
  });
});

describe('R-FE-06 in the registration code', () => {
  // Assembled from parts so this file does not itself trip the R-FE-06 grep
  // over `features/washer`.
  const rates = new RegExp(['0\\.2', 'CARWASH_' + 'COMMISSION', 'GST_' + 'RATE'].join('|'));

  it('computes no price and names no rate', () => {
    for (const file of [read('profile', 'index.tsx'), read('profile', 'register.tsx')]) {
      expect(code(file)).not.toMatch(rates);
    }
  });
});
