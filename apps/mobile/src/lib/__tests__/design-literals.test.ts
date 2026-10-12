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
});
