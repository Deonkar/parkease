import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * M3: Material's minimum touch target is 48dp, and CLAUDE.md prefers Material
 * where it conflicts with HIG. The size lives in ONE token, `touchTarget`, so
 * no washer control is 44 on one screen and 48 on the next. A literal 44 or 48
 * as a size, or a local constant standing in for the token, fails here.
 */
const root = process.cwd();
const sources = [
  ...readdirSync(join(root, 'src', 'features', 'washer', 'components')).map((file) =>
    join('src', 'features', 'washer', 'components', file),
  ),
  join('app', '(washer)', 'active', 'index.tsx'),
  join('app', '(washer)', 'offers.tsx'),
  join('app', '(washer)', 'menu.tsx'),
  join('app', '(washer)', 'earnings.tsx'),
  join('app', '(washer)', 'profile', 'index.tsx'),
  join('app', '(washer)', 'profile', 'register.tsx'),
].filter((file) => file.endsWith('.tsx'));

const LITERAL_TARGET = /\b(minHeight|minWidth|width|height):\s*(44|48)\b/;
const LOCAL_CONSTANT = /\bconst\s+(MIN_TARGET|TAB_HEIGHT)\s*=\s*\d+/;

describe('washer touch targets', () => {
  it.each(sources)('%s sizes its targets from the touchTarget token', (file) => {
    const source = readFileSync(join(root, file), 'utf8');

    expect(source).not.toMatch(LITERAL_TARGET);
    expect(source).not.toMatch(LOCAL_CONSTANT);
  });

  it('covers every control the audit named', () => {
    const read = (file: string) => readFileSync(join(root, file), 'utf8');
    const components = join('src', 'features', 'washer', 'components');
    for (const file of [
      'EvidencePair.tsx',
      'PhotoField.tsx',
      'RefreshNotice.tsx',
      'ServiceRow.tsx',
    ]) {
      expect(read(join(components, file)), file).toContain('touchTarget');
    }
    expect(read(join('app', '(washer)', 'active', 'index.tsx'))).toContain('touchTarget');
  });
});
