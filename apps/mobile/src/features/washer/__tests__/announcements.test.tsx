import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { render } from '../../shared/__tests__/render-native';
import { FieldError } from '../components/FieldError';
import { RefreshNotice } from '../components/RefreshNotice';

/**
 * H4: every message that appears is announced, one way, everywhere.
 *
 * `accessibilityLiveRegion` on a view that MOUNTS with its text is not reliably
 * read by TalkBack — the region has to exist before its content changes. So
 * every washer message is announced with `announceForAccessibility` when it
 * appears (`useAnnounce`), and no washer view relies on a live region.
 */

const announced = vi.hoisted(() => vi.fn());

vi.mock('react-native', () => ({
  AccessibilityInfo: { announceForAccessibility: announced },
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
}));

vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: 'MaterialCommunityIcons' }));

describe('the shared washer notices', () => {
  it('announce a field error when it appears', () => {
    announced.mockClear();
    render(<FieldError testID="e" message="Enter your name." />);
    expect(announced).toHaveBeenCalledWith('Enter your name.');
  });

  it('announce a failed refresh when it appears', () => {
    announced.mockClear();
    render(<RefreshNotice testID="r" retryLabel="Refresh the job" onRetry={() => undefined} />);
    expect(announced).toHaveBeenCalledWith(expect.stringMatching(/Couldn't refresh/));
  });
});

const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), 'utf8');

describe('one approach, applied everywhere', () => {
  const sources = [
    ...readdirSync(join(process.cwd(), 'src', 'features', 'washer', 'components')).map((file) =>
      read('src', 'features', 'washer', 'components', file),
    ),
    read('app', '(washer)', 'offers.tsx'),
    read('app', '(washer)', 'active', 'index.tsx'),
    read('app', '(washer)', 'profile', 'index.tsx'),
  ];

  it('no washer view relies on a live region', () => {
    for (const source of sources) expect(source).not.toContain('accessibilityLiveRegion');
  });

  it('the offers notice, the active screen s notices and the profile notice are announced', () => {
    expect(read('app', '(washer)', 'offers.tsx')).toContain('useAnnounce(visibleNotice)');
    const active = read('app', '(washer)', 'active', 'index.tsx');
    expect(active).toContain('useAnnounce(actionNotice)');
    expect(active).toMatch(/useAnnounce\(\s*active\.data\?\.status === 'completed'/);
    expect(read('app', '(washer)', 'profile', 'index.tsx')).toContain('useAnnounce(notice)');
  });
});
