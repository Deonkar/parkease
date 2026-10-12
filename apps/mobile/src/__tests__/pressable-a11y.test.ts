import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * R-FE-12 (S-157): every touchable says what it is and what it does to a screen reader. A
 * `Pressable` (or `TouchableOpacity`) needs `accessibilityRole` and `accessibilityLabel`, or a
 * spread that forwards them from a wrapper's own props. Parsed, not grepped, so a multi-line
 * element or a nested one is judged on its own attributes.
 */
const ROOT = join(__dirname, '..', '..');
const DIRS = ['app', 'src'];
const TOUCHABLES = new Set(['Pressable', 'TouchableOpacity', 'TouchableHighlight']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === '__tests__' || name === 'node_modules' ? [] : sourceFiles(path);
    }
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

interface Miss {
  readonly where: string;
  readonly missing: string[];
}

function missesIn(path: string): Miss[] {
  const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const misses: Miss[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(file);
      if (TOUCHABLES.has(tag)) {
        const props = node.attributes.properties;
        const spreads = props.some((p) => ts.isJsxSpreadAttribute(p));
        const names = new Set(props.filter(ts.isJsxAttribute).map((p) => p.name.getText(file)));
        const missing = ['accessibilityRole', 'accessibilityLabel'].filter((n) => !names.has(n));
        // `accessible={false}` takes the element out of the screen reader's order on purpose (a
        // sheet's scrim, which Back and the sheet's own button also dismiss).
        const hidden = props.some(
          (p) =>
            ts.isJsxAttribute(p) &&
            p.name.getText(file) === 'accessible' &&
            p.initializer?.getText(file) === '{false}',
        );
        if (missing.length > 0 && !spreads && !hidden) {
          const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
          misses.push({ where: `${relative(ROOT, path)}:${String(line + 1)}`, missing });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return misses;
}

describe('every touchable is labelled for a screen reader (R-FE-12)', () => {
  it('has accessibilityRole and accessibilityLabel on every Pressable', () => {
    const misses = DIRS.flatMap((d) => sourceFiles(join(ROOT, d))).flatMap(missesIn);
    expect(misses).toEqual([]);
  });
});
