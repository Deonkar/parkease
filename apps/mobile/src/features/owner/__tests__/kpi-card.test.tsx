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
});
