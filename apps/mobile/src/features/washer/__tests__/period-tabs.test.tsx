import type { WasherEarningsPeriod } from '@parkease/contracts/washer';
import { act, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { byTestId, mount, nodes, style, text } from '../../shared/__tests__/render-native';
import { PeriodTabs } from '../components/PeriodTabs';

// react-native ships Flow source the node-environment parser cannot read.
vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
}));

/** Stands in for the screen: the selected period is state the tabs change. */
function Host({ onChange }: { readonly onChange: (period: WasherEarningsPeriod) => void }) {
  const [period, setPeriod] = useState<WasherEarningsPeriod>('week');
  return (
    <PeriodTabs
      value={period}
      onChange={(next) => {
        onChange(next);
        setPeriod(next);
      }}
    />
  );
}

function setup() {
  const chosen: WasherEarningsPeriod[] = [];
  const view = mount(<Host onChange={(period) => chosen.push(period)} />);
  const tab = (period: WasherEarningsPeriod) => {
    const node = byTestId(view.tree(), `period-tab-${period}`);
    if (node === undefined) throw new Error(`no tab for ${period}`);
    return node;
  };
  const press = (period: WasherEarningsPeriod) => {
    act(() => {
      (tab(period).props['onPress'] as () => void)();
    });
  };
  return { view, tab, press, chosen };
}

describe('the earnings period tabs', () => {
  it('offers the four periods in words, in order', () => {
    const { view } = setup();

    const labels = nodes(view.tree())
      .filter((node) => node.props['accessibilityRole'] === 'tab')
      .map((node) => text(node));
    expect(labels).toEqual(['Today', 'This week', 'This month', 'All']);
  });

  it('sits in a tablist, so TalkBack announces "tab, 2 of 4"', () => {
    const { view } = setup();

    expect(nodes(view.tree()).some((node) => node.props['accessibilityRole'] === 'tablist')).toBe(
      true,
    );
  });

  it('marks exactly the selected period as selected', () => {
    const { tab } = setup();

    expect(tab('week').props['accessibilityState']).toEqual({ selected: true });
    expect(tab('today').props['accessibilityState']).toEqual({ selected: false });
    expect(tab('month').props['accessibilityState']).toEqual({ selected: false });
    expect(tab('all').props['accessibilityState']).toEqual({ selected: false });
  });

  it('switches the period and moves the selection with it', () => {
    const { tab, press, chosen } = setup();

    press('month');

    expect(chosen).toEqual(['month']);
    expect(tab('month').props['accessibilityState']).toEqual({ selected: true });
    expect(tab('week').props['accessibilityState']).toEqual({ selected: false });
  });

  it('does not re-request the period already on screen', () => {
    const { press, chosen } = setup();

    press('week');

    expect(chosen).toEqual([]);
  });

  it('gives every tab a touch target of at least 44dp', () => {
    const { tab } = setup();

    for (const period of ['today', 'week', 'month', 'all'] as const) {
      expect(style(tab(period))['minHeight']).toBeGreaterThanOrEqual(44);
    }
  });

  it('marks the selection with more than colour (R-FE-12)', () => {
    const { view } = setup();

    // The selected tab carries an indicator bar the others do not.
    expect(byTestId(view.tree(), 'period-tab-week-indicator')).toBeDefined();
    expect(byTestId(view.tree(), 'period-tab-today-indicator')).toBeUndefined();
  });
});
