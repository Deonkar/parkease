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

  it('earnings: keeps the period tabs mounted through loading, error and ready (fix round 1)', () => {
    // The tab bar must render from the screen's own top-level return, right
    // beside the loading/error/ready content — not only from inside
    // `ListHeaderComponent`, which the loading and error branches never reach.
    // A tab bar wired only into the FlashList header vanishes the moment a tap
    // lands on a period with no cached data, because that branch returns a
    // bare skeleton and never mounts the header at all.
    expect(earnings).toMatch(/(<PeriodTabs|\{tabs\})[\s\S]{0,400}\{content\(\)\}/);
  });

  it('earnings: a failed transaction refresh or next page never goes silent (R-FAIL-01, fix round 1)', () => {
    // Pages already on screen must not swallow a failed background refetch,
    // pull, or next-page fetch just because `ListEmptyComponent` only fires
    // when there are zero rows.
    expect(earnings).toMatch(/transactions\.isError[\s\S]{0,300}transactions-refresh-notice/);
    expect(earnings).toContain('Refresh your transactions');
    expect(earnings).toContain('isFetchNextPageError');
    expect(earnings).toMatch(/isFetchNextPageError[\s\S]{0,300}fetchNextPage\(\)/);
    // The Payouts row stays in the footer alongside the new retry state.
    expect(earnings).toContain("router.push('/(owner)/earnings/payouts')");
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
