import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const SCANNED = ['app', 'components', 'lib', 'content'];
const EXTENSIONS = /\.(tsx?|css|mdx)$/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : EXTENSIONS.test(name) ? [path] : [];
  });
}

/**
 * Task 20 "Tokens": no hardcoded colour outside @parkease/tokens. A hex literal, rgb() or hsl()
 * anywhere in the site's source fails, so a colour can only arrive through webColors.
 */
describe('colours come from @parkease/tokens', () => {
  const sources = SCANNED.flatMap((dir) => files(join(ROOT, dir)));

  it('scans the site source', () => {
    expect(sources.length).toBeGreaterThan(40);
  });

  it.each(sources.map((path) => [relative(ROOT, path), path]))(
    '%s has no colour literal',
    (_, path) => {
      const source = readFileSync(path, 'utf8');
      const literals =
        source.match(/(?<![\w&/-])#[0-9a-fA-F]{3,8}\b|(?<![a-zA-Z])(?:rgba?|hsla?)\(/g) ?? [];
      expect(literals).toEqual([]);
    },
  );
});
