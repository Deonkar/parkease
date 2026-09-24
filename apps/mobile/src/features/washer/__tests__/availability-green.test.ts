import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * M5 (impeccable P1, a Wayfinder violation). CLAUDE.md: green `#047857` /
 * `#059669` is AVAILABILITY ONLY, "a slot free right now", never a generic
 * success or done colour. On the washer surface the one thing that means
 * "available right now" is the online rail. Done and attached are cobalt.
 */
const root = process.cwd();
const components = join('src', 'features', 'washer', 'components');
const files = [
  ...readdirSync(join(root, components)).map((file) => join(components, file)),
  ...[
    'offers.tsx',
    'menu.tsx',
    'earnings.tsx',
    join('active', 'index.tsx'),
    join('profile', 'index.tsx'),
  ].map((file) => join('app', '(washer)', file)),
];

const GREEN =
  /colors\.(available|availableVivid|availableSoft|availableInk|success|successLight)\b/;

describe('availability green on the washer surface', () => {
  it.each(files.filter((file) => !file.endsWith('OnlineRail.tsx')))(
    '%s never spends it on done or attached',
    (file) => {
      expect(readFileSync(join(root, file), 'utf8')).not.toMatch(GREEN);
    },
  );

  it('keeps it on the online rail, where it means available right now', () => {
    expect(readFileSync(join(root, components, 'OnlineRail.tsx'), 'utf8')).toMatch(GREEN);
  });
});
