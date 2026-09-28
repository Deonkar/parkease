import { View } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { byTestId, render } from '../../shared/__tests__/render-native';
import { KpiCard } from '../components/KpiCard';

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
}));

describe('KpiCard', () => {
  it('reads label, value and caption as one phrase (R-FE-12)', () => {
    const tree = render(
      <KpiCard
        label="This month"
        value="₹12,800.00"
        caption="11% more than last month"
        testID="kpi-month"
      />,
    );
    expect(byTestId(tree, 'kpi-month')?.props['accessibilityLabel']).toBe(
      'This month, ₹12,800.00, 11% more than last month',
    );
  });

  it('renders children below the caption, inside the same card (M3)', () => {
    const tree = render(
      <KpiCard label="This month" value="₹12,800.00" testID="kpi-month">
        <View testID="chart-child" accessibilityRole="image" accessibilityLabel="Daily chart" />
      </KpiCard>,
    );
    expect(byTestId(tree, 'chart-child')).toBeDefined();
  });

  it('does not let the figure’s accessible phrase swallow the children’s own accessibility (M3)', () => {
    const tree = render(
      <KpiCard label="This month" value="₹12,800.00" testID="kpi-month">
        <View testID="chart-child" accessibilityRole="image" accessibilityLabel="Daily chart" />
      </KpiCard>,
    );
    const child = byTestId(tree, 'chart-child');
    // The figure (label/value/caption) is the one accessible node; the child
    // is a sibling of it, not a descendant collapsed into its phrase.
    expect(child?.props['accessibilityLabel']).toBe('Daily chart');
    expect(byTestId(tree, 'kpi-month')?.props['accessibilityLabel']).toBe('This month, ₹12,800.00');
  });

  it('renders nothing extra when there are no children', () => {
    const tree = render(<KpiCard label="Owed to you" value="₹3,480.00" testID="kpi-owed" />);
    expect(byTestId(tree, 'kpi-owed')?.props['accessibilityLabel']).toBe('Owed to you, ₹3,480.00');
  });
});
