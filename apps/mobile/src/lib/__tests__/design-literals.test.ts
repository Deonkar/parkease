import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Scans for design values typed where they are used instead of read from
 * `@parkease/tokens`. A literal in one file and a token in the next is two
 * screens disagreeing about what "dimmed" or "a chip" looks like.
 */
const root = process.cwd();
const uiNative = join(root, '..', '..', 'packages', 'ui-native', 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === '__tests__' ? [] : walk(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

const sources = [...walk(join(root, 'app')), ...walk(join(root, 'src')), ...walk(uiNative)];
const label = (file: string) => relative(root, file);

describe('design literals', () => {
  it('finds the sources it scans', () => {
    expect(sources.length).toBeGreaterThan(100);
  });

  it('reads every opacity from the opacity token (S-37)', () => {
    const offenders = sources.filter((file) => /opacity:\s*0\.\d/.test(readFileSync(file, 'utf8')));
    expect(offenders.map(label)).toEqual([]);
  });

  it('rounds every chip, pill and badge with radius.chip, never radius.sm (S-118)', () => {
    // A style whose name says chip, pill or badge, holding `radius.sm` before its closing brace.
    const chipWithSm = /\b\w*(chip|Chip|pill|Pill|badge|Badge)\w*:\s*\{[^}]*radius\.sm\b/;
    const offenders = sources.filter((file) => chipWithSm.test(readFileSync(file, 'utf8')));
    expect(offenders.map(label)).toEqual([]);
  });

  describe('icon sizes on the washer surface and in ui-native (S-79)', () => {
    // The surface the row named; other roles move to `iconSize` as their screens are next touched.
    const scoped = sources.filter(
      (file) =>
        file.startsWith(uiNative) ||
        file.includes(join('app', '(washer)')) ||
        file.includes(join('features', 'washer')) ||
        file.endsWith('RefreshNotice.tsx'),
    );

    it('covers the washer screens, components and ui-native', () => {
      expect(scoped.some((file) => file.endsWith(join('(washer)', 'offers.tsx')))).toBe(true);
      expect(scoped.some((file) => file.endsWith('EvidencePair.tsx'))).toBe(true);
      expect(scoped.some((file) => file.endsWith('EmptyState.tsx'))).toBe(true);
    });

    it.each(scoped.map(label))('%s sizes its icons from iconSize', (file) => {
      expect(readFileSync(join(root, file), 'utf8')).not.toMatch(/\bsize=\{\s*\d+\s*\}/);
    });

    it.each(scoped.map(label))('%s types no 52 for a primary action', (file) => {
      // touchTarget + spacing.xs, not a number the touch-target scan cannot see.
      expect(readFileSync(join(root, file), 'utf8')).not.toMatch(/\b(minHeight|height):\s*52\b/);
    });

    it('draws the empty and error states from layout.state, not literals', () => {
      const empty = readFileSync(join(uiNative, 'EmptyState.tsx'), 'utf8');
      const error = readFileSync(join(uiNative, 'ErrorState.tsx'), 'utf8');
      expect(empty).toContain('layout.state.illustration');
      expect(error).toContain('layout.state.badge');
      expect(`${empty}\n${error}`).not.toMatch(/\b(width|height|borderRadius|lineHeight):\s*\d+/);
    });
  });
});
