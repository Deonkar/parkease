import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Wiring guards for the earnings screen, for the reason `offers-wiring.test.ts`
 * gives: the line, the summary and the tabs are rendered in their own tests,
 * and the populated screen needs a live API and a device to reach, so these
 * read the caller.
 */
const screen = readFileSync(join(process.cwd(), 'app', '(washer)', 'earnings.tsx'), 'utf8');
/** The source without its comments, which are allowed to say why. */
const code = screen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('the earnings screen', () => {
  it('drives the query from the selected tab, defaulting to the week a partner is paid on', () => {
    expect(code).toMatch(/useState<WasherEarningsPeriod>\('week'\)/);
    expect(code).toContain('useWasherEarnings(period)');
    expect(code).toMatch(
      /<PeriodTabs[\s\S]{0,120}value=\{period\}[\s\S]{0,120}onChange=\{setPeriod\}/,
    );
  });

  it('chooses its state in the shared place, with a skeleton and a retrying error', () => {
    expect(code).toContain('resolveScreenState(earnings)');
    expect(code).toContain('<Skeleton');
    expect(code).not.toMatch(/ActivityIndicator/);
    expect(code).toMatch(/<ErrorState[\s\S]{0,300}earnings\.refetch\(\)/);
  });

  it('says a failed refresh without hiding the figures (ruling T7-I2)', () => {
    expect(code).toMatch(
      /earnings\.isError[\s\S]{0,300}<RefreshNotice[\s\S]{0,300}earnings\.refetch\(\)/,
    );
  });

  it('lists the lines in a FlashList of EarningsLine, with the summary above them', () => {
    expect(code).toContain('<FlashList');
    expect(code).not.toContain('FlatList');
    expect(code).toContain('<EarningsLine');
    expect(code).toMatch(/ListHeaderComponent[\s\S]{0,300}<EarningsSummary/);
  });

  it('names the period in the empty state and keeps the summary on screen', () => {
    expect(code).toMatch(/ListEmptyComponent/);
    expect(code).toContain('PERIOD_LABELS[period].empty');
  });

  it('renders the summary, and so its caption, whether or not there are lines (T9-I1)', () => {
    // FlashList renders the header above an empty list too; the summary must
    // not sit behind a condition on the lines on its way there.
    const header = /ListHeaderComponent=\{([\s\S]*?)<EarningsSummary/.exec(code)?.[1] ?? null;
    expect(header).not.toBeNull();
    expect(header).not.toMatch(/lines|\?|&&/);
  });

  it('hands the summary the server response, never a figure of its own', () => {
    expect(code).toMatch(/summary=\{view\.summary\}/);
    expect(code).not.toMatch(/Paise\s*[-+*/]|[-+*/]\s*[\w.]*Paise\b/);
    expect(code).not.toMatch(/reduce\(/);
  });

  it('draws no sparkline: sizing daily bars would sum paise in the client (spec §4.3)', () => {
    expect(code).not.toMatch(/sparkline|groupBy|byDay/i);
  });

  it('is no longer the placeholder', () => {
    expect(screen).not.toContain('Your earnings breakdown and payout history will appear here');
  });
});
