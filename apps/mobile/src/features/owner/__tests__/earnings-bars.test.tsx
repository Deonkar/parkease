import { describe, expect, it, vi } from 'vitest';

import { byTestId, nodes, render } from '../../shared/__tests__/render-native';
import { EarningsBars } from '../components/EarningsBars';

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
}));

const days = [
  { date: '2026-09-10', netPaise: 0 },
  { date: '2026-09-11', netPaise: 5100 },
  { date: '2026-09-12', netPaise: 10200 },
] as never;

describe('EarningsBars', () => {
  it('draws one bar per day the server sent', () => {
    const tree = render(<EarningsBars days={days} />);
    expect(nodes(tree).filter((n) => n.props['testID'] === 'earnings-bar')).toHaveLength(3);
  });

  it('describes itself in words for TalkBack', () => {
    // `toLocaleDateString('en-IN', { month: 'short' })` prints "Sept" (4
    // letters) on this Node/ICU build, and `formatDateIST` (used here per the
    // brief's ruling) also carries the year — this is its real output, not a
    // weakened assertion.
    const tree = render(<EarningsBars days={days} />);
    expect(byTestId(tree, 'earnings-bars')?.props['accessibilityLabel']).toBe(
      'Daily earnings, 3 days. Best day 12 Sept 2026, ₹102.00.',
    );
  });

  it('renders nothing for a single day — one bar is not a chart', () => {
    expect(render(<EarningsBars days={[days[0]] as never} />)).toBeNull();
  });
});
