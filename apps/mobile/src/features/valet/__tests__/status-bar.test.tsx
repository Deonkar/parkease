import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { render, text } from '../../shared/__tests__/render-native';
import { OnlineStatusBar } from '../components/OnlineStatusBar';

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  Switch: 'Switch',
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
}));

vi.mock('@expo/vector-icons', () => ({
  MaterialCommunityIcons: 'MaterialCommunityIcons',
}));

const NOW = 1_700_000_000_000;

const bar = (props: Partial<Parameters<typeof OnlineStatusBar>[0]> = {}) =>
  render(
    <OnlineStatusBar
      isOnline
      busy={false}
      lastFixAt={NOW}
      granted
      now={NOW}
      onToggle={() => {}}
      {...props}
    />,
  );

/**
 * The online branch, which the web preview cannot reach.
 *
 * `location/platform.ts` reports `supported: false` on web, so `tracking.state`
 * never becomes `'tracking'` there and this entire branch is unreachable in a
 * browser pass. That is exactly how a hardcoded `lastFixAt={null}` shipped
 * through manual verification: the screen rendered fine, because the only path
 * a browser can render never looks at the value.
 */
describe('the health rail while online', () => {
  it('reports a current fix as sharing, with its age', () => {
    const tree = bar({ lastFixAt: NOW - 2_000 });

    expect(text(tree)).toContain('Location sharing');
    expect(text(tree)).toContain('2s ago');
  });

  it('warns about a weak signal once the fix goes stale', () => {
    const tree = bar({ lastFixAt: NOW - 38_000 });

    expect(text(tree)).toContain('Weak GPS signal');
    expect(text(tree)).toContain('38s ago');
  });

  it('says the feed is dead once the fix is lost, and that the driver sees it', () => {
    const tree = bar({ lastFixAt: NOW - 240_000 });

    expect(text(tree)).toContain('Location not updating');
    expect(text(tree)).toContain('4 min ago');
    expect(text(tree)).toContain('The driver can see this too.');
  });

  it('does not cry wolf when a fix has simply not arrived yet', () => {
    // The regression: `lastFixAt` was hardcoded to null on the offers screen,
    // so every online valet was permanently told location was not updating.
    // With real wiring this state still reads as lost — but the screen must
    // supply a real value, which `offers-wiring` below is the guard for.
    const tree = bar({ lastFixAt: null });

    expect(text(tree)).toContain('Location not updating');
  });

  it('names a revoked permission rather than blaming the signal', () => {
    const tree = bar({ lastFixAt: NOW, granted: false });

    expect(text(tree)).toContain('Location permission turned off');
    expect(text(tree)).not.toContain('Weak GPS signal');
  });

  it('carries words, not colour alone, in every state (R-FE-12)', () => {
    for (const fixAt of [NOW, NOW - 38_000, NOW - 240_000]) {
      expect(text(bar({ lastFixAt: fixAt })).trim()).not.toBe('');
    }
  });
});

/**
 * The guard for the defect that actually shipped.
 *
 * The component above was never wrong — `offers.tsx` passed it a literal
 * `null`, so a valet who went online was permanently told "Location not
 * updating". Every unit test above passed throughout, because none of them
 * looked at the caller.
 *
 * This is the same lesson `learnings.md` records about the origin allowlist
 * that was asserted by a test and never passed to the WebView: a control has to
 * be reachable from production code, not merely present. So this asserts the
 * wiring itself.
 */
describe('the offers screen supplies a real fix age', () => {
  const source = readFileSync(join(process.cwd(), 'app', '(valet)', 'offers.tsx'), 'utf8');

  it('passes the tracked timestamp, not a literal', () => {
    expect(source).toContain('lastFixAt={tracking.lastFixAt}');
  });

  it('never hardcodes the fix age', () => {
    expect(source).not.toMatch(/lastFixAt=\{(null|undefined|0)\}/);
  });
});
