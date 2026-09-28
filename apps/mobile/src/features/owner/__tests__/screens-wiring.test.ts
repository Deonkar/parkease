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

  it('dashboard shows the date and greeting header even with no spaces yet (M6)', () => {
    expect(dashboard.match(/header\(data\.greetingName\)/g)?.length).toBe(2);
  });

  it('dashboard keeps the scanner, and See all goes to earnings', () => {
    expect(dashboard).toContain("router.push('/(owner)/scan')");
    expect(dashboard).toContain("router.push('/(owner)/earnings')");
  });

  it('earnings: has an unconditional page title above the tabs (M2)', () => {
    expect(earnings).toMatch(/accessibilityRole="header"[\s\S]{0,50}Earnings/);
    expect(earnings).toContain('Your share, after the ParkEase fee');
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

  it('listing detail warns when a space has more bookings than the group shows (M9)', () => {
    expect(listing).toContain('query.data.meta.hasMore');
    expect(listing).toContain(
      'Showing the first 20. More bookings on this space aren&apos;t listed here yet.',
    );
  });

  it('listing detail keeps cached bookings on screen through a transient refetch failure (F8, R-FAIL-01)', () => {
    // Who is parked right now must not vanish just because the latest
    // background refetch failed — only the absence of any cached data at
    // all may block the group behind the full retry link.
    expect(listing).toMatch(/query\.isError && query\.data === undefined/);
    expect(listing).toContain("Couldn't refresh. Tap to retry.");
  });

  it('no screen does arithmetic on paise or names a rate (R-FE-06)', () => {
    for (const source of [dashboard, earnings, listing]) {
      expect(source).not.toMatch(/0\.15|PLATFORM_COMMISSION|Paise\s*[-+*/]\s*\w/);
    }
  });
});
