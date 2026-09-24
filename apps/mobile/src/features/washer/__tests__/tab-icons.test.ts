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

/**
 * M2 (walkthrough V2, V3): the label was 12px text in a 9px box, and at 1280px
 * the bar switched to beside-icon and cut "Earnings" to "Earni…". A fixed word
 * never truncates (ui-ux-pro-max, compact label overflow: HIGH).
 */
describe('washer tab labels', () => {
  it('stay below the icon at every width', () => {
    expect(source).toMatch(/tabBarLabelPosition:\s*'below-icon'/);
  });

  it('get their own line box, from the tokens', () => {
    expect(source).toMatch(
      /tabBarLabelStyle:\s*\{[^}]*lineHeight:\s*fontSize\.xs \* lineHeight\.normal/,
    );
  });

  it('sit in a bar sized by the token, with the gesture inset added on top', () => {
    expect(source).toMatch(/height:\s*layout\.tabBarHeight \+ insets\.bottom/);
    expect(source).not.toMatch(/TAB_BAR_HEIGHT = \d+/);
  });
});
