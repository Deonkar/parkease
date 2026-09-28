import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Wiring guards for the owner screens, for the reason the washer's give: the
 * pieces are rendered in their own tests, and the populated screens need a
 * live API and a device, so these read the callers.
 */
const read = (...path: string[]) =>
  readFileSync(join(process.cwd(), 'app', '(owner)', ...path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

const dashboard = read('index.tsx');
const earnings = read('earnings', 'index.tsx');
const listing = read('listings', '[id].tsx');

describe('owner screens', () => {
  it('dashboard: shared state resolution, skeleton, retrying error, empty', () => {
    expect(dashboard).toContain('resolveScreenState(dashboard)');
    expect(dashboard).toContain('<Skeleton');
    expect(dashboard).toMatch(/<ErrorState[\s\S]{0,300}dashboard\.refetch\(\)/);
    expect(dashboard).toContain('<EmptyState');
    expect(dashboard).not.toMatch(/ActivityIndicator/);
  });

  it('dashboard keeps the scanner, and See all goes to earnings', () => {
    expect(dashboard).toContain("router.push('/(owner)/scan')");
    expect(dashboard).toContain("router.push('/(owner)/earnings')");
  });

  it('earnings: period tabs drive both queries; transactions in a FlashList with paging', () => {
    expect(earnings).toMatch(/useState<OwnerEarningsPeriod>\('month'\)/);
    expect(earnings).toContain('useOwnerEarnings(period)');
    expect(earnings).toContain('useOwnerTransactions(period)');
    expect(earnings).toContain('<FlashList');
    expect(earnings).toContain('fetchNextPage');
    expect(earnings).toMatch(/<ErrorState[\s\S]{0,300}refetch\(\)/);
  });

  it('listing detail shows active and upcoming bookings', () => {
    expect(listing).toContain("useSpaceBookings(id, 'active')");
    expect(listing).toContain("useSpaceBookings(id, 'upcoming')");
  });

  it('no screen does arithmetic on paise or names a rate (R-FE-06)', () => {
    for (const source of [dashboard, earnings, listing]) {
      expect(source).not.toMatch(/0\.15|PLATFORM_COMMISSION|Paise\s*[-+*/]\s*\w/);
    }
  });
});
