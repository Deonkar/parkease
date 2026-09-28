import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * R-FE-06 at the source, over the WHOLE owner feature folder, not just the
 * screens `screens-wiring.test.ts` already covers (M11) — mirrors the
 * washer's `earnings-arithmetic.test.tsx` guard: a `-`, `+`, `*` or `/`
 * against a paise value, or the 15% commission rate in any form, is the
 * start of a client-side money figure wherever it appears, whatever it
 * renders. `domains/pricing` on the server is the only place that produces
 * a money amount.
 */

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const read = (relativePath: string) =>
  stripComments(readFileSync(join(process.cwd(), ...relativePath.split('/')), 'utf8'));

const OWNER_SOURCE_FILES: readonly string[] = [
  'src/features/owner/api/check-in.ts',
  'src/features/owner/api/dev-fixtures.ts',
  'src/features/owner/api/owner.ts',
  'src/features/owner/api/spaces.ts',
  'src/features/owner/components/EarningsBars.tsx',
  'src/features/owner/components/KpiCard.tsx',
  'src/features/owner/components/ListingCard.tsx',
  'src/features/owner/components/StatementLine.tsx',
  'src/features/owner/dev-mock.ts',
  'src/features/owner/greeting.ts',
  'src/features/owner/hooks/useCreateSpace.ts',
  'src/features/owner/hooks/useMyListings.ts',
  'src/features/owner/hooks/useOwnerQueries.ts',
  'src/features/owner/hooks/useSpaceDetail.ts',
  'src/features/owner/hooks/useToggleSpace.ts',
  'src/features/owner/hooks/useUpdateSpace.ts',
];

const OWNER_SCREEN_FILES: readonly string[] = [
  'app/(owner)/index.tsx',
  'app/(owner)/earnings/index.tsx',
  'app/(owner)/listings/[id].tsx',
];

/**
 * The one allowed exception: `EarningsBars`' bar height is a DISPLAY ratio of
 * two server-sent totals (a fraction of the tallest bar, in pixels) — it
 * never produces a money figure. Stripped before the arithmetic check so the
 * guard stays exact rather than papering over it with a weaker regex.
 */
const ALLOWED_RATIO = '(day.netPaise / peak)';

describe('no money arithmetic anywhere in the owner feature (M11)', () => {
  it.each([...OWNER_SOURCE_FILES, ...OWNER_SCREEN_FILES])('%s', (path: string) => {
    const source = read(path);
    const checked = source.includes(ALLOWED_RATIO) ? source.replace(ALLOWED_RATIO, '') : source;

    expect(checked).not.toMatch(/Paise\s*[-+*/]/);
    expect(checked).not.toMatch(/[-+*/]\s*[\w.]*Paise\b/);
    expect(checked).not.toMatch(/0\.15/);
    expect(checked).not.toMatch(/PLATFORM_COMMISSION/);
  });

  it('is actually exercising the whitelist, not silently matching nothing', () => {
    const bars = read('src/features/owner/components/EarningsBars.tsx');
    expect(bars).toContain(ALLOWED_RATIO);
  });
});
