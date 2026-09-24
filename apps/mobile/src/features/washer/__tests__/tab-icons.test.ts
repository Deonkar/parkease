import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const glyphMap =
  require('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json') as Record<
    string,
    number
  >;

const source = readFileSync(join(process.cwd(), 'app', '(washer)', '_layout.tsx'), 'utf8');

// Each `<Tabs.Screen ... />` element, self-closing, possibly spanning lines.
const screens = [...source.matchAll(/<Tabs\.Screen\b[\s\S]*?\/>/g)].map((m) => m[0]);

describe('washer tab bar', () => {
  it('declares the four bar tabs plus the hidden profile', () => {
    const names = screens.map((s) => /name="([^"]+)"/.exec(s)?.[1]);
    expect(names).toEqual(['offers', 'active', 'menu', 'earnings', 'profile']);
  });

  it.each(['offers', 'active', 'menu', 'earnings'])(
    '%s has an outline/filled icon pair that exists in the glyph map',
    (name) => {
      const screen = screens.find((s) => s.includes(`name="${name}"`));
      const icon = /tabBarIcon:\s*tabIcon\('([^']+)',\s*'([^']+)'\)/.exec(screen ?? '');
      expect(icon, `${name} has no tabBarIcon`).not.toBeNull();
      const [, outline, filled] = icon ?? [];
      expect(glyphMap).toHaveProperty([outline ?? '']);
      expect(glyphMap).toHaveProperty([filled ?? '']);
      expect(outline).not.toBe(filled);
    },
  );

  it('keeps profile out of the bar', () => {
    const profile = screens.find((s) => s.includes('name="profile"'));
    expect(profile).toMatch(/href:\s*null/);
  });
});
