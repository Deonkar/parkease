import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Wiring for the chrome every washer screen shares (M6, M7, M13). The header,
 * the account button and the readable column are unit-tested; these read the
 * screens that must use them.
 */
const app = join(process.cwd(), 'app', '(washer)');
const read = (...parts: string[]) => readFileSync(join(app, ...parts), 'utf8');
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const TABS = [
  { file: ['offers.tsx'], title: 'Offers' },
  { file: ['active', 'index.tsx'], title: 'Active' },
  { file: ['menu.tsx'], title: 'Menu' },
  { file: ['earnings.tsx'], title: 'Earnings' },
] as const;

describe('the washer tab screens', () => {
  it('name their header exactly as the tab bar names the tab (M13)', () => {
    const layout = code(read('_layout.tsx'));
    const tabTitles = [...layout.matchAll(/title: '([^']+)'/g)].map((m) => m[1]);
    expect(tabTitles).toEqual(TABS.map((tab) => tab.title));

    for (const tab of TABS) {
      const titles = [
        ...code(read(...tab.file)).matchAll(/<WasherHeader[^>]*?title="([^"]+)"/g),
      ].map((m) => m[1]);
      expect(titles.length, tab.title).toBeGreaterThan(0);
      expect(new Set(titles), tab.title).toEqual(new Set([tab.title]));
    }
  });

  it('carry the account button through the one header, never a hand-built one (M13)', () => {
    for (const tab of TABS) {
      const source = code(read(...tab.file));
      expect(source, tab.title).not.toMatch(/account=\{false\}/);
      expect(source, tab.title).not.toContain('ProfileGear');
      expect(source, tab.title).not.toContain('<AccountButton');
    }
  });

  it('put their content in the readable column (M6)', () => {
    for (const tab of TABS) {
      expect(code(read(...tab.file)), tab.title).toContain('<ReadableColumn');
    }
  });
});

describe('the profile screen', () => {
  const screen = code(read('profile', 'index.tsx'));

  it('uses the same header, at the same scale, without an account button to itself (M7)', () => {
    expect(screen).toMatch(/<WasherHeader\s+title="Profile"\s+account=\{false\}/);
    expect(screen).not.toMatch(/fontSize\['2xl'\]/);
  });

  it('keeps its content in the readable column (M6)', () => {
    expect(screen).toMatch(/maxWidth:\s*layout\.contentMaxWidth|<ReadableColumn/);
  });
});

/** M13: copy and consistency on the washer screens. */
describe('washer copy and consistency (M13)', () => {
  const screens = [...TABS.map((tab) => tab.file), ['profile', 'index.tsx']] as const;

  it('sizes every skeleton from the tokens', () => {
    for (const file of screens) {
      expect(read(...file), file.join('/')).not.toMatch(/<Skeleton[^>]*height=\{\d+\}/);
    }
  });

  it('writes the profile actions in sentence case, with icon chevrons', () => {
    const profile = read('profile', 'index.tsx');

    expect(profile).toContain('Switch role');
    expect(profile).toContain('Sign out');
    expect(profile).not.toMatch(/Switch Role|Sign Out/);
    expect(profile).not.toContain("'›'");
    expect(profile).toMatch(/name="chevron-right"/);
  });

  it('types no font weight as a literal', () => {
    for (const file of screens) {
      expect(read(...file), file.join('/')).not.toMatch(/fontWeight: '\d+'/);
    }
  });
});
